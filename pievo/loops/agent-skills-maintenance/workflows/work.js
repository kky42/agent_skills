export const meta = { name: 'agent_skills_maintenance_work', description: 'Review skill maintenance debt under mirror/owned policy and leave durable evidence' };

phase('maintenance-review');
const r = await agent(
  `You are maintaining the agent_skills repo copy at ${args.run.workspace_dir}.\n\n` +
  `Goal: make the repository pass the anchored maintenance gate without weakening its ownership model.\n\n` +
  `Required checks to run and record in maintenance/agent-skills-maintenance.md:\n` +
  `- bash -n scripts/skill-sync\n` +
  `- python3 -m py_compile scripts/skill_model.py scripts/skill-deps scripts/thirdparty-update\n` +
  `- python3 -m unittest discover -s tests -p 'test_*.py'\n` +
  `- ./scripts/skill-deps check\n` +
  `- ./scripts/skill-deps verify --strict\n` +
  `- ./scripts/skill-sync --check\n` +
  `- Use ./scripts/skill-deps list --format json to inspect ownership and relations.\n` +
  `- Use ./scripts/thirdparty-update <skill> --check --format json for tracked source debt, prioritizing pievo, playwright/opencli/smart-search, and recently changed skills.\n\n` +
  `Ownership policy:\n` +
  `- A mirror is an explicit, exact upstream copy. Only a clean explicit mirror may use --apply, which replaces the whole directory.\n` +
  `- An owned skill is local-authoritative. Never merge or apply an upstream patch/tree into it. Review its scoped source delta, selectively edit only relevant local content, and record accepted/skipped decisions with --record-review.\n` +
  `- Skill/tool dependencies are updated then compatibility-tested; their content is never merged into the dependent skill.\n` +
  `- Legacy source membership does not prove mirror ownership. Do not bulk-classify skills.\n` +
  `- For high-risk chatgpt, verify the static protocol still references GPT-5.5/model selection, playwright-cli, account locking, and VALIDATION.md. Only perform browser/UI probes if already safe and non-disruptive.\n\n` +
  `Edit only relevant repo maintenance files and reviewed skill changes. Do not edit pievo/loops/agent-skills-maintenance/assets/** or loop.json; those are protected evaluators.\n` +
  `Maintain maintenance/agent-skills-maintenance.md with purpose, cadence, metrics, operator actions, and Last maintenance evidence listing commands, results, accepted/skipped source changes, failures, and next actions.\n` +
  `Return concise JSON with patch_summary, commands_run, changed_files, failures, next_actions.`,
  {
    label: 'maintain-skills',
    schema: {
      type: 'object',
      required: ['patch_summary', 'commands_run', 'changed_files', 'failures', 'next_actions'],
      properties: {
        patch_summary: { type: 'string' },
        commands_run: { type: 'array', items: { type: 'string' } },
        changed_files: { type: 'array', items: { type: 'string' } },
        failures: { type: 'array', items: { type: 'string' } },
        next_actions: { type: 'array', items: { type: 'string' } },
        artifacts: { type: 'array', items: { type: 'string' } }
      }
    }
  }
);

return {
  target_kind: 'work',
  status: r.failures && r.failures.length ? 'attention' : 'ok',
  summary: r.patch_summary,
  candidates: [{ candidate_id: 'cand_' + args.run.id, kind: 'workspace_patch', artifact_refs: r.artifacts || [] }],
  local_eval: { verdict: 'unsure', metrics: [], checks: [], feedback: ['Anchored core check is authoritative for keep/discard.'] },
  effect_proposals: []
};
