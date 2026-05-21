#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_STATUSES = new Set([
  "backlog",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "failed",
  "canceled",
]);
const VALID_AGENTS = new Set(["codex", "claude", "pi"]);
const VALID_SANDBOXES = new Set(["read-only", "workspace-write", "danger-full-access"]);

const DEFAULT_AGENT_CONFIG = {
  codex: { model: "gpt-5.5", reasoning: "low" },
  claude: { model: "deepseek-v4-flash[1m]", reasoning: "low" },
  pi: { model: "deepseek/deepseek-v4-flash", reasoning: "low" },
};

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const SKILL_DIR = path.dirname(SCRIPT_DIR);
const WORKER_PROMPT_TEMPLATE = path.join(SKILL_DIR, "templates", "worker-system-prompt.md");
const CLAUDE_PERMISSION_MODES = {
  "read-only": "plan",
  "workspace-write": "bypassPermissions",
  "danger-full-access": "bypassPermissions",
};

function usage() {
  console.log(`Usage:
  kanban.mjs init [--root DIR] [--db PATH]
  kanban.mjs add TITLE [--body TEXT] [--status ready] [--priority N]
  kanban.mjs list [--status STATUS]
  kanban.mjs show TASK-ID
  kanban.mjs claim TASK-ID [--run RUN-ID] [--assignee NAME] [--note TEXT]
  kanban.mjs report TASK-ID --status done|blocked|failed --summary TEXT [--run RUN-ID] [--changed-files TEXT] [--tests TEXT] [--next TEXT]
  kanban.mjs update TASK-ID [--status STATUS] [--title TEXT] [--body TEXT] [--priority N] [--assignee NAME] [--note TEXT]
  kanban.mjs block TASK-ID --reason TEXT
  kanban.mjs done TASK-ID [--note TEXT]
  kanban.mjs review TASK-ID [--note TEXT]
  kanban.mjs fail TASK-ID --reason TEXT
  kanban.mjs cancel TASK-ID [--reason TEXT]
  kanban.mjs status
  kanban.mjs runs [--status STATUS]
  kanban.mjs spawn TASK-ID --agent codex|claude|pi [--sandbox read-only|workspace-write|danger-full-access] [--cwd DIR] [--tag TAG] [--model MODEL] [--reasoning LEVEL] [--prompt TEXT|--prompt-file PATH] [--replace-existing] [--dry-run]
  kanban.mjs harvest [--task TASK-ID|--run RUN-ID|--all]
  kanban.mjs steer RUN-ID --message TEXT [--replace]
  kanban.mjs send RUN-ID --message TEXT [--replace]
  kanban.mjs close RUN-ID

Global options:
  --root DIR       Repo/project root. Defaults to the current directory.
  --db PATH        SQLite database path. Defaults to <root>/.kanban/kanban.db.

Most commands print JSON.
`);
}

function fail(message, code = 1) {
  console.error(`kanban: ${message}`);
  process.exit(code);
}

function parseArgv(argv) {
  let command = null;
  const opts = {};
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (!command) {
        command = arg;
      } else {
        args.push(arg);
      }
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }
  return { command, args, opts };
}

function requireCommand(command) {
  const result = spawnSync("command", ["-v", command], {
    shell: true,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`${command} not found on PATH`);
  }
}

function rootDir(opts) {
  return path.resolve(String(opts.root ?? process.env.KANBAN_ROOT ?? process.cwd()));
}

function dbPath(opts) {
  if (opts.db || process.env.KANBAN_DB) {
    return path.resolve(String(opts.db ?? process.env.KANBAN_DB));
  }
  return path.join(rootDir(opts), ".kanban", "kanban.db");
}

function kanbanDir(opts) {
  return path.dirname(dbPath(opts));
}

function runsDir(opts) {
  return path.join(kanbanDir(opts), "runs");
}

function q(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function now() {
  return new Date().toISOString();
}

function runSql(opts, sql, { json = false, allowMissingDb = false, readonly = false } = {}) {
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
  const result = spawnSync("sqlite3", sqliteArgs, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
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

function ensureDb(opts) {
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
  completed_at TEXT
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
`;
  runSql(opts, schema, { allowMissingDb: true });
}

function query(opts, sql) {
  ensureDb(opts);
  return runSql(opts, sql, { json: true });
}

function readQuery(opts, sql) {
  const db = dbPath(opts);
  if (!fs.existsSync(db)) {
    fail(`database not initialized: ${db}`);
  }
  return runSql(opts, sql, { json: true, readonly: true });
}

function exec(opts, sql) {
  ensureDb(opts);
  return runSql(opts, sql);
}

function one(opts, sql) {
  const rows = query(opts, sql);
  return rows.length ? rows[0] : null;
}

function readOne(opts, sql) {
  const rows = readQuery(opts, sql);
  return rows.length ? rows[0] : null;
}

function nextId(opts, key, prefix) {
  const row = one(opts, `SELECT value FROM meta WHERE key = ${q(key)}`);
  const next = Number.parseInt(row?.value ?? "0", 10) + 1;
  exec(opts, `UPDATE meta SET value = ${q(String(next))} WHERE key = ${q(key)}`);
  return `${prefix}-${next}`;
}

function normalizeTaskId(id) {
  const text = String(id ?? "").trim();
  if (!text) {
    fail("task id is required");
  }
  if (/^\d+$/.test(text)) {
    return `TASK-${text}`;
  }
  return text.replace(/^task-/i, "TASK-");
}

function normalizeRunId(id) {
  const text = String(id ?? "").trim();
  if (!text) {
    fail("run id is required");
  }
  if (/^\d+$/.test(text)) {
    return `RUN-${text}`;
  }
  return text.replace(/^run-/i, "RUN-");
}

function validateStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    fail(`status must be one of: ${Array.from(VALID_STATUSES).join(", ")}`);
  }
  return status;
}

function getTask(opts, taskId) {
  const id = normalizeTaskId(taskId);
  const task = one(opts, `SELECT * FROM tasks WHERE id = ${q(id)}`);
  if (!task) {
    fail(`task not found: ${id}`);
  }
  return task;
}

function readTask(opts, taskId) {
  const id = normalizeTaskId(taskId);
  const task = readOne(opts, `SELECT * FROM tasks WHERE id = ${q(id)}`);
  if (!task) {
    fail(`task not found: ${id}`);
  }
  return task;
}

function addEvent(opts, { taskId = null, actor = "orchestrator", type, message = "", payload = null }) {
  exec(
    opts,
    `INSERT INTO task_events(task_id, actor, type, message, payload_json, created_at)
     VALUES (${q(taskId)}, ${q(actor)}, ${q(type)}, ${q(message)}, ${q(payload ? JSON.stringify(payload) : null)}, ${q(now())})`
  );
}

function updateTaskFields(opts, taskId, fields, event) {
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

function parseIntOpt(value, fallback = 0) {
  if (value === undefined || value === null || value === true) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    fail(`expected integer, got: ${value}`);
  }
  return parsed;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function commandInit(opts) {
  ensureDb(opts);
  print({
    ok: true,
    dbPath: dbPath(opts),
    kanbanDir: kanbanDir(opts),
    runsDir: runsDir(opts),
  });
}

function commandAdd(args, opts) {
  const title = args[0];
  if (!title) {
    fail("add requires TITLE");
  }
  const status = validateStatus(String(opts.status ?? "ready"));
  const id = nextId(opts, "task_seq", "TASK");
  const stamp = now();
  exec(
    opts,
    `INSERT INTO tasks(id, title, body, status, priority, assignee, parent_id, blocked_by, created_at, updated_at)
     VALUES (${q(id)}, ${q(title)}, ${q(opts.body ?? "")}, ${q(status)}, ${q(parseIntOpt(opts.priority, 0))},
             ${q(opts.assignee ?? null)}, ${q(opts.parent ?? null)}, ${q(opts["blocked-by"] ?? opts.blockedBy ?? null)},
             ${q(stamp)}, ${q(stamp)})`
  );
  addEvent(opts, {
    taskId: id,
    type: "created",
    message: title,
    payload: { status, priority: parseIntOpt(opts.priority, 0) },
  });
  print(getTask(opts, id));
}

function commandList(opts) {
  const where = opts.status ? `WHERE status = ${q(validateStatus(String(opts.status)))}` : "";
  const rows = readQuery(
    opts,
    `SELECT id, status, priority, assignee, title, parent_id, blocked_by, updated_at
     FROM tasks
     ${where}
     ORDER BY
       CASE status
         WHEN 'running' THEN 1
         WHEN 'blocked' THEN 2
         WHEN 'review' THEN 3
         WHEN 'ready' THEN 4
         WHEN 'backlog' THEN 5
         WHEN 'failed' THEN 6
         WHEN 'done' THEN 7
         WHEN 'canceled' THEN 8
         ELSE 9
       END,
       priority DESC,
       created_at ASC`
  );
  print(rows);
}

function commandShow(args, opts) {
  const id = normalizeTaskId(args[0]);
  const task = readTask(opts, id);
  const events = readQuery(
    opts,
    `SELECT id, actor, type, message, payload_json, created_at
     FROM task_events
     WHERE task_id = ${q(id)}
     ORDER BY id ASC`
  );
  const runs = readQuery(
    opts,
    `SELECT *
     FROM runs
     WHERE task_id = ${q(id)}
     ORDER BY started_at DESC`
  );
  print({ task, events, runs });
}

function commandUpdate(args, opts) {
  const id = normalizeTaskId(args[0]);
  const fields = {};
  if (opts.status !== undefined) {
    fields.status = validateStatus(String(opts.status));
    fields.completed_at = fields.status === "done" ? now() : null;
  }
  if (opts.title !== undefined) fields.title = String(opts.title);
  if (opts.body !== undefined) fields.body = String(opts.body);
  if (opts.priority !== undefined) fields.priority = parseIntOpt(opts.priority);
  if (opts.assignee !== undefined) fields.assignee = String(opts.assignee);
  if (opts["blocked-by"] !== undefined || opts.blockedBy !== undefined) {
    fields.blocked_by = String(opts["blocked-by"] ?? opts.blockedBy);
  }
  if (Object.keys(fields).length === 0 && !opts.note) {
    fail("update requires a field or --note");
  }
  updateTaskFields(opts, id, fields, {
    type: "updated",
    message: String(opts.note ?? ""),
    payload: fields,
  });
  print(getTask(opts, id));
}

function getRun(opts, idOrName) {
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

function commandClaim(args, opts) {
  const id = normalizeTaskId(args[0]);
  const task = getTask(opts, id);
  const run = opts.run ? getRun(opts, opts.run) : null;
  if (run && run.task_id !== task.id) {
    fail(`${run.id} belongs to ${run.task_id}, not ${task.id}`);
  }
  const assignee = String(opts.assignee ?? run?.agent ?? "worker");
  updateTaskFields(opts, task.id, {
    status: "running",
    assignee,
    blocked_by: null,
    completed_at: null,
  }, {
    actor: String(opts.actor ?? assignee),
    type: "claimed",
    message: String(opts.note ?? "Started"),
    payload: { runId: run?.id ?? null, runName: run?.name ?? null },
  });
  if (run) {
    exec(
      opts,
      `UPDATE runs
       SET helper_state = CASE WHEN helper_state IS NULL OR helper_state IN ('starting', 'running') THEN 'claimed' ELSE helper_state END,
           updated_at = ${q(now())}
       WHERE id = ${q(run.id)}`
    );
  }
  print({ task: getTask(opts, task.id), run: run ? one(opts, `SELECT * FROM runs WHERE id = ${q(run.id)}`) : null });
}

function commandReport(args, opts) {
  const id = normalizeTaskId(args[0]);
  const task = getTask(opts, id);
  const run = opts.run ? getRun(opts, opts.run) : null;
  if (run && run.task_id !== task.id) {
    fail(`${run.id} belongs to ${run.task_id}, not ${task.id}`);
  }
  const reportStatus = String(opts.status ?? "").toLowerCase();
  if (!["done", "blocked", "failed"].includes(reportStatus)) {
    fail("report --status must be one of: done, blocked, failed");
  }
  const summary = String(opts.summary ?? opts.note ?? "").trim();
  if (!summary) {
    fail("report requires --summary");
  }
  const next = opts.next === undefined ? "" : String(opts.next);
  const taskStatus = reportStatus === "done" ? "review" : reportStatus;
  updateTaskFields(opts, task.id, {
    status: taskStatus,
    blocked_by: reportStatus === "blocked" ? (next || summary) : null,
    completed_at: null,
  }, {
    actor: String(opts.actor ?? run?.agent ?? "worker"),
    type: `reported_${reportStatus}`,
    message: summary,
    payload: {
      runId: run?.id ?? null,
      runName: run?.name ?? null,
      status: reportStatus,
      changedFiles: opts["changed-files"] ?? opts.changedFiles ?? null,
      tests: opts.tests ?? null,
      next: next || null,
    },
  });
  if (run) {
    exec(
      opts,
      `UPDATE runs
       SET helper_state = 'reported',
           final_status = ${q(reportStatus)},
           final_summary = ${q(summary)},
           changed_files = ${q(opts["changed-files"] ?? opts.changedFiles ?? null)},
           tests = ${q(opts.tests ?? null)},
           next = ${q(next || null)},
           updated_at = ${q(now())}
       WHERE id = ${q(run.id)}`
    );
  }
  print({ task: getTask(opts, task.id), run: run ? one(opts, `SELECT * FROM runs WHERE id = ${q(run.id)}`) : null });
}

function commandTransition(args, opts, status, type, messageOption) {
  const id = normalizeTaskId(args[0]);
  const message = String(opts[messageOption] ?? opts.note ?? "");
  if ((type === "blocked" || type === "failed") && !message) {
    fail(`${type} requires --${messageOption}`);
  }
  const fields = {
    status,
    blocked_by: status === "blocked" ? message : null,
    completed_at: status === "done" ? now() : null,
  };
  updateTaskFields(opts, id, fields, { type, message });
  print(getTask(opts, id));
}

function countsByStatus(opts) {
  return readQuery(opts, `SELECT status, COUNT(*) AS count FROM tasks GROUP BY status ORDER BY status`);
}

function commandStatus(opts) {
  const tasks = readQuery(
    opts,
    `SELECT id, status, priority, assignee, title, blocked_by, updated_at
     FROM tasks
     WHERE status NOT IN ('done', 'canceled')
     ORDER BY priority DESC, updated_at DESC`
  );
  const activeRuns = readQuery(
    opts,
    `SELECT id, task_id, name, agent, sandbox, model, reasoning, status, helper_state, session_id, updated_at
     FROM runs
     WHERE status IN ('starting', 'running')
     ORDER BY started_at ASC`
  );
  const recentEvents = readQuery(
    opts,
    `SELECT id, task_id, actor, type, message, created_at
     FROM task_events
     ORDER BY id DESC
     LIMIT 20`
  );
  print({ dbPath: dbPath(opts), counts: countsByStatus(opts), tasks, activeRuns, recentEvents });
}

function commandRuns(opts) {
  const where = opts.status ? `WHERE status = ${q(String(opts.status))}` : "";
  const runs = readQuery(
    opts,
    `SELECT id, task_id, name, agent, sandbox, model, reasoning, status, helper_state, helper_ok,
            session_id, started_at, updated_at, ended_at, final_status, final_summary,
            changed_files, tests, next, log_path
     FROM runs
     ${where}
     ORDER BY started_at DESC`
  );
  print(runs);
}

function slug(value) {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "x";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function readOptionalFile(filePath) {
  if (!filePath) {
    return "";
  }
  return fs.readFileSync(path.resolve(String(filePath)), "utf8");
}

function composePrompt({ opts, task, runId, runName, agent, sandbox, cwd, model, reasoning, extraPrompt }) {
  const preamble = fs.readFileSync(WORKER_PROMPT_TEMPLATE, "utf8").trim();
  const kanbanCmd = `node ${shellQuote(SCRIPT_PATH)}`;
  const dbArg = `--db ${shellQuote(dbPath(opts))}`;
  return `${preamble}

---

# Assigned Kanban Task

Task ID: ${task.id}
Run ID: ${runId}
Run Name: ${runName}
Agent: ${agent}
Sandbox: ${sandbox}
Model: ${model ?? "default"}
Reasoning: ${reasoning ?? "default"}
Allowed cwd: ${cwd}

Kanban CLI. Copy these exact commands; there may not be a kanban binary on PATH.

\`\`\`bash
${kanbanCmd} show ${task.id} ${dbArg}
${kanbanCmd} claim ${task.id} ${dbArg} --run ${runId} --assignee ${agent} --note "Started"
${kanbanCmd} report ${task.id} ${dbArg} --run ${runId} --status done --summary "..." --changed-files "none" --tests "not run" --next "none"
${kanbanCmd} report ${task.id} ${dbArg} --run ${runId} --status blocked --summary "..." --next "..."
${kanbanCmd} report ${task.id} ${dbArg} --run ${runId} --status failed --summary "..." --next "..."
\`\`\`

If the sandbox prevents writing to the kanban database, continue the task and
rely on the required final marker. The orchestrator will harvest your final
output from the worker log. A worker done report moves the task to review;
only the orchestrator marks it done after verification.

Title:
${task.title}

Body:
${task.body || "(none)"}

Stop condition:
Complete only this task. Do not expand scope. If the task is ambiguous or
requires authority outside the sandbox, mark it blocked.
${extraPrompt ? `\nAdditional prompt:\n${extraPrompt.trim()}\n` : ""}
`;
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function spawnCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

function tmux(args, options = {}) {
  return spawnCapture("tmux", args, { encoding: "utf8", ...options });
}

function writeJsonAtomic(filePath, value) {
  if (!filePath) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

function appendText(filePath, text) {
  if (!filePath || !text) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, text);
}

function parseJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function supportsPiSandbox(cwd) {
  const result = spawnCapture("pi", ["-h"], { cwd });
  return result.status === 0 && /--sandbox\b/.test(`${result.stdout}\n${result.stderr}`);
}

function addModelAndReasoning(args, agent, { model, reasoning }) {
  if (model) {
    args.push("--model", model);
  }
  if (!reasoning) {
    return;
  }
  if (agent === "codex") {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(reasoning)}`);
  } else if (agent === "claude") {
    args.push("--effort", reasoning);
  } else {
    args.push("--thinking", reasoning);
  }
}

function buildAgentRunArgs({ agent, sandbox, cwd, prompt, model, reasoning, systemPrompt }) {
  if (agent === "codex") {
    const args = ["-a", "never", "exec", "--json", "--sandbox", sandbox, "-C", cwd];
    addModelAndReasoning(args, agent, { model, reasoning });
    args.push(prompt);
    return args;
  }
  if (agent === "claude") {
    const args = ["-p", "--output-format", "stream-json", "--permission-mode", CLAUDE_PERMISSION_MODES[sandbox]];
    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }
    addModelAndReasoning(args, agent, { model, reasoning });
    args.push(prompt);
    return args;
  }
  const args = ["-p", "--mode", "json"];
  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }
  if (supportsPiSandbox(cwd)) {
    args.push("--sandbox", sandbox);
  } else if (sandbox === "read-only") {
    args.push("--tools", "read,grep,find,ls");
  } else {
    fail("pi --sandbox is not available in this environment, so workspace-write/danger-full-access cannot be enforced");
  }
  addModelAndReasoning(args, agent, { model, reasoning });
  args.push(prompt);
  return args;
}

function textBlocks(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function eventAction(agent, event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  if (agent === "codex") {
    if (event.type === "thread.started") {
      return { kind: "session", sessionId: event.thread_id ?? null };
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      return { kind: "message", text: event.item.text ?? "" };
    }
    if (event.type === "turn.completed") {
      return { kind: "done" };
    }
    if (event.type === "turn.failed" || event.type === "error") {
      return { kind: "error", text: event.error?.message ?? event.message ?? "Codex failed" };
    }
  }
  if (agent === "claude") {
    if (event.type === "system" && event.subtype === "init") {
      return { kind: "session", sessionId: event.session_id ?? null };
    }
    if (event.type === "assistant") {
      const text = textBlocks(event.message?.content);
      return text ? { kind: "message", text } : null;
    }
    if (event.type === "result") {
      return event.is_error
        ? { kind: "error", text: event.errors?.[0] ?? event.subtype ?? "Claude failed" }
        : { kind: "done" };
    }
    if (event.type === "error") {
      return { kind: "error", text: event.message ?? "Claude failed" };
    }
  }
  if (agent === "pi") {
    if (event.type === "session") {
      return { kind: "session", sessionId: event.id ?? null };
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      if (event.message.stopReason === "error") {
        return { kind: "error", text: event.message.errorMessage ?? "Pi failed" };
      }
      const text = textBlocks(event.message.content);
      return text ? { kind: "message", text } : null;
    }
    if (event.type === "turn_end" || event.type === "agent_end") {
      return { kind: "done" };
    }
    if (event.type === "compaction_end" && event.errorMessage) {
      return { kind: "error", text: `Pi compaction failed: ${event.errorMessage}` };
    }
    if (event.type === "auto_retry_end" && !event.success && event.finalError) {
      return { kind: "error", text: `Pi retry failed: ${event.finalError}` };
    }
  }
  return null;
}

async function runStructuredWorker({ agent, sandbox, cwd, prompt, model, reasoning, liveLog, rawLog }) {
  requireCommand(agent);
  if (!prompt) {
    fail("--prompt or --prompt-file is required for worker-run");
  }
  const workerName = process.env.KANBAN_WORKER_NAME || null;
  const systemPrompt = fs.readFileSync(WORKER_PROMPT_TEMPLATE, "utf8").trim();
  const args = buildAgentRunArgs({ agent, sandbox, cwd, prompt, model, reasoning, systemPrompt });
  const startedAt = now();
  let updatedAt = startedAt;
  const child = spawn(agent, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buffer = "";
  let session = null;
  let finalText = "";
  let done = false;
  const errors = [];
  const stderr = [];
  const stderrTail = [];
  const eventTypes = [];
  let rawLineCount = 0;
  let exit = null;

  const buildOutput = () => ({
    name: workerName,
    agent,
    sandbox,
    cwd,
    model: model ?? null,
    reasoning: reasoning ?? null,
    sessionId: session ?? null,
    pid: child.pid ?? null,
    startedAt,
    updatedAt,
    running: exit === null,
    exitCode: exit?.code ?? null,
    signal: exit?.signal ?? null,
    done,
    ok: exit === null ? null : errors.length === 0 && (done || exit.code === 0),
    errors,
    stderr,
    stderrTail,
    finalText,
    rawLineCount,
    lastEventType: eventTypes.length ? eventTypes[eventTypes.length - 1] : null,
    eventTypes,
  });

  const writeLive = () => {
    updatedAt = now();
    writeJsonAtomic(liveLog, buildOutput());
  };

  writeLive();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      appendText(rawLog, `${line}\n`);
      rawLineCount += 1;
      const event = parseJsonLine(line);
      if (!event) {
        continue;
      }
      eventTypes.push(event.type);
      const action = eventAction(agent, event);
      if (!action) {
        continue;
      }
      if (action.kind === "session") {
        session = action.sessionId;
      } else if (action.kind === "message") {
        finalText = action.text;
      } else if (action.kind === "done") {
        done = true;
        if (agent === "codex" && !child.killed) {
          child.kill("SIGTERM");
        }
      } else if (action.kind === "error") {
        errors.push(action.text);
      }
    }
    writeLive();
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      stderr.push(text);
      stderrTail.push(text);
      while (stderrTail.length > 20) {
        stderrTail.shift();
      }
      writeLive();
    }
  });

  exit = await new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });

  if (buffer.trim()) {
    appendText(rawLog, `${buffer.trim()}\n`);
    rawLineCount += 1;
    const event = parseJsonLine(buffer);
    if (event?.type) {
      eventTypes.push(event.type);
    }
    const action = eventAction(agent, event);
    if (action?.kind === "message") {
      finalText = action.text;
    } else if (action?.kind === "done") {
      done = true;
    } else if (action?.kind === "error") {
      errors.push(action.text);
    }
  }

  const output = buildOutput();
  writeJsonAtomic(liveLog, output);
  print(output);
  process.exit(output.ok ? 0 : 1);
}

function workerRunArgs({ agent, sandbox, cwd, model, reasoning, promptPath, liveLog, rawLog }) {
  const args = [
    SCRIPT_PATH,
    "worker-run",
    "--agent",
    agent,
    "--sandbox",
    sandbox,
    "--cwd",
    cwd,
    "--prompt-file",
    promptPath,
    "--live-log",
    liveLog,
    "--raw-log",
    rawLog,
  ];
  if (model) {
    args.push("--model", model);
  }
  if (reasoning) {
    args.push("--reasoning", reasoning);
  }
  return args;
}

function buildWorkerCommand({ name, cwd, agent, sandbox, model, reasoning, promptPath, liveLog, rawLog, runnerLog }) {
  const args = workerRunArgs({ agent, sandbox, cwd, model, reasoning, promptPath, liveLog, rawLog });
  return `KANBAN_WORKER_NAME=${shellQuote(name)} ${[process.execPath, ...args].map(shellQuote).join(" ")} > ${shellQuote(runnerLog)} 2>&1`;
}

function launchWorkerTmux({ name, cwd, agent, sandbox, model, reasoning, promptPath, logPath }) {
  requireCommand("tmux");
  requireCommand(agent);
  const rawLog = `${logPath}.raw.jsonl`;
  const runnerLog = `${logPath}.runner.log`;
  const command = buildWorkerCommand({ name, cwd, agent, sandbox, model, reasoning, promptPath, liveLog: logPath, rawLog, runnerLog });
  writeJsonAtomic(logPath, {
    name,
    agent,
    sandbox,
    cwd,
    model: model ?? null,
    reasoning: reasoning ?? null,
    sessionId: null,
    startedAt: now(),
    updatedAt: now(),
    running: true,
    launching: true,
    exitCode: null,
    signal: null,
    done: false,
    ok: null,
    errors: [],
    stderr: [],
    stderrTail: [],
    finalText: "",
    rawLineCount: 0,
    lastEventType: null,
    eventTypes: [],
  });
  const result = tmux(["new-session", "-d", "-s", name, "-c", cwd, command]);
  if (result.status !== 0) {
    fail(result.stderr.trim() || result.stdout.trim() || `failed to launch ${name}`);
  }
  return { name, agent, sandbox, cwd, model: model ?? null, reasoning: reasoning ?? null, promptPath, logPath, rawLog, runnerLog, command };
}

function hasTmuxSession(name) {
  if (!name) {
    return false;
  }
  const result = tmux(["has-session", "-t", name]);
  return result.status === 0;
}

function extractField(finalText, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = "[A-Z_]+:";
  const boundary = `(?:^|[\\n;]|(?<=\\S)\\s(?=${marker}))`;
  const pattern = new RegExp(`${boundary}\\s*${escapedField}:\\s*([\\s\\S]*?)(?=(?:[\\n;]|(?<=\\S)\\s(?=${marker}))\\s*${marker}|$)`, "i");
  const match = String(finalText ?? "").match(pattern);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function truncate(text, maxLength = 220) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function summarizeRunLog(run) {
  let name = run.name ?? path.basename(run.log_path ?? "").replace(/\.json$/, "");
  const logPath = run.log_path;
  if (!logPath || !fs.existsSync(logPath)) {
    const tmuxAlive = hasTmuxSession(name);
    return { name, logPath, state: tmuxAlive ? "running" : "missing" };
  }
  const text = fs.readFileSync(logPath, "utf8");
  if (!text.trim()) {
    const tmuxAlive = hasTmuxSession(name);
    return { name, logPath, state: tmuxAlive ? "running" : "empty" };
  }
  try {
    const data = JSON.parse(text);
    name = data.name ? String(data.name) : name;
    const tmuxAlive = hasTmuxSession(name);
    const finalText = data.finalText ?? "";
    const hasExit = data.exitCode !== undefined && data.exitCode !== null;
    const hasSignal = data.signal !== undefined && data.signal !== null;
    const completed = data.done === true || hasExit || hasSignal;
    const stale = data.running === true && !tmuxAlive && !completed;
    const running = !completed && !stale && (data.running === true || tmuxAlive);
    const terminal = !running && completed;
    return {
      name,
      logPath,
      state: terminal ? "done" : running ? "running" : stale ? "stale" : "incomplete",
      ok: stale ? false : data.ok ?? null,
      exitCode: data.exitCode ?? null,
      sessionId: data.sessionId ?? null,
      startedAt: data.startedAt ?? null,
      updatedAt: data.updatedAt ?? null,
      rawLineCount: data.rawLineCount ?? null,
      lastEventType: data.lastEventType ?? null,
      status: extractField(finalText, "STATUS"),
      summary: extractField(finalText, "SUMMARY"),
      changedFiles: extractField(finalText, "CHANGED_FILES"),
      tests: extractField(finalText, "TESTS"),
      next: extractField(finalText, "NEXT"),
      finalText: truncate(finalText, 1200),
      errors: Array.isArray(data.errors) ? data.errors : [],
      stderr: Array.isArray(data.stderr) ? data.stderr : [],
    };
  } catch (error) {
    const tail = text.split(/\r?\n/).slice(-20).join("\n");
    return { name, logPath, state: "unparseable", ok: false, parseError: error?.message ?? String(error), tail };
  }
}

function closeTmux(name) {
  requireCommand("tmux");
  const result = tmux(["kill-session", "-t", name]);
  if (result.status !== 0) {
    if (/no server running|can't find session|can't find window|session not found/i.test(result.stderr)) {
      return { name, closed: false, alreadyClosed: true };
    }
    fail(result.stderr.trim() || `failed to close ${name}`);
  }
  return { name, closed: true, alreadyClosed: false };
}

function commandSpawn(args, opts) {
  const task = getTask(opts, args[0]);
  const agent = String(opts.agent ?? "codex");
  if (!VALID_AGENTS.has(agent)) {
    fail(`--agent must be one of: ${Array.from(VALID_AGENTS).join(", ")}`);
  }
  const sandbox = String(opts.sandbox ?? "read-only");
  if (!VALID_SANDBOXES.has(sandbox)) {
    fail(`--sandbox must be one of: ${Array.from(VALID_SANDBOXES).join(", ")}`);
  }
  const cwd = path.resolve(String(opts.cwd ?? rootDir(opts)));
  const defaults = DEFAULT_AGENT_CONFIG[agent];
  const model = opts.model ? String(opts.model) : defaults.model;
  const reasoning = opts.reasoning ? String(opts.reasoning) : defaults.reasoning;
  const tag = slug(opts.tag ?? "task");
  const project = slug(path.basename(rootDir(opts)));
  const activeRun = one(
    opts,
    `SELECT id, name, status FROM runs
     WHERE task_id = ${q(task.id)} AND status IN ('starting', 'running')
     ORDER BY started_at DESC
     LIMIT 1`
  );
  if (activeRun && !opts.force && !opts["replace-existing"]) {
    fail(`task already has active run ${activeRun.id} (${activeRun.name}); use --force or --replace-existing`);
  }

  const runId = nextId(opts, "run_seq", "RUN");
  const runName = slug(`${project}-${agent}-${tag}-${task.id}-${runId}`);
  const logPath = path.join(runsDir(opts), `${runName}.json`);
  const promptPath = path.join(runsDir(opts), `${runName}.prompt.md`);
  const extraPrompt = [opts.prompt ? String(opts.prompt) : "", opts["prompt-file"] ? readOptionalFile(opts["prompt-file"]) : ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  const prompt = composePrompt({ opts, task, runId, runName, agent, sandbox, cwd, model, reasoning, extraPrompt });
  fs.mkdirSync(runsDir(opts), { recursive: true });
  fs.writeFileSync(promptPath, prompt);

  if (opts["replace-existing"] && !opts["dry-run"]) {
    if (activeRun?.name) {
      spawnSync("tmux", ["kill-session", "-t", activeRun.name], { encoding: "utf8" });
      exec(
        opts,
        `UPDATE runs
         SET status = CASE WHEN status IN ('starting', 'running') THEN 'killed' ELSE status END,
             helper_state = 'replaced',
             updated_at = ${q(now())},
             ended_at = COALESCE(ended_at, ${q(now())})
         WHERE id = ${q(activeRun.id)}`
      );
      addEvent(opts, {
        taskId: task.id,
        type: "replaced",
        message: activeRun.name,
        payload: { replacedRunId: activeRun.id, replacedRunName: activeRun.name },
      });
    }
  }

  const rawLog = `${logPath}.raw.jsonl`;
  const runnerLog = `${logPath}.runner.log`;
  const command = buildWorkerCommand({ name: runName, cwd, agent, sandbox, model, reasoning, promptPath, liveLog: logPath, rawLog, runnerLog });
  const stamp = now();

  exec(
    opts,
    `INSERT INTO runs(id, task_id, name, agent, sandbox, model, reasoning, cwd, command,
                      tmux_session, log_path, raw_log_path, runner_log_path, prompt_path,
                      status, started_at, updated_at)
     VALUES (${q(runId)}, ${q(task.id)}, ${q(runName)}, ${q(agent)}, ${q(sandbox)}, ${q(model)}, ${q(reasoning)},
             ${q(cwd)}, ${q(command)}, ${q(runName)}, ${q(logPath)}, ${q(rawLog)},
             ${q(runnerLog)}, ${q(promptPath)}, ${q(opts["dry-run"] ? "planned" : "starting")},
             ${q(stamp)}, ${q(stamp)})`
  );

  if (opts["dry-run"]) {
    addEvent(opts, {
      taskId: task.id,
      type: "planned",
      message: runName,
      payload: { runId, agent, sandbox, model, reasoning, cwd, logPath },
    });
    print({ dryRun: true, run: one(opts, `SELECT * FROM runs WHERE id = ${q(runId)}`), promptPath, command });
    return;
  }

  updateTaskFields(opts, task.id, { status: "running", assignee: agent }, {
    type: "spawned",
    message: runName,
    payload: { runId, agent, sandbox, model, reasoning, cwd, logPath },
  });

  let launchOutput;
  try {
    launchOutput = launchWorkerTmux({ name: runName, cwd, agent, sandbox, model, reasoning, promptPath, logPath });
  } catch (error) {
    exec(
      opts,
      `UPDATE runs
       SET status = 'failed',
           helper_state = 'launch_failed',
           last_error = ${q(error?.message ?? String(error))},
           updated_at = ${q(now())}
       WHERE id = ${q(runId)}`
    );
    addEvent(opts, {
      taskId: task.id,
      type: "spawn_failed",
      message: error?.message ?? String(error),
      payload: { runId, runName },
    });
    throw error;
  }
  exec(
    opts,
    `UPDATE runs
     SET status = 'running',
         helper_state = 'running',
         command = ${q(launchOutput.command)},
         prompt_path = ${q(launchOutput.promptPath)},
         log_path = ${q(launchOutput.logPath)},
         raw_log_path = ${q(launchOutput.rawLog)},
         runner_log_path = ${q(launchOutput.runnerLog)},
         updated_at = ${q(now())}
     WHERE id = ${q(runId)}`
  );

  addEvent(opts, {
    taskId: task.id,
    type: "worker_running",
    message: runName,
    payload: { runId, launchOutput },
  });
  print({ run: one(opts, `SELECT * FROM runs WHERE id = ${q(runId)}`), task: getTask(opts, task.id), worker: launchOutput });
}

function terminalRunStatus(row, run = null) {
  if (row.state === "running") return "running";
  const finalStatus = String(row.status || run?.final_status || "").toLowerCase();
  const hasValidFinalStatus = ["done", "blocked", "failed"].includes(finalStatus);
  if (row.state === "done" && row.ok !== false && hasValidFinalStatus) return "exited";
  if (["done", "stale", "incomplete", "unparseable", "missing", "empty", "summary_failed"].includes(row.state)) {
    return "failed";
  }
  return "failed";
}

function maybeUpdateTaskFromHarvest(opts, run, row) {
  const task = getTask(opts, run.task_id);
  const finalStatus = String(row.status ?? "").toLowerCase();
  const message = row.summary || row.finalText || row.tail || "";
  if (finalStatus === "blocked") {
    updateTaskFields(opts, task.id, { status: "blocked", blocked_by: row.next || message }, {
      type: "harvest_blocked",
      message,
      payload: { runId: run.id, runName: run.name },
    });
    return;
  }
  if (finalStatus === "failed") {
    updateTaskFields(opts, task.id, { status: "failed" }, {
      type: "harvest_failed",
      message,
      payload: { runId: run.id, runName: run.name },
    });
    return;
  }
  if (finalStatus === "done" && ["running", "ready", "backlog"].includes(task.status)) {
    updateTaskFields(opts, task.id, { status: "review" }, {
      type: "harvest_review",
      message,
      payload: { runId: run.id, runName: run.name },
    });
    return;
  }
  if (!["done", "blocked", "failed"].includes(finalStatus) && task.status === "running") {
    updateTaskFields(opts, task.id, { status: "failed" }, {
      type: "harvest_contract_failed",
      message: message || "Worker exited without a valid final STATUS marker or report.",
      payload: { runId: run.id, runName: run.name },
    });
  }
}

function runHarvestChanged(run, status, row) {
  const helperOk = row.ok === undefined || row.ok === null ? null : row.ok ? 1 : 0;
  const values = {
    status,
    helper_state: row.state ?? null,
    helper_ok: helperOk,
    session_id: row.sessionId ?? run.session_id ?? null,
    final_status: row.status ?? null,
    final_summary: row.summary ?? row.finalText ?? null,
    changed_files: row.changedFiles ?? null,
    tests: row.tests ?? null,
    next: row.next ?? null,
    last_error: Array.isArray(row.errors) && row.errors.length ? row.errors.join("\n") : row.parseError ?? null,
  };
  return Object.entries(values).some(([key, value]) => String(run[key] ?? "") !== String(value ?? ""));
}

function commandHarvest(opts) {
  let where = "status IN ('starting', 'running')";
  if (opts.all) {
    where = "1 = 1";
  }
  if (opts.task) {
    where = `task_id = ${q(normalizeTaskId(opts.task))}`;
  }
  if (opts.run) {
    const run = getRun(opts, opts.run);
    where = `id = ${q(run.id)}`;
  }
  const runs = query(opts, `SELECT * FROM runs WHERE ${where} ORDER BY started_at ASC`);
  const harvested = [];
  for (const run of runs) {
    const row = summarizeRunLog(run);
    const effectiveStatus = row.status || run.final_status || null;
    const effectiveSummary = row.summary || run.final_summary || row.finalText || null;
    const effectiveChangedFiles = row.changedFiles || run.changed_files || null;
    const effectiveTests = row.tests || run.tests || null;
    const effectiveNext = row.next || run.next || null;
    const effectiveRow = {
      ...row,
      status: effectiveStatus,
      summary: effectiveSummary,
      changedFiles: effectiveChangedFiles,
      tests: effectiveTests,
      next: effectiveNext,
    };
    const status = terminalRunStatus(effectiveRow, run);
    const alreadyTerminal = !["starting", "running"].includes(String(run.status));
    const changed = runHarvestChanged(run, status, effectiveRow);
    if (alreadyTerminal && !changed) {
      harvested.push({ run, summary: effectiveRow, unchanged: true });
      continue;
    }
    const endedAt = status === "running" ? null : now();
    exec(
      opts,
      `UPDATE runs
       SET status = ${q(status)},
           helper_state = ${q(row.state ?? null)},
           helper_ok = ${q(row.ok === undefined || row.ok === null ? null : row.ok ? 1 : 0)},
           session_id = ${q(row.sessionId ?? run.session_id ?? null)},
           updated_at = ${q(now())},
           ended_at = COALESCE(ended_at, ${q(endedAt)}),
           final_status = ${q(effectiveStatus)},
           final_summary = ${q(effectiveSummary)},
           changed_files = ${q(effectiveChangedFiles)},
           tests = ${q(effectiveTests)},
           next = ${q(effectiveNext)},
           last_error = ${q(Array.isArray(row.errors) && row.errors.length ? row.errors.join("\\n") : row.parseError ?? null)}
       WHERE id = ${q(run.id)}`
    );
    addEvent(opts, {
      taskId: run.task_id,
      type: status === "running" ? "harvest_running" : "harvested",
      message: effectiveSummary || row.state || "",
      payload: { runId: run.id, runName: run.name, row: effectiveRow },
    });
    if (status !== "running") {
      maybeUpdateTaskFromHarvest(opts, run, effectiveRow);
    }
    harvested.push({ run: one(opts, `SELECT * FROM runs WHERE id = ${q(run.id)}`), summary: effectiveRow });
  }
  print(harvested);
}

function commandSteer(args, opts) {
  const run = getRun(opts, args[0]);
  const message = String(opts.message ?? opts.prompt ?? "");
  if (!message) {
    fail("steer requires --message");
  }
  addEvent(opts, {
    taskId: run.task_id,
    type: opts.replace ? "steer_replace" : "steer_note",
    message,
    payload: { runId: run.id, runName: run.name },
  });
  if (opts.replace) {
    commandSpawn([run.task_id], {
      ...opts,
      agent: run.agent,
      sandbox: run.sandbox,
      cwd: run.cwd,
      model: run.model,
      reasoning: run.reasoning,
      tag: opts.tag ?? "steer",
      prompt: `Steering update for ${run.id} (${run.name}):\n${message}\n\nContinue the same task with this updated instruction. Preserve any useful findings from the previous run if they are visible in the task history.`,
      "replace-existing": true,
    });
    return;
  }
  print({
    ok: true,
    run: run.id,
    name: run.name,
    appliedToLiveWorker: false,
    note: "Recorded the steering note. Noninteractive workers do not receive live stdin; rerun with --replace to restart the worker with this message.",
  });
}

function commandClose(args, opts) {
  const run = getRun(opts, args[0]);
  const closed = closeTmux(run.name);
  exec(
    opts,
    `UPDATE runs
     SET status = CASE WHEN status IN ('starting', 'running') THEN 'killed' ELSE status END,
         helper_state = 'closed',
         updated_at = ${q(now())},
         ended_at = COALESCE(ended_at, ${q(now())})
     WHERE id = ${q(run.id)}`
  );
  addEvent(opts, {
    taskId: run.task_id,
    type: "closed",
    message: run.name,
    payload: { runId: run.id, close: closed },
  });
  print({ ok: true, close: closed, run: one(opts, `SELECT * FROM runs WHERE id = ${q(run.id)}`) });
}

async function main() {
  const { command, args, opts } = parseArgv(process.argv.slice(2));
  if (!command || command === "help" || opts.help) {
    usage();
    process.exit(command ? 0 : 1);
  }

  if (command === "init") commandInit(opts);
  else if (command === "worker-run") {
    const cwd = path.resolve(String(opts.cwd ?? process.cwd()));
    const agent = String(opts.agent ?? "");
    const sandbox = String(opts.sandbox ?? "");
    if (!VALID_AGENTS.has(agent)) {
      fail(`--agent must be one of: ${Array.from(VALID_AGENTS).join(", ")}`);
    }
    if (!VALID_SANDBOXES.has(sandbox)) {
      fail(`--sandbox must be one of: ${Array.from(VALID_SANDBOXES).join(", ")}`);
    }
    const promptFile = opts["prompt-file"] ? path.resolve(cwd, String(opts["prompt-file"])) : null;
    const prompt = promptFile ? fs.readFileSync(promptFile, "utf8") : opts.prompt ? String(opts.prompt) : "";
    await runStructuredWorker({
      agent,
      sandbox,
      cwd,
      prompt,
      model: opts.model ? String(opts.model) : null,
      reasoning: opts.reasoning ? String(opts.reasoning) : null,
      liveLog: opts["live-log"] ? path.resolve(cwd, String(opts["live-log"])) : null,
      rawLog: opts["raw-log"] ? path.resolve(cwd, String(opts["raw-log"])) : null,
    });
  }
  else if (command === "add") commandAdd(args, opts);
  else if (command === "list") commandList(opts);
  else if (command === "show") commandShow(args, opts);
  else if (command === "claim") commandClaim(args, opts);
  else if (command === "report") commandReport(args, opts);
  else if (command === "update") commandUpdate(args, opts);
  else if (command === "block") commandTransition(args, opts, "blocked", "blocked", "reason");
  else if (command === "done") commandTransition(args, opts, "done", "done", "note");
  else if (command === "review") commandTransition(args, opts, "review", "review", "note");
  else if (command === "fail") commandTransition(args, opts, "failed", "failed", "reason");
  else if (command === "cancel") commandTransition(args, opts, "canceled", "canceled", "reason");
  else if (command === "status" || command === "summary") commandStatus(opts);
  else if (command === "runs") commandRuns(opts);
  else if (command === "spawn") commandSpawn(args, opts);
  else if (command === "harvest") commandHarvest(opts);
  else if (command === "steer" || command === "send") commandSteer(args, opts);
  else if (command === "close") commandClose(args, opts);
  else fail(`unknown command: ${command}`);
}

main().catch((error) => fail(error?.stack ?? error?.message ?? String(error)));
