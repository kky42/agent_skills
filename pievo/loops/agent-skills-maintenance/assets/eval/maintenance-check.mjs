#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const workspace = process.env.PIEVO_CANDIDATE_WORKSPACE || process.argv[2] || process.cwd();
const artifactDir = process.env.PIEVO_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

function run(name, cmd, args, options = {}) {
  const started = Date.now();
  const res = spawnSync(cmd, args, {
    cwd: workspace,
    encoding: 'utf8',
    timeout: options.timeoutMs || 120000,
    maxBuffer: options.maxBuffer || 1024 * 1024 * 8,
    env: { ...process.env, CI: '1', NO_COLOR: '1' }
  });
  return {
    name,
    command: [cmd, ...args].join(' '),
    exitCode: res.status,
    signal: res.signal || null,
    durationMs: Date.now() - started,
    ok: res.status === 0,
    stdoutTail: String(res.stdout || '').slice(-6000),
    stderrTail: String(res.stderr || '').slice(-6000),
    timedOut: Boolean(res.error && res.error.code === 'ETIMEDOUT')
  };
}

function exists(rel) { return fs.existsSync(path.join(workspace, rel)); }
function read(rel) { return fs.readFileSync(path.join(workspace, rel), 'utf8'); }
function json(rel) { return JSON.parse(read(rel)); }

const checks = [];
checks.push(run('bash-n-skill-sync', 'bash', ['-n', 'scripts/skill-sync']));
checks.push(run('py-compile-skill-scripts', 'python3', ['-m', 'py_compile', 'scripts/skill_model.py', 'scripts/skill-deps', 'scripts/thirdparty-update']));
checks.push(run('ownership-policy-tests', 'python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], { timeoutMs: 180000 }));
checks.push(run('skill-model-check', './scripts/skill-deps', ['check', '--format', 'json'], { timeoutMs: 180000 }));
checks.push(run('relation-verify', './scripts/skill-deps', ['verify', '--strict', '--format', 'json'], { timeoutMs: 180000 }));
checks.push(run('skill-sync-check', './scripts/skill-sync', ['--check'], { timeoutMs: 180000 }));

let modelFilesOk = false;
let modelDetail = [];
try {
  const manifest = json('skill-manifest.json');
  const lock = json('skill-lock.json');
  modelFilesOk = manifest.schemaVersion === 1 && lock.schemaVersion === 1 && exists('schemas/skill-manifest.schema.json') && exists('schemas/skill-lock.schema.json');
  modelDetail.push(`manifest skills=${Object.keys(manifest.skills || {}).length}`);
  modelDetail.push(`lock skills=${Object.keys(lock.skills || {}).length}`);
} catch (err) {
  modelDetail.push(String(err && err.message || err));
}

let chatgptOk = false;
let chatgptDetail = [];
try {
  const skill = read('skills/chatgpt/SKILL.md');
  const validationExists = exists('skills/chatgpt/VALIDATION.md');
  chatgptOk = skill.includes('GPT-5.5') && skill.includes('playwright-cli') && skill.includes('chatgpt-pw-lock') && validationExists;
  chatgptDetail.push(`SKILL.md mentions GPT-5.5/playwright-cli/lock=${chatgptOk}`);
  chatgptDetail.push(`VALIDATION.md exists=${validationExists}`);
} catch (err) {
  chatgptDetail.push(String(err && err.message || err));
}

let evidenceOk = false;
let evidenceDetail = [];
try {
  const note = read('maintenance/agent-skills-maintenance.md');
  const required = ['agent-skills-maintenance', 'Cadence', 'Metrics', 'Operator actions', 'Last maintenance evidence'];
  evidenceOk = required.every((value) => note.includes(value));
  evidenceDetail.push(`note bytes=${note.length}`);
} catch (err) {
  evidenceDetail.push(String(err && err.message || err));
}

const metricBool = (value) => value ? 1 : 0;
const scriptsOk = checks.filter((check) => ['bash-n-skill-sync', 'py-compile-skill-scripts', 'ownership-policy-tests'].includes(check.name)).every((check) => check.ok);
const modelCheckRow = checks.find((check) => check.name === 'skill-model-check');
const modelCheckOk = modelCheckRow?.ok === true;
let ownershipMigrationComplete = false;
try {
  const summary = JSON.parse(modelCheckRow?.stdoutTail || '{}');
  ownershipMigrationComplete = summary.explicitOwnership === summary.skills;
  modelDetail.push(`explicit ownership=${summary.explicitOwnership}/${summary.skills}`);
} catch (err) {
  modelDetail.push(`cannot parse model summary: ${String(err && err.message || err)}`);
}
const relationVerifyOk = checks.find((check) => check.name === 'relation-verify')?.ok === true;
const syncOk = checks.find((check) => check.name === 'skill-sync-check')?.ok === true;
const metrics = {
  skill_model_ok: metricBool(modelCheckOk && relationVerifyOk && modelFilesOk && ownershipMigrationComplete),
  sync_ok: metricBool(syncOk),
  scripts_ok: metricBool(scriptsOk),
  chatgpt_static_ok: metricBool(chatgptOk),
  evidence_ok: metricBool(evidenceOk)
};
const report = {
  schema_version: 2,
  run_id: process.env.PIEVO_RUN_ID || null,
  candidate_hash: process.env.PIEVO_CANDIDATE_HASH || null,
  workspace,
  metrics,
  checks,
  modelDetail,
  chatgptDetail,
  evidenceDetail,
  generated_at: new Date().toISOString()
};
fs.writeFileSync(path.join(artifactDir, 'metrics.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(artifactDir, 'maintenance-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
