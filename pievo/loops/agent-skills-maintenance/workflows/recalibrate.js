export const meta = { name: 'agent_skills_maintenance_recalibrate', description: 'Check whether the maintenance gate still reflects operator intent' };
const r = await agent(
  `Review the loop bundle at ${args.loop.bundle_dir || 'pievo/loops/agent-skills-maintenance'} and the workspace ${args.run.workspace_dir}. ` +
  `Assess whether the gate metrics still measure user-relevant health for agent_skills maintenance: mirror integrity, owned-source review debt, skill/tool dependency and sync health, high-risk ChatGPT currentness evidence, and durable operator notes. ` +
  `Do not edit files. Return outcome, evidence, and recommended_transition.`,
  {
    label: 'recalibrate-maintenance',
    schema: {
      type: 'object',
      required: ['outcome', 'evidence', 'recommended_transition'],
      properties: {
        outcome: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        recommended_transition: { type: 'string' }
      }
    }
  }
);
return { target_kind: 'recalibrate', status: 'ok', outcome: r.outcome, evidence: r.evidence, new_eval_candidate: null, metric_pairs_used: [], recommended_transition: r.recommended_transition };
