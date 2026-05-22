import * as codex from "./codex.mjs";
import * as claude from "./claude.mjs";
import * as pi from "./pi.mjs";
import { fail } from "../common.mjs";

export const AGENTS = new Map([
  [codex.name, codex],
  [claude.name, claude],
  [pi.name, pi],
]);

export const VALID_AGENTS = new Set(AGENTS.keys());

export function getAgent(name) {
  const agent = AGENTS.get(String(name));
  if (!agent) {
    fail(`--agent must be one of: ${Array.from(VALID_AGENTS).join(", ")}`);
  }
  return agent;
}

export function defaultConfig(agentName) {
  return getAgent(agentName).defaults;
}

export function buildAgentRunArgs({ agent, sandbox, cwd, prompt, model, reasoning, systemPrompt }) {
  return getAgent(agent).buildArgs({ sandbox, cwd, prompt, model, reasoning, systemPrompt });
}

export function eventAction(agent, event) {
  return getAgent(agent).eventAction(event);
}
