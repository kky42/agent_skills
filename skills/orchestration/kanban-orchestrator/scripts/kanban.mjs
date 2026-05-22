#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defaultConfig, VALID_AGENTS } from "./lib/agents/index.mjs";
import {
  DEFAULT_SANDBOX,
  TERMINAL_TASK_STATUSES,
  VALID_SANDBOXES,
  VALID_WORKER_REPORT_STATUSES,
  dbPath,
  ensureDirWritable,
  fail,
  kanbanDir,
  normalizeTaskId,
  normalizeTaskStatus,
  now,
  parseArgv,
  parseDurationMs,
  parseIntOpt,
  print,
  readOptionalFile,
  requireCommand,
  rootDir,
  runsDir,
  slug,
  q,
  SCRIPT_PATH,
} from "./lib/common.mjs";
import {
  addEvent,
  dbExists,
  ensureDb,
  exec,
  getRun,
  getTask,
  nextId,
  one,
  query,
  readQuery,
  readTask,
  updateTaskFields,
} from "./lib/db.mjs";
import { contractValidation, summarizeRunLog } from "./lib/harvest.mjs";
import { composePrompt } from "./lib/prompt.mjs";
import { buildWorkerCommand, initialLiveLog, runStructuredWorker } from "./lib/runner.mjs";
import { closeTmux, launchTmuxSession } from "./lib/tmux.mjs";
import { writeJsonAtomic } from "./lib/common.mjs";

function usage() {
  console.log(`Usage:
  kanban.mjs init [--root DIR] [--db PATH]
  kanban.mjs add TITLE [--body TEXT] [--status ready] [--priority N]
  kanban.mjs list [--status STATUS] [--include-archived]
  kanban.mjs show TASK-ID
  kanban.mjs claim TASK-ID [--run RUN-ID] [--assignee NAME] [--note TEXT]
  kanban.mjs report TASK-ID --status done|blocked|failed --summary TEXT [--run RUN-ID] [--changed-files TEXT] [--tests TEXT] [--next TEXT]
  kanban.mjs update TASK-ID [--status STATUS] [--title TEXT] [--body TEXT] [--priority N] [--assignee NAME] [--note TEXT]
  kanban.mjs block TASK-ID --reason TEXT
  kanban.mjs accept TASK-ID [--note TEXT]
  kanban.mjs reject TASK-ID --reason TEXT
  kanban.mjs done TASK-ID [--note TEXT]        # legacy alias for accept
  kanban.mjs review TASK-ID [--note TEXT]      # legacy alias for worker_done
  kanban.mjs fail TASK-ID --reason TEXT
  kanban.mjs cancel TASK-ID [--reason TEXT]
  kanban.mjs status
  kanban.mjs runs [--status STATUS]
  kanban.mjs spawn TASK-ID --agent codex|claude|pi [--sandbox read-only|workspace-write|danger-full-access] [--cwd DIR] [--tag TAG] [--name NAME] [--model MODEL] [--reasoning LEVEL] [--prompt TEXT|--prompt-file PATH] [--replace-existing] [--dry-run] [--quiet]
  kanban.mjs spawn-many --file wave.jsonl [--quiet]
  kanban.mjs harvest [--task TASK-ID|--run RUN-ID|--all]
  kanban.mjs steer RUN-ID --message TEXT [--replace]
  kanban.mjs send RUN-ID --message TEXT [--replace]
  kanban.mjs close RUN-ID
  kanban.mjs close-stale [--older-than 2h]
  kanban.mjs archive-task TASK-ID [--note TEXT]

Global options:
  --root DIR       Repo/project root. Defaults to the current directory.
  --db PATH        SQLite database path. Defaults to <root>/.kanban/kanban.db.

Most commands print JSON. spawn defaults to --sandbox ${DEFAULT_SANDBOX}.
`);
}

function commandInit(opts) {
  ensureDb(opts);
  print({ ok: true, dbPath: dbPath(opts), kanbanDir: kanbanDir(opts), runsDir: runsDir(opts) });
}

function commandAdd(args, opts) {
  const title = args[0];
  if (!title) fail("add requires TITLE");
  const status = normalizeTaskStatus(String(opts.status ?? "ready"));
  const id = nextId(opts, "task_seq", "TASK");
  const stamp = now();
  exec(
    opts,
    `INSERT INTO tasks(id, title, body, status, priority, assignee, parent_id, blocked_by, created_at, updated_at)
     VALUES (${q(id)}, ${q(title)}, ${q(opts.body ?? "")}, ${q(status)}, ${q(parseIntOpt(opts.priority, 0))},
             ${q(opts.assignee ?? null)}, ${q(opts.parent ?? null)}, ${q(opts["blocked-by"] ?? opts.blockedBy ?? null)},
             ${q(stamp)}, ${q(stamp)})`
  );
  addEvent(opts, { taskId: id, type: "created", message: title, payload: { status, priority: parseIntOpt(opts.priority, 0) } });
  print(getTask(opts, id));
}

function commandList(opts) {
  ensureDb(opts);
  const clauses = [];
  if (opts.status) clauses.push(`status = ${q(normalizeTaskStatus(String(opts.status)))}`);
  if (!opts["include-archived"]) clauses.push("archived_at IS NULL");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = readQuery(
    opts,
    `SELECT id, status, priority, assignee, title, parent_id, blocked_by, archived_at, updated_at
     FROM tasks
     ${where}
     ORDER BY
       CASE status
         WHEN 'running' THEN 1
         WHEN 'blocked' THEN 2
         WHEN 'worker_done' THEN 3
         WHEN 'review' THEN 3
         WHEN 'ready' THEN 4
         WHEN 'backlog' THEN 5
         WHEN 'failed' THEN 6
         WHEN 'rejected' THEN 7
         WHEN 'accepted' THEN 8
         WHEN 'cancelled' THEN 9
         WHEN 'done' THEN 8
         WHEN 'canceled' THEN 9
         ELSE 10
       END,
       priority DESC,
       created_at ASC`
  );
  print(rows);
}

function commandShow(args, opts) {
  const id = normalizeTaskId(args[0]);
  const task = readTask(opts, id);
  const events = readQuery(opts, `SELECT id, actor, type, message, payload_json, created_at FROM task_events WHERE task_id = ${q(id)} ORDER BY id ASC`);
  const runs = readQuery(opts, `SELECT * FROM runs WHERE task_id = ${q(id)} ORDER BY started_at DESC`);
  print({ task, events, runs });
}

function commandUpdate(args, opts) {
  const id = normalizeTaskId(args[0]);
  const fields = {};
  if (opts.status !== undefined) {
    fields.status = normalizeTaskStatus(String(opts.status));
    fields.completed_at = ["accepted", "rejected", "cancelled"].includes(fields.status) ? now() : null;
  }
  if (opts.title !== undefined) fields.title = String(opts.title);
  if (opts.body !== undefined) fields.body = String(opts.body);
  if (opts.priority !== undefined) fields.priority = parseIntOpt(opts.priority);
  if (opts.assignee !== undefined) fields.assignee = String(opts.assignee);
  if (opts["blocked-by"] !== undefined || opts.blockedBy !== undefined) fields.blocked_by = String(opts["blocked-by"] ?? opts.blockedBy);
  if (Object.keys(fields).length === 0 && !opts.note) fail("update requires a field or --note");
  updateTaskFields(opts, id, fields, { type: "updated", message: String(opts.note ?? ""), payload: fields });
  print(getTask(opts, id));
}

function commandClaim(args, opts) {
  const id = normalizeTaskId(args[0]);
  const task = getTask(opts, id);
  const run = opts.run ? getRun(opts, opts.run) : null;
  if (run && run.task_id !== task.id) fail(`${run.id} belongs to ${run.task_id}, not ${task.id}`);
  const assignee = String(opts.assignee ?? run?.agent ?? "worker");
  updateTaskFields(opts, task.id, { status: "running", assignee, blocked_by: null, completed_at: null }, {
    actor: String(opts.actor ?? assignee),
    type: "claimed",
    message: String(opts.note ?? "Started"),
    payload: { runId: run?.id ?? null, runName: run?.name ?? null },
  });
  if (run) {
    exec(opts, `UPDATE runs SET helper_state = CASE WHEN helper_state IS NULL OR helper_state IN ('starting', 'running') THEN 'claimed' ELSE helper_state END, updated_at = ${q(now())} WHERE id = ${q(run.id)}`);
  }
  print({ task: getTask(opts, task.id), run: run ? one(opts, `SELECT * FROM runs WHERE id = ${q(run.id)}`) : null });
}

function commandReport(args, opts) {
  const id = normalizeTaskId(args[0]);
  const task = getTask(opts, id);
  const run = opts.run ? getRun(opts, opts.run) : null;
  if (run && run.task_id !== task.id) fail(`${run.id} belongs to ${run.task_id}, not ${task.id}`);
  const reportStatus = String(opts.status ?? "").toLowerCase();
  if (!VALID_WORKER_REPORT_STATUSES.has(reportStatus)) fail("report --status must be one of: done, blocked, failed");
  const summary = String(opts.summary ?? opts.note ?? "").trim();
  if (!summary) fail("report requires --summary");
  const next = opts.next === undefined ? "" : String(opts.next);
  const taskStatus = reportStatus === "done" ? "worker_done" : reportStatus;
  updateTaskFields(opts, task.id, { status: taskStatus, blocked_by: reportStatus === "blocked" ? (next || summary) : null, completed_at: null }, {
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
    exec(opts, `UPDATE runs SET helper_state = 'reported', final_status = ${q(reportStatus)}, final_summary = ${q(summary)}, changed_files = ${q(opts["changed-files"] ?? opts.changedFiles ?? null)}, tests = ${q(opts.tests ?? null)}, next = ${q(next || null)}, updated_at = ${q(now())} WHERE id = ${q(run.id)}`);
  }
  print({ task: getTask(opts, task.id), run: run ? one(opts, `SELECT * FROM runs WHERE id = ${q(run.id)}`) : null });
}

function commandTransition(args, opts, status, type, messageOption) {
  const id = normalizeTaskId(args[0]);
  const message = String(opts[messageOption] ?? opts.note ?? "");
  if ((type === "blocked" || type === "failed" || type === "rejected") && !message) fail(`${type} requires --${messageOption}`);
  const fields = {
    status,
    blocked_by: status === "blocked" ? message : null,
    completed_at: ["accepted", "rejected", "cancelled"].includes(status) ? now() : null,
  };
  updateTaskFields(opts, id, fields, { type, message });
  print(getTask(opts, id));
}

function commandArchiveTask(args, opts) {
  const id = normalizeTaskId(args[0]);
  updateTaskFields(opts, id, { archived_at: now() }, { type: "archived", message: String(opts.note ?? "") });
  print(getTask(opts, id));
}

function countsByStatus(opts) {
  return readQuery(opts, `SELECT status, COUNT(*) AS count FROM tasks WHERE archived_at IS NULL GROUP BY status ORDER BY status`);
}

function commandStatus(opts) {
  if (!dbExists(opts)) {
    print({ initialized: false, dbPath: dbPath(opts), next: "kanban init" });
    return;
  }
  ensureDb(opts);
  const terminalList = Array.from(TERMINAL_TASK_STATUSES).map(q).join(", ");
  const activeFilter = opts["include-archived"] ? "1 = 1" : "archived_at IS NULL";
  const tasks = readQuery(opts, `SELECT id, status, priority, assignee, title, blocked_by, updated_at FROM tasks WHERE ${activeFilter} AND status NOT IN (${terminalList}) ORDER BY priority DESC, updated_at DESC`);
  const activeRuns = readQuery(opts, `SELECT id, task_id, name, agent, sandbox, model, reasoning, status, helper_state, session_id, updated_at FROM runs WHERE status IN ('starting', 'running') ORDER BY started_at ASC`);
  const recentEvents = readQuery(opts, `SELECT id, task_id, actor, type, message, created_at FROM task_events ORDER BY id DESC LIMIT 20`);
  print({ initialized: true, dbPath: dbPath(opts), counts: countsByStatus(opts), tasks, activeRuns, recentEvents });
}

function commandRuns(opts) {
  const where = opts.status ? `WHERE status = ${q(String(opts.status))}` : "";
  const runs = readQuery(opts, `SELECT id, task_id, name, agent, sandbox, model, reasoning, status, helper_state, helper_ok, session_id, started_at, updated_at, ended_at, final_status, final_summary, changed_files, tests, next, log_path FROM runs ${where} ORDER BY started_at DESC`);
  print(runs);
}

function preflightSpawn(opts, { agent, cwd, promptFile = null }) {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) fail(`cwd is not a directory: ${cwd}`);
  requireCommand("tmux");
  requireCommand(agent);
  ensureDirWritable(runsDir(opts));
  if (promptFile) {
    const resolved = path.resolve(cwd, String(promptFile));
    if (!fs.existsSync(resolved)) fail(`prompt file not found: ${resolved}`);
  }
}

function prepareSpawn(args, opts) {
  const task = getTask(opts, args[0]);
  const agent = String(opts.agent ?? "codex");
  if (!VALID_AGENTS.has(agent)) fail(`--agent must be one of: ${Array.from(VALID_AGENTS).join(", ")}`);
  const sandbox = String(opts.sandbox ?? DEFAULT_SANDBOX);
  if (!VALID_SANDBOXES.has(sandbox)) fail(`--sandbox must be one of: ${Array.from(VALID_SANDBOXES).join(", ")}`);
  const cwd = path.resolve(String(opts.cwd ?? rootDir(opts)));
  preflightSpawn(opts, { agent, cwd, promptFile: opts["prompt-file"] });
  const defaults = defaultConfig(agent);
  const model = opts.model ? String(opts.model) : defaults.model;
  const reasoning = opts.reasoning ? String(opts.reasoning) : defaults.reasoning;
  const activeRun = one(opts, `SELECT id, name, status FROM runs WHERE task_id = ${q(task.id)} AND status IN ('starting', 'running') ORDER BY started_at DESC LIMIT 1`);
  if (activeRun && !opts.force && !opts["replace-existing"]) fail(`task already has active run ${activeRun.id} (${activeRun.name}); use --force or --replace-existing`);
  const runId = nextId(opts, "run_seq", "RUN");
  const runName = slug(opts.name ?? `${slug(path.basename(rootDir(opts)))}-${agent}-${slug(opts.tag ?? "task")}-${task.id}-${runId}`);
  const logPath = path.join(runsDir(opts), `${runName}.json`);
  const promptPath = path.join(runsDir(opts), `${runName}.prompt.md`);
  const extraPrompt = [opts.prompt ? String(opts.prompt) : "", opts["prompt-file"] ? readOptionalFile(opts["prompt-file"], cwd) : ""].map((part) => part.trim()).filter(Boolean).join("\n\n");
  const prompt = composePrompt({ opts, task, runId, runName, agent, sandbox, cwd, model, reasoning, extraPrompt });
  fs.mkdirSync(runsDir(opts), { recursive: true });
  fs.writeFileSync(promptPath, prompt);
  const rawLog = `${logPath}.raw.jsonl`;
  const runnerLog = `${logPath}.runner.log`;
  const command = buildWorkerCommand({ name: runName, cwd, agent, sandbox, model, reasoning, promptPath, liveLog: logPath, rawLog, runnerLog });
  return { task, activeRun, runId, runName, agent, sandbox, cwd, model, reasoning, logPath, promptPath, rawLog, runnerLog, command };
}

function commandSpawn(args, opts) {
  const prepared = prepareSpawn(args, opts);
  const { task, activeRun, runId, runName, agent, sandbox, cwd, model, reasoning, logPath, promptPath, rawLog, runnerLog, command } = prepared;
  const stamp = now();
  exec(opts, `INSERT INTO runs(id, task_id, name, agent, sandbox, model, reasoning, cwd, command, tmux_session, log_path, raw_log_path, runner_log_path, prompt_path, status, started_at, updated_at) VALUES (${q(runId)}, ${q(task.id)}, ${q(runName)}, ${q(agent)}, ${q(sandbox)}, ${q(model)}, ${q(reasoning)}, ${q(cwd)}, ${q(command)}, ${q(runName)}, ${q(logPath)}, ${q(rawLog)}, ${q(runnerLog)}, ${q(promptPath)}, ${q(opts["dry-run"] ? "planned" : "starting")}, ${q(stamp)}, ${q(stamp)})`);
  if (opts["dry-run"]) {
    addEvent(opts, { taskId: task.id, type: "planned", message: runName, payload: { runId, agent, sandbox, model, reasoning, cwd, logPath } });
    print({ dryRun: true, run: one(opts, `SELECT * FROM runs WHERE id = ${q(runId)}`), promptPath, command }, opts);
    return;
  }
  if (opts["replace-existing"] && activeRun?.name) {
    try { closeTmux(activeRun.name); } catch {}
    exec(opts, `UPDATE runs SET status = CASE WHEN status IN ('starting', 'running') THEN 'killed' ELSE status END, helper_state = 'replaced', updated_at = ${q(now())}, ended_at = COALESCE(ended_at, ${q(now())}) WHERE id = ${q(activeRun.id)}`);
    addEvent(opts, { taskId: task.id, type: "replaced", message: activeRun.name, payload: { replacedRunId: activeRun.id, replacedRunName: activeRun.name } });
  }
  updateTaskFields(opts, task.id, { status: "running", assignee: agent }, { type: "spawned", message: runName, payload: { runId, agent, sandbox, model, reasoning, cwd, logPath } });
  try {
    writeJsonAtomic(logPath, initialLiveLog({ name: runName, agent, sandbox, cwd, model, reasoning }));
    launchTmuxSession({ name: runName, cwd, command });
  } catch (error) {
    exec(opts, `UPDATE runs SET status = 'failed', helper_state = 'launch_failed', last_error = ${q(error?.message ?? String(error))}, updated_at = ${q(now())} WHERE id = ${q(runId)}`);
    addEvent(opts, { taskId: task.id, type: "spawn_failed", message: error?.message ?? String(error), payload: { runId, runName } });
    throw error;
  }
  exec(opts, `UPDATE runs SET status = 'running', helper_state = 'running', updated_at = ${q(now())} WHERE id = ${q(runId)}`);
  addEvent(opts, { taskId: task.id, type: "worker_running", message: runName, payload: { runId, agent, sandbox, model, reasoning, cwd, logPath } });
  print({ run: one(opts, `SELECT * FROM runs WHERE id = ${q(runId)}`), task: getTask(opts, task.id), worker: { name: runName, agent, sandbox, cwd, model, reasoning, promptPath, logPath, rawLog, runnerLog, command } }, opts);
}

function commandSpawnMany(_args, opts) {
  const file = opts.file ? path.resolve(String(opts.file)) : null;
  if (!file) fail("spawn-many requires --file wave.jsonl");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const results = [];
  for (const [idx, line] of lines.entries()) {
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      const result = { line: idx + 1, ok: false, error: `invalid JSON: ${error?.message ?? String(error)}` };
      results.push(result);
      console.log(JSON.stringify(result));
      continue;
    }
    const task = row.task ?? row.task_id ?? row.id;
    const childArgs = ["spawn", String(task ?? "")];
    addArg(childArgs, "root", opts.root);
    addArg(childArgs, "db", opts.db);
    addArg(childArgs, "agent", row.agent ?? opts.agent);
    addArg(childArgs, "sandbox", row.sandbox ?? opts.sandbox);
    addArg(childArgs, "cwd", row.cwd ?? opts.cwd);
    addArg(childArgs, "tag", row.tag ?? opts.tag);
    addArg(childArgs, "name", row.name ?? opts.name);
    addArg(childArgs, "model", row.model ?? opts.model);
    addArg(childArgs, "reasoning", row.reasoning ?? opts.reasoning);
    addArg(childArgs, "prompt", row.prompt ?? opts.prompt);
    addArg(childArgs, "prompt-file", row.prompt_file ?? row.promptFile ?? opts["prompt-file"]);
    if (row.replace_existing || row.replaceExisting || opts["replace-existing"]) childArgs.push("--replace-existing");
    if (row.dry_run || row.dryRun || opts["dry-run"]) childArgs.push("--dry-run");
    childArgs.push("--quiet");
    const child = spawnSync(process.execPath, [SCRIPT_PATH, ...childArgs], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    if (child.stdout.trim()) process.stdout.write(child.stdout.endsWith("\n") ? child.stdout : `${child.stdout}\n`);
    if (child.stderr.trim()) process.stderr.write(child.stderr.endsWith("\n") ? child.stderr : `${child.stderr}\n`);
    const parsed = child.stdout.trim().split(/\r?\n/).filter(Boolean).map((item) => {
      try { return JSON.parse(item); } catch { return null; }
    }).find(Boolean);
    const result = child.status === 0
      ? { line: idx + 1, task, ok: true, run: parsed?.run, name: parsed?.name }
      : { line: idx + 1, task, ok: false, error: child.stderr.trim() || child.stdout.trim() || `spawn exited ${child.status}` };
    results.push(result);
    if (child.status !== 0 && !child.stdout.trim()) console.log(JSON.stringify(result));
  }
  if (!opts.quiet) print(results);
}

function addArg(args, key, value) {
  if (value !== undefined && value !== null && value !== true && value !== "") {
    args.push(`--${key}`, String(value));
  }
}

function terminalRunStatus(row, run = null) {
  if (row.state === "running") return "running";
  const finalStatus = String(row.status || run?.final_status || "").toLowerCase();
  const contract = row.contract ?? contractValidation(row);
  if (row.state === "done" && row.ok !== false && ["done", "blocked", "failed"].includes(finalStatus) && contract.ok) return "exited";
  if (["done", "stale", "incomplete", "unparseable", "missing", "empty", "summary_failed"].includes(row.state)) return "failed";
  return "failed";
}

function maybeUpdateTaskFromHarvest(opts, run, row) {
  const task = getTask(opts, run.task_id);
  const finalStatus = String(row.status ?? "").toLowerCase();
  const message = row.summary || row.finalText || row.tail || "";
  const contract = row.contract ?? contractValidation(row);
  if (!contract.ok) {
    updateTaskFields(opts, task.id, { status: "failed" }, { type: "harvest_contract_failed", message: contract.reason || message || "Worker final marker failed contract validation.", payload: { runId: run.id, runName: run.name, contract } });
    return;
  }
  if (finalStatus === "blocked") {
    updateTaskFields(opts, task.id, { status: "blocked", blocked_by: row.next || message }, { type: "harvest_blocked", message, payload: { runId: run.id, runName: run.name } });
    return;
  }
  if (finalStatus === "failed") {
    updateTaskFields(opts, task.id, { status: "failed" }, { type: "harvest_failed", message, payload: { runId: run.id, runName: run.name } });
    return;
  }
  if (finalStatus === "done" && ["running", "ready", "backlog"].includes(task.status)) {
    updateTaskFields(opts, task.id, { status: "worker_done" }, { type: "harvest_worker_done", message, payload: { runId: run.id, runName: run.name } });
  }
}

function runHarvestChanged(run, status, row) {
  const helperOk = row.ok === undefined || row.ok === null ? null : row.ok ? 1 : 0;
  const values = { status, helper_state: row.state ?? null, helper_ok: helperOk, session_id: row.sessionId ?? run.session_id ?? null, final_status: row.status ?? null, final_summary: row.summary ?? row.finalText ?? null, changed_files: row.changedFiles ?? null, tests: row.tests ?? null, next: row.next ?? null, last_error: Array.isArray(row.errors) && row.errors.length ? row.errors.join("\n") : row.parseError ?? row.contract?.reason ?? null };
  return Object.entries(values).some(([key, value]) => String(run[key] ?? "") !== String(value ?? ""));
}

function commandHarvest(opts) {
  let where = "status IN ('starting', 'running')";
  if (opts.all) where = "1 = 1";
  if (opts.task) where = `task_id = ${q(normalizeTaskId(opts.task))}`;
  if (opts.run) where = `id = ${q(getRun(opts, opts.run).id)}`;
  const runs = query(opts, `SELECT * FROM runs WHERE ${where} ORDER BY started_at ASC`);
  const harvested = [];
  for (const run of runs) {
    const row = summarizeRunLog(run);
    const effectiveRow = { ...row, status: row.status || run.final_status || null, summary: row.summary || run.final_summary || row.finalText || null, changedFiles: row.changedFiles || run.changed_files || null, tests: row.tests || run.tests || null, next: row.next || run.next || null };
    effectiveRow.contract = contractValidation(effectiveRow);
    const status = terminalRunStatus(effectiveRow, run);
    const alreadyTerminal = !["starting", "running"].includes(String(run.status));
    const changed = runHarvestChanged(run, status, effectiveRow);
    if (alreadyTerminal && !changed) {
      harvested.push({ run, summary: effectiveRow, unchanged: true });
      continue;
    }
    const endedAt = status === "running" ? null : now();
    exec(opts, `UPDATE runs SET status = ${q(status)}, helper_state = ${q(row.state ?? null)}, helper_ok = ${q(row.ok === undefined || row.ok === null ? null : row.ok ? 1 : 0)}, session_id = ${q(row.sessionId ?? run.session_id ?? null)}, updated_at = ${q(now())}, ended_at = COALESCE(ended_at, ${q(endedAt)}), final_status = ${q(effectiveRow.status)}, final_summary = ${q(effectiveRow.summary)}, changed_files = ${q(effectiveRow.changedFiles)}, tests = ${q(effectiveRow.tests)}, next = ${q(effectiveRow.next)}, last_error = ${q(Array.isArray(row.errors) && row.errors.length ? row.errors.join("\n") : row.parseError ?? effectiveRow.contract?.reason ?? null)} WHERE id = ${q(run.id)}`);
    addEvent(opts, { taskId: run.task_id, type: status === "running" ? "harvest_running" : "harvested", message: effectiveRow.summary || row.state || "", payload: { runId: run.id, runName: run.name, row: effectiveRow } });
    if (status !== "running") maybeUpdateTaskFromHarvest(opts, run, effectiveRow);
    harvested.push({ run: one(opts, `SELECT * FROM runs WHERE id = ${q(run.id)}`), summary: effectiveRow });
  }
  print(harvested);
}

function commandSteer(args, opts) {
  const run = getRun(opts, args[0]);
  const message = String(opts.message ?? opts.prompt ?? "");
  if (!message) fail("steer requires --message");
  addEvent(opts, { taskId: run.task_id, type: opts.replace ? "steer_replace" : "steer_note", message, payload: { runId: run.id, runName: run.name } });
  if (opts.replace) {
    commandSpawn([run.task_id], { ...opts, agent: run.agent, sandbox: run.sandbox, cwd: run.cwd, model: run.model, reasoning: run.reasoning, tag: opts.tag ?? "steer", prompt: `Steering update for ${run.id} (${run.name}):\n${message}\n\nContinue the same task with this updated instruction. Preserve any useful findings from the previous run if they are visible in the task history.`, "replace-existing": true });
    return;
  }
  print({ ok: true, run: run.id, name: run.name, appliedToLiveWorker: false, note: "Recorded the steering note. Noninteractive workers do not receive live stdin; rerun with --replace to restart the worker with this message." });
}

function commandClose(args, opts) {
  const run = getRun(opts, args[0]);
  const closed = closeTmux(run.name);
  exec(opts, `UPDATE runs SET status = CASE WHEN status IN ('starting', 'running') THEN 'killed' ELSE status END, helper_state = 'closed', updated_at = ${q(now())}, ended_at = COALESCE(ended_at, ${q(now())}) WHERE id = ${q(run.id)}`);
  addEvent(opts, { taskId: run.task_id, type: "closed", message: run.name, payload: { runId: run.id, close: closed } });
  print({ ok: true, close: closed, run: one(opts, `SELECT * FROM runs WHERE id = ${q(run.id)}`) });
}

function commandCloseStale(opts) {
  const olderMs = parseDurationMs(opts["older-than"], 2 * 60 * 60 * 1000);
  const cutoff = new Date(Date.now() - olderMs).toISOString();
  const runs = query(opts, `SELECT * FROM runs WHERE status IN ('starting', 'running') AND updated_at < ${q(cutoff)} ORDER BY updated_at ASC`);
  const closed = [];
  for (const run of runs) {
    try { closed.push({ run: run.id, ...closeTmux(run.name) }); } catch (error) { closed.push({ run: run.id, name: run.name, error: error?.message ?? String(error) }); }
    exec(opts, `UPDATE runs SET status = 'killed', helper_state = 'stale_closed', updated_at = ${q(now())}, ended_at = COALESCE(ended_at, ${q(now())}) WHERE id = ${q(run.id)}`);
    addEvent(opts, { taskId: run.task_id, type: "stale_closed", message: run.name, payload: { runId: run.id } });
  }
  print(closed);
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
    if (!VALID_AGENTS.has(agent)) fail(`--agent must be one of: ${Array.from(VALID_AGENTS).join(", ")}`);
    if (!VALID_SANDBOXES.has(sandbox)) fail(`--sandbox must be one of: ${Array.from(VALID_SANDBOXES).join(", ")}`);
    const promptFile = opts["prompt-file"] ? path.resolve(cwd, String(opts["prompt-file"])) : null;
    const prompt = promptFile ? fs.readFileSync(promptFile, "utf8") : opts.prompt ? String(opts.prompt) : "";
    await runStructuredWorker({ agent, sandbox, cwd, prompt, model: opts.model ? String(opts.model) : null, reasoning: opts.reasoning ? String(opts.reasoning) : null, liveLog: opts["live-log"] ? path.resolve(cwd, String(opts["live-log"])) : null, rawLog: opts["raw-log"] ? path.resolve(cwd, String(opts["raw-log"])) : null });
  }
  else if (command === "add") commandAdd(args, opts);
  else if (command === "list") commandList(opts);
  else if (command === "show") commandShow(args, opts);
  else if (command === "claim") commandClaim(args, opts);
  else if (command === "report") commandReport(args, opts);
  else if (command === "update") commandUpdate(args, opts);
  else if (command === "block") commandTransition(args, opts, "blocked", "blocked", "reason");
  else if (command === "accept" || command === "done") commandTransition(args, opts, "accepted", command === "done" ? "accepted_legacy_done" : "accepted", "note");
  else if (command === "reject") commandTransition(args, opts, "rejected", "rejected", "reason");
  else if (command === "review") commandTransition(args, opts, "worker_done", "worker_done_legacy_review", "note");
  else if (command === "fail") commandTransition(args, opts, "failed", "failed", "reason");
  else if (command === "cancel") commandTransition(args, opts, "cancelled", "cancelled", "reason");
  else if (command === "status" || command === "summary") commandStatus(opts);
  else if (command === "runs") commandRuns(opts);
  else if (command === "spawn") commandSpawn(args, opts);
  else if (command === "spawn-many") commandSpawnMany(args, opts);
  else if (command === "harvest") commandHarvest(opts);
  else if (command === "steer" || command === "send") commandSteer(args, opts);
  else if (command === "close") commandClose(args, opts);
  else if (command === "close-stale") commandCloseStale(opts);
  else if (command === "archive-task") commandArchiveTask(args, opts);
  else fail(`unknown command: ${command}`);
}

main().catch((error) => fail(error?.stack ?? error?.message ?? String(error)));
