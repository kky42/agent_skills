---
name: pi-extension-dev
description: Documents how to build and test pi extensions with the pi-agent SDK, including goal steering, persistence, compaction, and real-model end-to-end checks. Use when developing a pi extension, wiring slash commands or tools, or validating extension behavior and performance.
---

# pi Extension Development

Use this skill to build a pi extension or pi package. It especially covers Codex-style goal extensions: thread-scoped, persistent, steerable, and verified by the agent before completion.

## Development loop

1. Use a standard pi package layout: root `index.ts`, `package.json` with `pi.extensions: ["./index.ts"]`, and implementation under `src/`.
2. Put pi-bundled imports in `peerDependencies` with `"*"` when sharing: `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`.
3. Keep test/build tooling in `devDependencies`.
4. Load extension factories in SDK tests with `DefaultResourceLoader({ extensionFactories: [myExtension] })`.
5. Create test sessions with `createAgentSession(...)`.
6. Keep deterministic tests in memory with `SessionManager.inMemory(...)` and `SettingsManager.inMemory(...)`.
7. Persist branch-sensitive tool state in tool result `details`; persist extension/session state that is not part of LLM context in custom entries so it survives reload and compaction.
8. Inject goal or steering context with `before_agent_start`, `context`, or queued messages; do not rewrite user prompts in place.
9. If a command should start work immediately, persist state first, then send a normal kickoff message. Do not send the slash command back to `sendUserMessage`.
10. After a fire-and-forget kickoff, yield one tick and `await ctx.waitForIdle()` before checking downstream state.

## Standard repo shape

```text
my-extension/
  index.ts
  package.json
  src/
    my-extension.ts
  scripts/
    test-package-loading.ts
```

Root `index.ts` should only re-export the extension factory:

```ts
export { default } from "./src/my-extension.ts";
```

The package manifest should expose the root entry:

```json
{
  "type": "module",
  "main": "./index.ts",
  "exports": "./index.ts",
  "keywords": ["pi-package", "pi-extension"],
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

## What to test

- Package loading through `DefaultResourceLoader({ additionalExtensionPaths: ["."] })`.
- Real CLI loading with `pi -e .` and `pi -e /absolute/path/to/repo`.
- Command registration and help text.
- Tool registration and tool responses.
- Slash-command UX for every command and subcommand.
- Tool registration, schemas, prompt snippets/guidelines, error handling, truncation, and renderers when applicable.
- Persistence across turns, `/tree` branch navigation, reload, and compaction.
- For goal-style extensions: `/goal <objective>`, `/goal help`, `/goal pause`, `/goal resume`, `/goal clear`.
- For goal-style extensions: budget handling as a soft steering signal. Assert that the budget transition sends a model-visible steer message, not only a UI notification.
- For goal-style extensions: abort handling. Assert that a user-aborted active goal is persisted as `paused` with no running timer.
- For goal-style extensions: completion only after `update_goal`.

## Deterministic SDK test pattern

```ts
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  extensionFactories: [goalExtension],
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();

const { session } = await createAgentSession({
  cwd,
  agentDir,
  model,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(cwd),
  settingsManager: SettingsManager.inMemory(...),
});
await session.prompt("/goal finish the task");
await session.agent.waitForIdle();
```

Use `registerFauxProvider(...)` when you need stable, repeatable agent output. Subscribe to session events and assert `agent_start`, `turn_start`, `tool_execution_*`, `compaction_*`, and `message_end`.

For steering behavior, capture the faux provider `context.messages` in a response factory and assert the next model call includes the extension-injected steer text. Do not rely on UI notifications as proof that the agent saw the message.

For abort behavior, use a faux response factory that waits briefly and returns an assistant message with `stopReason: "aborted"` when `options.signal.aborted` is set, then call `session.abort()` during the prompt. Verify the latest persisted extension state, not just the event stream.

Add a loader regression test for every extension repo:

```ts
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  additionalExtensionPaths: ["."],
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();
if (loader.getExtensions().errors.length) throw new Error("extension failed to load");
```

## Real end-to-end check

- Read auth, models, and settings from the user's real `~/.pi` state via `getAgentDir()`.
- Resolve the real model with `modelRegistry.find("deepseek", "deepseek-v4-flash")`.
- Run the same scenario against the real SDK path.
- Measure wall-clock time, turn count, token use, and compaction behavior.
- Confirm the persisted state and the user-visible and agent-visible UX match the intended flow. For goal-style extensions, verify: start immediately, stay attached across turns, degrade to `budget_limited` softly, send a wrap-up steering message that the real model follows, pause on manual abort, and require the agent to call `update_goal` for completion.

## Practical checks before shipping

- Commands show explicit forms and handle missing arguments cleanly.
- Tools have strict schemas and return compact model-visible content plus useful `details` for rendering/state.
- State reconstructs correctly after reload, `/tree`, and compaction.
- For goal-style extensions: `/goal <objective>` starts work right away.
- For goal-style extensions: `/goal help` shows explicit forms.
- For goal-style extensions: goal state survives compaction and reappears after it.
- For goal-style extensions: the agent gets one clear wrap-up prompt at budget limit. The prompt should tell it to stop starting new substantive work, summarize progress, list blockers/unverified assumptions, and give one next step.
- For goal-style extensions: manual abort changes the active goal to `paused` and preserves state for `/goal resume`.
- For goal-style extensions: a passed test or exhausted budget is not treated as success by itself.
- `npm run check`, `npm test`, and at least one real `pi -e . -p ...` smoke check pass before handoff.
