import fs from "node:fs";
import path from "node:path";
import { hasTmuxSession } from "./tmux.mjs";

const REQUIRED_FINAL_FIELDS = ["STATUS", "SUMMARY", "CHANGED_FILES", "TESTS", "NEXT"];

export function extractField(finalText, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = "(?:STATUS|SUMMARY|CHANGED_FILES|TESTS|NEXT):";
  const boundary = `(?:^|[\\n;]|(?<=\\S)\\s(?=${marker}))`;
  const pattern = new RegExp(`${boundary}\\s*${escapedField}:\\s*([\\s\\S]*?)(?=(?:[\\n;]|(?<=\\S)\\s(?=${marker}))\\s*${marker}|$)`, "i");
  const match = String(finalText ?? "").match(pattern);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

export function truncate(text, maxLength = 220) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function contractValidation(row) {
  const status = String(row.status ?? "").toLowerCase();
  const missing = [];
  for (const field of REQUIRED_FINAL_FIELDS) {
    if (!extractFieldMapValue(row, field)) missing.push(field);
  }
  if (!["done", "blocked", "failed"].includes(status)) {
    return { ok: false, missing, reason: "missing or invalid STATUS" };
  }
  if (status === "done" && missing.length) {
    return { ok: false, missing, reason: `missing required final marker fields: ${missing.join(", ")}` };
  }
  if ((status === "blocked" || status === "failed") && !row.summary) {
    return { ok: false, missing: missing.includes("SUMMARY") ? missing : [...missing, "SUMMARY"], reason: "missing SUMMARY" };
  }
  return { ok: true, missing: [], reason: "" };
}

function extractFieldMapValue(row, field) {
  if (field === "STATUS") return row.status;
  if (field === "SUMMARY") return row.summary;
  if (field === "CHANGED_FILES") return row.changedFiles;
  if (field === "TESTS") return row.tests;
  if (field === "NEXT") return row.next;
  return "";
}

export function summarizeRunLog(run) {
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
    const row = {
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
    return { ...row, contract: contractValidation(row) };
  } catch (error) {
    const tail = text.split(/\r?\n/).slice(-20).join("\n");
    return { name, logPath, state: "unparseable", ok: false, parseError: error?.message ?? String(error), tail };
  }
}
