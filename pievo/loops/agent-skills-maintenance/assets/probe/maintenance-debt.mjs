#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const workspace = process.argv[2] || process.env.PIEVO_WORKSPACE_DIR || process.cwd();
function run(cmd, args, timeoutMs) {
  const res = spawnSync(cmd, args, { cwd: workspace, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4, env: { ...process.env, CI: '1', NO_COLOR: '1' } });
  return { ok: res.status === 0, status: res.status, signal: res.signal, stdout: String(res.stdout || ''), stderr: String(res.stderr || ''), error: res.error };
}
function exists(rel) { return fs.existsSync(path.join(workspace, rel)); }
function read(rel) { return fs.readFileSync(path.join(workspace, rel), 'utf8'); }
function parsed(output) {
  try { return JSON.parse(output); } catch { return null; }
}

const reasons = [];
if (!exists('maintenance/agent-skills-maintenance.md')) reasons.push('missing_evidence_note');
else if (!read('maintenance/agent-skills-maintenance.md').includes('Last maintenance evidence')) reasons.push('evidence_note_incomplete');

const model = run('./scripts/skill-deps', ['check', '--format', 'json'], 180000);
if (!model.ok) reasons.push('skill_model_failed');
else {
  const summary = parsed(model.stdout);
  if (!summary || summary.explicitOwnership !== summary.skills) reasons.push('ownership_migration_incomplete');
}
const relationVerify = run('./scripts/skill-deps', ['verify', '--strict', '--format', 'json'], 180000);
if (!relationVerify.ok) reasons.push('relation_verify_failed');
const sync = run('./scripts/skill-sync', ['--check'], 180000);
if (!sync.ok) reasons.push('skill_sync_failed');

// Source checks are ownership-aware. Mirror drift is replace debt; owned source
// movement is review debt and must never trigger automatic patch/merge apply.
const listed = run('./scripts/skill-deps', ['list', '--format', 'json'], 180000);
if (!listed.ok) reasons.push('skill_list_failed');
else {
  const rows = parsed(listed.stdout)?.skills || [];
  const names = rows.map((row) => row.name);
  const priority = ['pievo', 'playwright-cli', 'opencli-usage', 'opencli-adapter-author', 'opencli-autofix', 'smart-search'];
  const ordered = [...priority.filter((name) => names.includes(name)), ...names.filter((name) => !priority.includes(name))];
  const sourceTracked = ordered.filter((name) => (rows.find((row) => row.name === name)?.relations || []).some((relation) => ['content-source', 'reference'].includes(relation.type)));
  const checkedNames = sourceTracked.slice(0, 8);
  if (sourceTracked.length > checkedNames.length) reasons.push(`source_check_coverage_incomplete:${sourceTracked.length - checkedNames.length}`);
  for (const skill of checkedNames) {
    const checked = run('./scripts/thirdparty-update', [skill, '--check', '--format', 'json'], 90000);
    if (!checked.ok) {
      reasons.push(`source_check_failed:${skill}`);
      continue;
    }
    const report = parsed(checked.stdout);
    if (!report) {
      reasons.push(`source_check_invalid_json:${skill}`);
      continue;
    }
    for (const source of report.sources || []) {
      if (source.kind === 'mirror' && (source.updateAvailable || source.drift)) reasons.push(`mirror_debt:${skill}`);
      if (source.kind === 'source-review' && source.reviewRequired) reasons.push(`source_review_debt:${skill}:${source.relationId}`);
    }
  }
}

if (reasons.length) {
  console.error(`maintenance debt: ${reasons.join(', ')}`);
  process.exit(10);
}
process.exit(0);
