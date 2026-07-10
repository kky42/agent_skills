export const meta = { name: 'agent_skills_maintenance_repair', description: 'Repair mechanical failures in the maintenance loop bundle' };
const r = await agent(
  `The agent_skills maintenance pievo loop has a mechanical failure. Work in ${args.run.workspace_dir}. ` +
  `Inspect failure evidence from the run artifacts and repair only loop machinery or safe script drift. Do not weaken the maintenance invariant to hide failures. ` +
  `Do not edit protected evaluator assets unless the failure is truly evaluator drift; if you do, explain why. Return summary, risk, high_risk_changes, next_actions.`,
  {
    label: 'repair-maintenance-loop',
    schema: {
      type: 'object',
      required: ['summary', 'risk', 'high_risk_changes', 'next_actions'],
      properties: {
        summary: { type: 'string' },
        risk: { type: 'string' },
        high_risk_changes: { type: 'array', items: { type: 'string' } },
        next_actions: { type: 'array', items: { type: 'string' } }
      }
    }
  }
);
return { target_kind: 'repair', status: r.high_risk_changes && r.high_risk_changes.length ? 'attention' : 'ok', outcome: r.summary, risk: r.risk, high_risk_changes: r.high_risk_changes, next_actions: r.next_actions };
