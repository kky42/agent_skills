#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const result = { _: [], skill: [], extension: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    i += 1;
    if (key === "skill" || key === "extension") {
      result[key].push(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readPrompt(value) {
  const text = requireValue(value, "--prompt");
  return fs.existsSync(text) ? fs.readFileSync(text, "utf8") : text;
}

function writePromptFile(sessionDir, promptText, context) {
  const promptPath = path.join(sessionDir, "e2e-prompt.md");
  const skillLines = context.skills.length ? context.skills.map((item) => `- ${item}`).join("\n") : "- none";
  const extensionLines = context.extensions.length ? context.extensions.map((item) => `- ${item}`).join("\n") : "- none";
  const wrapped = `# Pi Agent E2E Invocation Context

This context was added by \`pi-agent-e2e/scripts/run-fresh-pi.mjs\` so the fresh agent can verify how it was launched.

- cwd: ${context.cwd}
- sessionDir: ${context.sessionDir}
- model: ${context.model}
- tools: ${context.tools}
- tools allowlisted with --tools: ${context.toolsAllowlisted}
- explicit skills:
${skillLines}
- explicit extensions:
${extensionLines}
- ambient extensions disabled: ${context.ambientExtensionsDisabled}
- ambient skills disabled: ${context.ambientSkillsDisabled}
- prompt templates disabled: true
- themes disabled: true
- context files disabled: true

# User E2E Prompt

${promptText}
`;
  fs.writeFileSync(promptPath, wrapped);
  return promptPath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = path.resolve(requireValue(opts.cwd, "--cwd"));
  const sessionDir = path.resolve(opts["session-dir"] || path.join(os.tmpdir(), "pi-e2e", "sessions"));
  const model = opts.model || "deepseek/deepseek-v4-flash";
  const hasToolsOverride = Object.prototype.hasOwnProperty.call(opts, "tools");
  if (hasToolsOverride) requireValue(opts.tools, "--tools");
  const defaultTools = "read,bash,edit,write,grep,find,ls";
  const tools = hasToolsOverride ? opts.tools : opts.extension.length ? undefined : defaultTools;
  const skills = opts.skill.map((item) => path.resolve(requireValue(item, "--skill")));
  const extensions = opts.extension.map((item) => path.resolve(requireValue(item, "--extension")));
  fs.mkdirSync(sessionDir, { recursive: true });

  const args = [
    "-p",
    "--model", model,
    "--session-dir", sessionDir,
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-skills",
    "--no-extensions"
  ];

  if (tools) args.push("--tools", tools);
  for (const extension of extensions) args.push("--extension", extension);
  for (const skill of skills) args.push("--skill", skill);

  const context = {
    cwd,
    sessionDir,
    model,
    tools: tools ?? "pi default active tools (no --tools allowlist; explicit extension tools remain available)",
    toolsAllowlisted: Boolean(tools),
    skills,
    extensions,
    ambientExtensionsDisabled: true,
    ambientSkillsDisabled: true
  };
  const promptPath = writePromptFile(sessionDir, readPrompt(opts.prompt), context);
  args.push(`@${promptPath}`);

  const commandRecord = {
    cwd,
    sessionDir,
    command: "pi",
    args,
    promptPath,
    startedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(sessionDir, "command.json"), `${JSON.stringify(commandRecord, null, 2)}\n`);

  const child = spawn("pi", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const stdoutPath = path.join(sessionDir, "stdout.txt");
  const stderrPath = path.join(sessionDir, "stderr.txt");
  const stdout = fs.createWriteStream(stdoutPath, { flags: "a" });
  const stderr = fs.createWriteStream(stderrPath, { flags: "a" });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    stderr.write(chunk);
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  stdout.end();
  stderr.end();

  const completed = {
    ...commandRecord,
    endedAt: new Date().toISOString(),
    exitCode,
    stdoutPath,
    stderrPath
  };
  fs.writeFileSync(path.join(sessionDir, "command.json"), `${JSON.stringify(completed, null, 2)}\n`);
  process.exitCode = exitCode ?? 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
