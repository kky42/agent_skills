import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VALID_TASK_STATUSES = new Set([
  "backlog",
  "ready",
  "running",
  "worker_done",
  "blocked",
  "failed",
  "accepted",
  "rejected",
  "cancelled",
]);

export const LEGACY_STATUS_ALIASES = new Map([
  ["review", "worker_done"],
  ["done", "accepted"],
  ["canceled", "cancelled"],
]);

export const TERMINAL_TASK_STATUSES = new Set([
  "accepted",
  "rejected",
  "failed",
  "cancelled",
  // Legacy rows may still exist in older boards.
  "done",
  "canceled",
]);

export const REVIEW_TASK_STATUSES = new Set(["worker_done", "review"]);
export const VALID_SANDBOXES = new Set(["read-only", "workspace-write", "danger-full-access"]);
export const DEFAULT_SANDBOX = "workspace-write";
export const VALID_WORKER_REPORT_STATUSES = new Set(["done", "blocked", "failed"]);

export const SCRIPT_PATH = fileURLToPath(new URL("../kanban.mjs", import.meta.url));
export const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
export const SQLITE_TIMEOUT_MS = 10_000;
export const SKILL_DIR = path.dirname(SCRIPT_DIR);
export const WORKER_PROMPT_TEMPLATE = path.join(SKILL_DIR, "templates", "worker-system-prompt.md");

export function fail(message, code = 1) {
  console.error(`kanban: ${message}`);
  process.exit(code);
}

export function parseArgv(argv) {
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

export function requireCommand(command) {
  const result = spawnSync("command", ["-v", command], {
    shell: true,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`${command} not found on PATH`);
  }
}

export function rootDir(opts) {
  return path.resolve(String(opts.root ?? process.env.KANBAN_ROOT ?? process.cwd()));
}

export function dbPath(opts) {
  if (opts.db || process.env.KANBAN_DB) {
    return path.resolve(String(opts.db ?? process.env.KANBAN_DB));
  }
  return path.join(rootDir(opts), ".kanban", "kanban.db");
}

export function kanbanDir(opts) {
  return path.dirname(dbPath(opts));
}

export function runsDir(opts) {
  return path.join(kanbanDir(opts), "runs");
}

export function q(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function now() {
  return new Date().toISOString();
}

export function normalizeTaskId(id) {
  const text = String(id ?? "").trim();
  if (!text) {
    fail("task id is required");
  }
  if (/^\d+$/.test(text)) {
    return `TASK-${text}`;
  }
  return text.replace(/^task-/i, "TASK-");
}

export function normalizeRunId(id) {
  const text = String(id ?? "").trim();
  if (!text) {
    fail("run id is required");
  }
  if (/^\d+$/.test(text)) {
    return `RUN-${text}`;
  }
  return text.replace(/^run-/i, "RUN-");
}

export function normalizeTaskStatus(status) {
  const raw = String(status ?? "").trim().toLowerCase().replaceAll("-", "_");
  const normalized = LEGACY_STATUS_ALIASES.get(raw) ?? raw;
  if (!VALID_TASK_STATUSES.has(normalized)) {
    fail(`status must be one of: ${Array.from(VALID_TASK_STATUSES).join(", ")} (legacy aliases: review, done, canceled)`);
  }
  return normalized;
}

export function parseIntOpt(value, fallback = 0) {
  if (value === undefined || value === null || value === true) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    fail(`expected integer, got: ${value}`);
  }
  return parsed;
}

export function print(value, opts = {}) {
  if (opts.quiet && value && typeof value === "object") {
    const compact = {
      ok: value.ok ?? true,
      task: value.task?.id ?? value.task ?? undefined,
      run: value.run?.id ?? value.run ?? undefined,
      name: value.run?.name ?? value.name ?? undefined,
      status: value.task?.status ?? value.status ?? undefined,
      error: value.error ?? undefined,
    };
    console.log(JSON.stringify(Object.fromEntries(Object.entries(compact).filter(([, v]) => v !== undefined))));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

export function slug(value) {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "x";
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function readOptionalFile(filePath, cwd = process.cwd()) {
  if (!filePath) {
    return "";
  }
  const resolved = path.resolve(cwd, String(filePath));
  if (!fs.existsSync(resolved)) {
    fail(`prompt file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, "utf8");
}

export function spawnCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

export function writeJsonAtomic(filePath, value) {
  if (!filePath) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

export function appendText(filePath, text) {
  if (!filePath || !text) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, text);
}

export function parseJsonLine(line) {
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

export function textBlocks(content) {
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

export function ensureDirWritable(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "ok\n");
    fs.unlinkSync(probe);
  } catch (error) {
    fail(`directory is not writable: ${dir}: ${error?.message ?? String(error)}`);
  }
}

export function parseDurationMs(value, fallbackMs) {
  if (value === undefined || value === null || value === true || value === "") {
    return fallbackMs;
  }
  const text = String(value).trim();
  const match = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i);
  if (!match) {
    fail(`invalid duration: ${value}`);
  }
  const amount = Number.parseFloat(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * scale;
}
