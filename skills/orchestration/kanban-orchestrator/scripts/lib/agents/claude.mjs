import { textBlocks } from "../common.mjs";

export const name = "claude";
export const defaults = { model: "deepseek-v4-flash[1m]", reasoning: "low" };

const PERMISSION_MODES = {
  "read-only": "plan",
  "workspace-write": "bypassPermissions",
  "danger-full-access": "bypassPermissions",
};

export function buildArgs({ sandbox, prompt, model, reasoning, systemPrompt }) {
  const args = ["-p", "--output-format", "stream-json", "--permission-mode", PERMISSION_MODES[sandbox]];
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (model) args.push("--model", model);
  if (reasoning) args.push("--effort", reasoning);
  args.push(prompt);
  return args;
}

export function eventAction(event) {
  if (!event || typeof event !== "object") return null;
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
  return null;
}
