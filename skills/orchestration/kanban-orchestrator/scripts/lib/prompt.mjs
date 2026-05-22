import fs from "node:fs";
import { dbPath, SCRIPT_PATH, shellQuote, WORKER_PROMPT_TEMPLATE } from "./common.mjs";

export function composePrompt({ opts, task, runId, runName, agent, sandbox, cwd, model, reasoning, extraPrompt }) {
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

Default spawned workers use workspace-write. Database writes should work when
the --db path is inside your writable cwd. If the sandbox prevents writing to
the kanban database, continue the task and rely on the required final marker.
The orchestrator will harvest your final output from the worker log. A worker
STATUS: done or report --status done moves the task to worker_done; only the
orchestrator accepts or rejects it after verification.

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
