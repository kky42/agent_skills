---
name: pi-extension-dev
description: Build and validate Pi extensions or packages against the current Pi extension, package, and SDK contracts. Use for extension tools, commands, lifecycle hooks, persistence, compaction, package loading, or SDK tests.
---

# Pi Extension Development

Use the smallest extension or package that owns the requested workflow. Read the installed Pi docs and relevant examples before coding; do not carry behavior forward from an unrelated extension or an old package version.

## Choose the surface

- Use a single extension file for a small local behavior.
- Use a directory when the extension has meaningful internal modules.
- Use a Pi package when extensions, skills, prompts, themes, or runtime dependencies must be shared.
- Put workflow-specific behavior outside Pi core.
- Follow the target repository's existing layout. `index.ts` plus `src/` is an option, not a universal requirement.

For a package, declare resources under `package.json#pi` or use Pi's conventional directories. Put ordinary runtime libraries in `dependencies`. Put Pi-bundled imports in `peerDependencies` with `"*"`:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

Discover the package's real scripts before choosing validation commands; do not assume every package provides `check`, `test`, or a particular build script.

## Extension contract

An extension exports a default factory receiving `ExtensionAPI`. Prefer current native surfaces:

- `pi.registerTool()` for model-callable tools
- `pi.registerCommand()` for slash commands
- lifecycle events such as `session_start`, `before_agent_start`, `context`, `tool_call`, and `session_shutdown`
- `pi.appendEntry()` for durable extension state that must not enter model context
- tool-result `details` for branch-sensitive state reconstructed from the active session branch
- `pi.sendMessage()` or `pi.sendUserMessage()` for explicit steering/follow-up behavior

Do not rewrite stored user prompts to inject hidden state. Keep model-visible and UI-only information separate. Start long-lived resources only when a session or operation needs them, and clean them up idempotently in `session_shutdown`.

Tools must have strict schemas, compact model-visible output, useful structured `details`, cancellation handling, and output truncation. Throw from `execute()` to signal an error. File-mutating custom tools should use Pi's file-mutation queue across the complete read-modify-write window.

## Persistence and session behavior

Test state against the behavior it needs to survive:

- reload
- `/tree` branch navigation
- compaction
- session replacement when applicable

Custom entries persist state but do not enter LLM context. Custom messages do. Reconstruct branch-sensitive state from `ctx.sessionManager.getBranch()` rather than scanning abandoned branches indiscriminately.

For session replacement, use the current runtime or command-context APIs. After replacement, use only the fresh context passed to the replacement callback; captured session-bound objects from the old runtime are stale.

## Deterministic SDK tests

Load extensions through `DefaultResourceLoader`, then create a session with `createAgentSession()`:

```ts
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  extensionFactories: [myExtension],
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
  settingsManager: SettingsManager.inMemory(),
});
```

Use a faux provider when stable model output is required. Subscribe to events and assert the behavior that matters: command handling, message delivery, tool start/end balance, cancellation, persistence, compaction, and final model-visible context. A UI notification is not proof that the model received steering text.

Add a package-loading regression test when shipping a package:

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
if (loader.getExtensions().errors.length) {
  throw new Error("extension failed to load");
}
```

## Real verification

After deterministic tests, run the actual package through the installed Pi version:

1. Test relative and absolute loading with `pi -e`.
2. Exercise every command form and missing-argument path that the extension actually registers.
3. Exercise tool schemas, errors, truncation, rendering, and cancellation where relevant.
4. Verify reload, branch, compaction, and session behavior promised by the extension.
5. Use an available configured model rather than hard-coding a provider/model unless that model is part of the contract.
6. Record wall time, turns, token/cost evidence, and the resulting persisted state for behavior-sensitive changes.

Run a fresh isolated Pi process when package loading, prompts, provider behavior, or model-visible steering is part of the claim. Passing unit tests alone is not evidence that these behaviors work in reality.

## Shipping checklist

- Installed Pi docs and examples were consulted for the touched surfaces.
- Package resources and runtime dependencies are declared correctly.
- Project trust and full-system execution risks are explicit.
- Command help reflects only commands the extension currently implements.
- Deterministic tests cover state transitions and persistence promises.
- The package loads through both SDK and real CLI paths.
- Declared repository scripts pass; no nonexistent universal command is assumed.
- At least one real smoke check covers the user-visible and model-visible workflow.
