export const name = "codex";
export const defaults = { model: "gpt-5.5", reasoning: "low" };

export function addReasoning(args, reasoning) {
  if (reasoning) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(reasoning)}`);
  }
}

export function buildArgs({ sandbox, cwd, prompt, model, reasoning }) {
  const args = ["-a", "never", "exec", "--json", "--sandbox", sandbox, "-C", cwd];
  if (model) args.push("--model", model);
  addReasoning(args, reasoning);
  args.push(prompt);
  return args;
}

export function eventAction(event) {
  if (!event || typeof event !== "object") return null;
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
  return null;
}
