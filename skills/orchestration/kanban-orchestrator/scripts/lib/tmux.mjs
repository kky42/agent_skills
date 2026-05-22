import { spawnSync } from "node:child_process";
import { fail, requireCommand, spawnCapture } from "./common.mjs";

export function tmux(args, options = {}) {
  return spawnCapture("tmux", args, { encoding: "utf8", ...options });
}

export function requireTmux() {
  requireCommand("tmux");
}

export function hasTmuxSession(name) {
  if (!name) return false;
  const result = tmux(["has-session", "-t", name]);
  return result.status === 0;
}

export function closeTmux(name) {
  requireTmux();
  const result = tmux(["kill-session", "-t", name]);
  if (result.status !== 0) {
    if (/no server running|can't find session|can't find window|session not found/i.test(result.stderr)) {
      return { name, closed: false, alreadyClosed: true };
    }
    fail(result.stderr.trim() || `failed to close ${name}`);
  }
  return { name, closed: true, alreadyClosed: false };
}

export function launchTmuxSession({ name, cwd, command }) {
  requireTmux();
  const result = spawnSync("tmux", ["new-session", "-d", "-s", name, "-c", cwd, command], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(result.stderr.trim() || result.stdout.trim() || `failed to launch ${name}`);
  }
}
