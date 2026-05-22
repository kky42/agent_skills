import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  dbPath,
  fail,
  SQLITE_TIMEOUT_MS,
  kanbanDir,
  normalizeRunId,
  normalizeTaskId,
  now,
  q,
  requireCommand,
  runsDir,
} from "./common.mjs";

export function runSql(opts, sql, { json = false, allowMissingDb = false, readonly = false } = {}) {
  requireCommand("sqlite3");
  const db = dbPath(opts);
  if (!allowMissingDb && !fs.existsSync(db)) {
    fail(`database not initialized: ${db}`);
  }
  const sqliteArgs = [
    ...(readonly ? ["-readonly"] : []),
    ...(json ? ["-json"] : []),
    db,
    ".timeout 10000",
    sql,
  ];
  const runOnce = () => spawnSync("sqlite3", sqliteArgs, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  let result = runOnce();
  const started = Date.now();
  while (result.status !== 0 && /unable to open database file|database is locked|database is busy/i.test(`${result.stderr}\n${result.stdout}`) && Date.now() - started < SQLITE_TIMEOUT_MS) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    result = runOnce();
  }
  if (result.status !== 0) {
    fail(result.stderr.trim() || result.stdout.trim() || "sqlite3 failed");
  }
  if (!json) {
    return result.stdout;
  }
  const text = result.stdout.trim();
  if (!text) {
    return [];
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`failed to parse sqlite JSON: ${error.message}\n${text.slice(0, 1000)}`);
  }
}

export function dbExists(opts) {
  return fs.existsSync(dbPath(opts));
}

export function ensureDb(opts) {
  requireCommand("sqlite3");
  fs.mkdirSync(kanbanDir(opts), { recursive: true });
  fs.mkdirSync(runsDir(opts), { recursive: true });
  const schema = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta(key, value) VALUES ('task_seq', '0');
INSERT OR IGNORE INTO meta(key, value) VALUES ('run_seq', '0');
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  priority INTEGER NOT NULL DEFAULT 0,
  assignee TEXT,
  parent_id TEXT,
  blocked_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  agent TEXT NOT NULL,
  sandbox TEXT NOT NULL,
  model TEXT,
  reasoning TEXT,
  cwd TEXT NOT NULL,
  command TEXT,
  tmux_session TEXT,
  log_path TEXT,
  raw_log_path TEXT,
  runner_log_path TEXT,
  prompt_path TEXT,
  status TEXT NOT NULL,
  helper_state TEXT,
  helper_ok INTEGER,
  session_id TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  final_status TEXT,
  final_summary TEXT,
  changed_files TEXT,
  tests TEXT,
  next TEXT,
  last_error TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
PRAGMA table_info(tasks);
`;
  runSql(opts, schema, { allowMissingDb: true });
  const columns = runSql(opts, "PRAGMA table_info(tasks);", { json: true, allowMissingDb: true }).map((row) => row.name);
  if (!columns.includes("archived_at")) {
    runSql(opts, "ALTER TABLE tasks ADD COLUMN archived_at TEXT;", { allowMissingDb: true });
  }
}

export function query(opts, sql) {
  ensureDb(opts);
  return runSql(opts, sql, { json: true });
}

export function readQuery(opts, sql, { allowMissingDb = false } = {}) {
  const db = dbPath(opts);
  if (!fs.existsSync(db)) {
    if (allowMissingDb) return [];
    fail(`database not initialized: ${db}`);
  }
  return runSql(opts, sql, { json: true, readonly: true });
}

export function exec(opts, sql) {
  ensureDb(opts);
  return runSql(opts, sql);
}

export function one(opts, sql) {
  const rows = query(opts, sql);
  return rows.length ? rows[0] : null;
}

export function readOne(opts, sql) {
  const rows = readQuery(opts, sql);
  return rows.length ? rows[0] : null;
}

export function nextId(opts, key, prefix) {
  const sql = `
BEGIN IMMEDIATE;
INSERT OR IGNORE INTO meta(key, value) VALUES (${q(key)}, '0');
UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = ${q(key)};
SELECT value FROM meta WHERE key = ${q(key)};
COMMIT;
`;
  const rows = runSql(opts, sql, { json: true });
  const value = rows.at(-1)?.value;
  const next = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(next)) {
    fail(`failed to allocate ${prefix} id for ${key}`);
  }
  return `${prefix}-${next}`;
}

export function getTask(opts, taskId) {
  const id = normalizeTaskId(taskId);
  const task = one(opts, `SELECT * FROM tasks WHERE id = ${q(id)}`);
  if (!task) {
    fail(`task not found: ${id}`);
  }
  return task;
}

export function readTask(opts, taskId) {
  const id = normalizeTaskId(taskId);
  const task = readOne(opts, `SELECT * FROM tasks WHERE id = ${q(id)}`);
  if (!task) {
    fail(`task not found: ${id}`);
  }
  return task;
}

export function getRun(opts, idOrName) {
  const text = String(idOrName ?? "").trim();
  if (!text) {
    fail("run id or name is required");
  }
  const runId = /^(\d+|run-\d+)$/i.test(text) ? normalizeRunId(text) : text;
  const run = one(opts, `SELECT * FROM runs WHERE id = ${q(runId)} OR name = ${q(text)}`);
  if (!run) {
    fail(`run not found: ${text}`);
  }
  return run;
}

export function addEvent(opts, { taskId = null, actor = "orchestrator", type, message = "", payload = null }) {
  exec(
    opts,
    `INSERT INTO task_events(task_id, actor, type, message, payload_json, created_at)
     VALUES (${q(taskId)}, ${q(actor)}, ${q(type)}, ${q(message)}, ${q(payload ? JSON.stringify(payload) : null)}, ${q(now())})`
  );
}

export function updateTaskFields(opts, taskId, fields, event) {
  const id = normalizeTaskId(taskId);
  getTask(opts, id);
  const updates = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} = ${q(value)}`);
  updates.push(`updated_at = ${q(now())}`);
  exec(opts, `UPDATE tasks SET ${updates.join(", ")} WHERE id = ${q(id)}`);
  if (event) {
    addEvent(opts, { taskId: id, ...event });
  }
}
