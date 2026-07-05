import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const CHATGPT_URL = 'https://chatgpt.com';
const CHATGPT_DOMAIN = 'chatgpt.com';
const PLUGIN_NAME = 'chatgptx';
const RECEIPT_SCHEMA_VERSION = 1;
const DEFAULT_STABLE_SECONDS = 3;
const DEFAULT_HARVEST_TIMEOUT_SECONDS = 120;
const DEFAULT_READ_AFTER_SECONDS = 60;
const DEFAULT_ACCESS_INTERVAL_SECONDS = 30;
const DEFAULT_NORMAL_SUBMIT_INTERVAL_SECONDS = 30;
const DEFAULT_PRO_SUBMIT_INTERVAL_SECONDS = 60;

const COMPOSER_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  '#prompt-textarea[contenteditable="true"]',
  '[aria-label="Chat with ChatGPT"]',
  '[aria-label="与 ChatGPT 聊天"]',
  '[placeholder="Ask anything"]',
  '[placeholder="有问题，尽管问"]',
  '#prompt-textarea',
  '[data-testid="prompt-textarea"]',
];
const COMPOSER_WAIT_SELECTOR = '#prompt-textarea, [data-testid="prompt-textarea"]';
const SEND_BUTTON_SELECTOR = 'button[data-testid="send-button"]:not([disabled])';
const SEND_BUTTON_FALLBACK_SELECTORS = ['#composer-submit-button:not([disabled])'];
const SEND_BUTTON_LABELS = ['Send prompt', 'Send message', 'Send', '发送', '发送消息', '发送提示'];
const CLOSE_SIDEBAR_LABELS = ['Close sidebar', '关闭边栏'];

function unwrap(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new ArgumentError(`${label} cannot be empty`);
  return text;
}

function normalizeBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function requirePositiveInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new ArgumentError(`${label} must be a positive integer`);
  return number;
}

function requireNonNegativeInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new ArgumentError(`${label} must be a non-negative integer`);
  return number;
}

function parseProjectId(value) {
  const raw = requireText(value, 'project id');
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
    try {
      const url = new URL(raw, CHATGPT_URL);
      if (url.protocol !== 'https:' || (url.hostname !== CHATGPT_DOMAIN && !url.hostname.endsWith(`.${CHATGPT_DOMAIN}`))) {
        throw new Error('off-domain');
      }
      const match = url.pathname.match(/^\/g\/g-p-([a-f0-9]{8,})(?:[-/]|$)/i);
      if (match) return match[1].toLowerCase();
    } catch {
      // fall through
    }
    throw new ArgumentError('project must be a ChatGPT project id or /g/g-p-<id> URL');
  }
  const slugMatch = raw.match(/^g-p-([a-f0-9]{8,})/i);
  if (slugMatch) return slugMatch[1].toLowerCase();
  if (/^[a-f0-9]{8,}$/i.test(raw)) return raw.toLowerCase();
  throw new ArgumentError('project must be a ChatGPT project id or /g/g-p-<id> URL');
}

function parseConversationUrl(value) {
  const raw = requireText(value, 'conversation');
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || (url.hostname !== CHATGPT_DOMAIN && !url.hostname.endsWith(`.${CHATGPT_DOMAIN}`))) {
      throw new ArgumentError('conversation URL must be on chatgpt.com');
    }
    if (!/^\/(?:g\/g-p-[^/]+\/)?c\/[A-Za-z0-9_-]{8,}/.test(url.pathname)) {
      throw new ArgumentError('conversation URL must point to a ChatGPT /c/<id> conversation');
    }
    return url.href;
  }
  if (raw.startsWith('/')) return new URL(raw, CHATGPT_URL).href;
  if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) return `${CHATGPT_URL}/c/${raw}`;
  throw new ArgumentError('conversation must be a ChatGPT conversation id or URL');
}

function parseConversationId(value) {
  const url = parseConversationUrl(value);
  const match = new URL(url).pathname.match(/\/(?:g\/g-p-[^/]+\/)?c\/([A-Za-z0-9_-]{8,})/);
  if (!match) throw new ArgumentError('conversation must be a ChatGPT conversation id or URL');
  return match[1];
}

async function sleep(page, seconds) {
  await page.wait(seconds);
}

function nowIso() {
  return new Date().toISOString();
}

function isoAfterSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function shortHash(text, length = 12) {
  return hashText(text).slice(0, length);
}

function sanitizeJobId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(raw)) {
    throw new ArgumentError('job id may only contain letters, numbers, underscore, dash, colon, and dot');
  }
  return raw;
}

function makeJobId(prompt, kwargs = {}) {
  const explicit = sanitizeJobId(kwargs['job-id'] || kwargs.jobId || '');
  if (explicit) return explicit;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const seed = [stamp, process.pid, prompt, kwargs.github ? 'github' : '', kwargs.project || '', kwargs.conversation || ''].join('\n');
  return `cgx-${stamp}-${shortHash(seed, 8)}`;
}

function expandTilde(value) {
  const text = String(value || '').trim();
  if (!text) return text;
  if (text === '~') return os.homedir();
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2));
  return text;
}

function stateRoot() {
  const explicit = process.env.CHATGPTX_STATE_DIR;
  if (explicit) return path.resolve(expandTilde(explicit));
  const xdg = process.env.XDG_STATE_HOME ? path.resolve(expandTilde(process.env.XDG_STATE_HOME)) : path.join(os.homedir(), '.local', 'state');
  return path.join(xdg, PLUGIN_NAME);
}

function defaultReceiptDir() {
  return path.join(stateRoot(), 'receipts');
}

function receiptDirFromKwargs(kwargs = {}) {
  const dir = kwargs['receipt-dir'] || kwargs.receiptDir;
  return dir ? path.resolve(expandTilde(dir)) : defaultReceiptDir();
}

function outputPathForJob(jobId, kwargs = {}) {
  const explicit = String(kwargs.output || '').trim();
  if (explicit) return path.resolve(expandTilde(explicit));
  return path.join(stateRoot(), 'outputs', `${jobId}.md`);
}

function receiptPathForJob(jobId, kwargs = {}) {
  return path.join(receiptDirFromKwargs(kwargs), `${jobId}.json`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeTextAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function appendHistory(receipt, event, fields = {}) {
  const row = { at: nowIso(), event, ...fields };
  receipt.history = Array.isArray(receipt.history) ? receipt.history : [];
  receipt.history.push(row);
  receipt.updatedAt = row.at;
  return receipt;
}

function createReceipt(prompt, kwargs = {}, status = 'queued') {
  const jobId = makeJobId(prompt, kwargs);
  const readAfterSeconds = requireNonNegativeInt(kwargs['read-after'] ?? DEFAULT_READ_AFTER_SECONDS, '--read-after');
  const github = normalizeBooleanFlag(kwargs.github, false);
  const modelTier = modelTierFor(kwargs);
  const accessIntervalSeconds = accessIntervalSecondsFor(kwargs);
  const submitIntervalSeconds = submitIntervalSecondsFor(kwargs);
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    jobId,
    status,
    tag: String(kwargs.tag || '').trim(),
    prompt,
    promptHash: hashText(prompt),
    github,
    modelTier,
    accessIntervalSeconds,
    submitIntervalSeconds,
    rateWait: rateWaitFor(kwargs),
    project: kwargs.project ? String(kwargs.project).trim() : '',
    conversation: kwargs.conversation ? String(kwargs.conversation).trim() : '',
    new: normalizeBooleanFlag(kwargs.new, true),
    conversationUrl: '',
    conversationId: '',
    receiptPath: receiptPathForJob(jobId, kwargs),
    outputPath: outputPathForJob(jobId, kwargs),
    readAfterSeconds,
    readAfterIso: status === 'queued' ? '' : isoAfterSeconds(readAfterSeconds),
    attempts: { send: 0, harvest: 0 },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    error: '',
    history: [],
  };
  appendHistory(receipt, 'created', { status });
  return receipt;
}

function saveReceipt(receipt) {
  if (!receipt.receiptPath) receipt.receiptPath = receiptPathForJob(receipt.jobId);
  writeJsonAtomic(receipt.receiptPath, receipt);
  return receipt;
}

function resolveReceiptRef(ref, kwargs = {}) {
  const raw = requireText(ref, 'receipt');
  const expanded = path.resolve(expandTilde(raw));
  if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) return expanded;
  if (/^[A-Za-z0-9_.:-]{1,120}$/.test(raw)) {
    const byJob = receiptPathForJob(raw, kwargs);
    if (fs.existsSync(byJob) && fs.statSync(byJob).isFile()) return byJob;
  }
  return '';
}

function loadReceiptRef(ref, kwargs = {}) {
  const file = resolveReceiptRef(ref, kwargs);
  if (!file) throw new ArgumentError(`receipt not found: ${ref}`);
  const receipt = readJsonFile(file);
  receipt.receiptPath = receipt.receiptPath || file;
  return receipt;
}

function listReceiptFiles(kwargs = {}) {
  const dir = receiptDirFromKwargs(kwargs);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => path.join(dir, name))
    .filter(file => fs.statSync(file).isFile())
    .sort();
}

function loadReceipts(kwargs = {}) {
  return listReceiptFiles(kwargs).map((file) => {
    try {
      const receipt = readJsonFile(file);
      receipt.receiptPath = receipt.receiptPath || file;
      return receipt;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function isDue(receipt, at = Date.now()) {
  if (!receipt.readAfterIso) return true;
  const time = Date.parse(receipt.readAfterIso);
  return !Number.isFinite(time) || time <= at;
}

function readAfterSecondsFor(receipt, kwargs = {}) {
  return requireNonNegativeInt(receipt.readAfterSeconds ?? kwargs['read-after'] ?? DEFAULT_READ_AFTER_SECONDS, '--read-after');
}

function modelTierFor(primary = {}, secondary = {}) {
  const raw = String(primary.modelTier ?? primary['model-tier'] ?? secondary.modelTier ?? secondary['model-tier'] ?? 'normal').trim().toLowerCase();
  if (!raw || ['normal', 'ordinary', 'default', 'standard'].includes(raw)) return 'normal';
  if (['pro', 'pro-standard', 'pro-extended', 'extended'].includes(raw)) return 'pro';
  throw new ArgumentError('model-tier must be normal or pro');
}

function accessIntervalSecondsFor(primary = {}, secondary = {}) {
  return requireNonNegativeInt(
    primary.accessIntervalSeconds ?? primary['access-interval'] ?? secondary.accessIntervalSeconds ?? secondary['access-interval'] ?? DEFAULT_ACCESS_INTERVAL_SECONDS,
    '--access-interval',
  );
}

function submitIntervalSecondsFor(primary = {}, secondary = {}) {
  const explicit = primary.submitIntervalSeconds ?? primary['submit-interval'] ?? secondary.submitIntervalSeconds ?? secondary['submit-interval'];
  if (explicit != null && explicit !== '') return requireNonNegativeInt(explicit, '--submit-interval');
  return modelTierFor(primary, secondary) === 'pro' ? DEFAULT_PRO_SUBMIT_INTERVAL_SECONDS : DEFAULT_NORMAL_SUBMIT_INTERVAL_SECONDS;
}

function rateWaitFor(primary = {}, secondary = {}) {
  return normalizeBooleanFlag(primary.rateWait ?? primary['rate-wait'] ?? secondary.rateWait ?? secondary['rate-wait'], true);
}

function rateStatePath() {
  return path.join(stateRoot(), 'rate-state.json');
}

function loadRateState() {
  const file = rateStatePath();
  if (!fs.existsSync(file)) return { events: [] };
  try {
    const state = readJsonFile(file);
    state.events = Array.isArray(state.events) ? state.events : [];
    return state;
  } catch {
    return { events: [] };
  }
}

function saveRateState(state) {
  state.updatedAt = nowIso();
  state.events = Array.isArray(state.events) ? state.events.slice(-50) : [];
  writeJsonAtomic(rateStatePath(), state);
  return state;
}

function reserveRateTimestamp(kind, intervalSeconds, reason = '') {
  const now = Date.now();
  const state = loadRateState();
  const key = kind === 'submit' ? 'Submit' : 'Access';
  state[`last${key}At`] = new Date(now).toISOString();
  state[`next${key}AfterIso`] = new Date(now + intervalSeconds * 1000).toISOString();
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.push({ at: state[`last${key}At`], event: `${kind}-reserved`, intervalSeconds, reason });
  saveRateState(state);
  return state;
}

async function paceRateSlot(page, kind, intervalSeconds, wait, reason = '') {
  const key = kind === 'submit' ? 'Submit' : 'Access';
  let state = loadRateState();
  const nextIso = state[`next${key}AfterIso`] || '';
  const nextMs = Date.parse(nextIso);
  const waitSeconds = Number.isFinite(nextMs) ? Math.max(0, Math.ceil((nextMs - Date.now()) / 1000)) : 0;
  if (waitSeconds > 0) {
    if (!wait) {
      throw new CommandExecutionError(`${kind} interval active; next ${kind} after ${nextIso}`);
    }
    await sleep(page, waitSeconds);
  }
  state = reserveRateTimestamp(kind, intervalSeconds, reason);
  return { waitedSeconds: waitSeconds, nextIso: state[`next${key}AfterIso`] };
}

async function paceAccess(page, primary = {}, secondary = {}, reason = '') {
  return paceRateSlot(page, 'access', accessIntervalSecondsFor(primary, secondary), rateWaitFor(primary, secondary), reason);
}

async function paceSubmit(page, primary = {}, secondary = {}, reason = '') {
  return paceRateSlot(page, 'submit', submitIntervalSecondsFor(primary, secondary), rateWaitFor(primary, secondary), reason);
}

function markRateLimited(primary = {}, secondary = {}, context = 'access', text = '') {
  const accessInterval = accessIntervalSecondsFor(primary, secondary);
  const submitInterval = context === 'submit' ? submitIntervalSecondsFor(primary, secondary) : accessInterval;
  const now = Date.now();
  const state = loadRateState();
  const accessNext = now + accessInterval * 1000;
  const submitNext = now + submitInterval * 1000;
  const existingAccess = Date.parse(state.nextAccessAfterIso || '');
  const existingSubmit = Date.parse(state.nextSubmitAfterIso || '');
  state.lastRateLimitAt = new Date(now).toISOString();
  state.nextAccessAfterIso = new Date(Math.max(Number.isFinite(existingAccess) ? existingAccess : 0, accessNext)).toISOString();
  state.nextSubmitAfterIso = new Date(Math.max(Number.isFinite(existingSubmit) ? existingSubmit : 0, submitNext)).toISOString();
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.push({ at: state.lastRateLimitAt, event: 'rate-limit-modal', context, accessInterval, submitInterval, text: String(text || '').slice(0, 500) });
  saveRateState(state);
  return { accessInterval, submitInterval, nextAccessAfterIso: state.nextAccessAfterIso, nextSubmitAfterIso: state.nextSubmitAfterIso };
}

function claimNextReceipt(kwargs, predicate, claimedStatus, event) {
  const release = acquireLock('broker');
  try {
    const receipt = loadReceipts(kwargs)
      .filter(predicate)
      .sort((a, b) => String(a.createdAt || a.updatedAt || '').localeCompare(String(b.createdAt || b.updatedAt || '')))[0];
    if (!receipt) return null;
    receipt.status = claimedStatus;
    receipt.lease = { pid: process.pid, claimedAt: nowIso(), event };
    receipt.error = '';
    appendHistory(receipt, event, { pid: process.pid });
    saveReceipt(receipt);
    return receipt;
  } finally {
    release();
  }
}

function acquireLock(name, ttlSeconds = 900) {
  const lockRoot = path.join(stateRoot(), 'locks');
  ensureDir(lockRoot);
  const lockDir = path.join(lockRoot, `${name}.lock`);
  const owner = {
    pid: process.pid,
    cwd: process.cwd(),
    startedAt: nowIso(),
    ttlSeconds,
  };
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      writeJsonAtomic(path.join(lockDir, 'owner.json'), owner);
      return () => {
        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {}
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      let stale = false;
      let currentOwner = null;
      try {
        currentOwner = readJsonFile(path.join(lockDir, 'owner.json'));
        const ownerStarted = Date.parse(currentOwner.startedAt || '');
        stale = Number.isFinite(ownerStarted) && Date.now() - ownerStarted > ttlSeconds * 1000;
      } catch {
        stale = true;
      }
      if (stale) {
        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {}
        continue;
      }
      if (Date.now() - started > 1000) {
        throw new CommandExecutionError(
          `chatgptx browser/broker lock is busy: ${lockDir}`,
          `Current owner: ${JSON.stringify(currentOwner || {})}`,
        );
      }
    }
  }
}

function receiptRow(receipt, action = '') {
  return {
    JobId: receipt.jobId || '',
    Action: action,
    Status: receipt.status || '',
    Github: receipt.github ? 'true' : 'false',
    ConversationUrl: receipt.conversationUrl || '',
    ReadAfter: receipt.readAfterIso || '',
    Receipt: receipt.receiptPath || '',
    Output: receipt.outputPath || '',
    Error: receipt.error || '',
  };
}

function assertConsultArgs(kwargs) {
  if (kwargs.project && kwargs.conversation) {
    throw new ArgumentError('chatgptx consult cannot use --project and --conversation together');
  }
}

async function currentUrl(page) {
  const url = unwrap(await page.evaluate('window.location.href').catch(() => ''));
  return typeof url === 'string' ? url : '';
}

async function isOnChatGPT(page) {
  const url = await currentUrl(page);
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === CHATGPT_DOMAIN || host.endsWith(`.${CHATGPT_DOMAIN}`);
  } catch {
    return false;
  }
}

async function ensureOnChatGPT(page) {
  if (await isOnChatGPT(page)) return false;
  await page.goto(CHATGPT_URL, { settleMs: 2000 });
  try { await page.wait({ selector: COMPOSER_WAIT_SELECTOR, timeout: 8 }); } catch {}
  return true;
}

async function startNewChat(page) {
  await page.goto(`${CHATGPT_URL}/new`, { settleMs: 2000 });
  try { await page.wait({ selector: COMPOSER_WAIT_SELECTOR, timeout: 8 }); } catch {}
}

async function openConversation(page, value) {
  const url = parseConversationUrl(value);
  await page.goto(url, { settleMs: 2000 });
  try { await page.wait({ selector: COMPOSER_WAIT_SELECTOR, timeout: 8 }); } catch {}
  return url;
}

async function navigateToProject(page, value) {
  const id = parseProjectId(value);
  await page.goto(`${CHATGPT_URL}/g/g-p-${id}/project`, { settleMs: 2500 });
  try { await page.wait({ selector: COMPOSER_WAIT_SELECTOR, timeout: 8 }); } catch {}
  return id;
}

async function navigateForConsult(page, kwargs) {
  if (kwargs.conversation) return { kind: 'conversation', value: await openConversation(page, kwargs.conversation) };
  if (kwargs.project) return { kind: 'project', value: await navigateToProject(page, kwargs.project) };
  if (normalizeBooleanFlag(kwargs.new, true)) {
    await startNewChat(page);
    return { kind: 'new', value: `${CHATGPT_URL}/new` };
  }
  await ensureOnChatGPT(page);
  return { kind: 'current', value: await currentUrl(page) };
}

async function getPageState(page) {
  return unwrap(await page.evaluate(`(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const selectors = ${JSON.stringify(COMPOSER_SELECTORS)};
    const hasComposer = selectors.some(selector => Array.from(document.querySelectorAll(selector)).some(node => node instanceof HTMLElement && isVisible(node)));
    const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    const loginLink = Array.from(document.querySelectorAll('a, button')).find((node) => {
      const label = ((node.innerText || node.textContent || '') + ' ' + (node.getAttribute('aria-label') || '')).trim().toLowerCase();
      return isVisible(node) && /^(log in|login|sign up|sign in)$/.test(label);
    });
    const userMenu = document.querySelector('[data-testid="profile-button"], [aria-label*="Profile"], [aria-label*="Account"], button[id*="headlessui-menu-button"]');
    const hasLoginGate = !!loginLink || /log in to chatgpt|sign up to chatgpt|welcome to chatgpt/i.test(text);
    return { url: location.href, title: document.title, hasComposer, isLoggedIn: hasComposer || !!userMenu || !hasLoginGate, hasLoginGate };
  })()`));
}

async function ensureChatGPTLogin(page, message = 'ChatGPT requires a logged-in browser session.') {
  const state = await getPageState(page);
  if (!state?.isLoggedIn || state?.hasLoginGate) throw new AuthRequiredError(CHATGPT_DOMAIN, message);
  return state;
}

async function getBlockingNotice(page) {
  return unwrap(await page.evaluate(`(() => {
    const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const modal = document.querySelector('#modal-conversation-history-rate-limit, [data-testid="modal-conversation-history-rate-limit"]');
    const dialog = modal || Array.from(document.querySelectorAll('[role="dialog"]')).find(node => /too many requests|temporarily limited/i.test(node.innerText || node.textContent || ''));
    if (!dialog) return { blocked: false, title: '', text: '', button: null };
    const button = Array.from(dialog.querySelectorAll('button')).find(node => isVisible(node) && /got it|ok|知道|好的/i.test(normalize(node.innerText || node.textContent || node.getAttribute('aria-label') || '')))
      || Array.from(document.querySelectorAll('button')).find(node => isVisible(node) && /got it|ok|知道|好的/i.test(normalize(node.innerText || node.textContent || node.getAttribute('aria-label') || '')));
    let point = null;
    if (button instanceof HTMLElement) {
      const rect = button.getBoundingClientRect();
      point = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }
    return { blocked: true, title: 'Too many requests', text: normalize(dialog.innerText || dialog.textContent || ''), button: point };
  })()`).catch(() => ({ blocked: false, title: '', text: '', button: null })));
}

async function dismissBlockingNotice(page, notice) {
  if (!notice?.blocked) return false;
  if (notice.button && typeof page.nativeClick === 'function') {
    await page.nativeClick(Number(notice.button.x), Number(notice.button.y));
  } else {
    await page.evaluate(`(() => {
      const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const button = Array.from(document.querySelectorAll('button')).find(node => /got it|ok|知道|好的/i.test(normalize(node.innerText || node.textContent || node.getAttribute('aria-label') || '')));
      if (button) button.click();
    })()`).catch(() => null);
  }
  await sleep(page, 0.5);
  return true;
}

async function ensureNoBlockingNotice(page, primary = {}, secondary = {}, context = 'access') {
  const notice = await getBlockingNotice(page);
  if (!notice?.blocked) return false;
  await dismissBlockingNotice(page, notice);
  const pace = markRateLimited(primary, secondary, context, notice.text || '');
  const waitSeconds = context === 'submit' ? Math.max(pace.accessInterval, pace.submitInterval) : pace.accessInterval;
  if (!rateWaitFor(primary, secondary)) {
    throw new CommandExecutionError(
      `ChatGPT rate-limit notice dismissed; next ${context} after ${context === 'submit' ? pace.nextSubmitAfterIso : pace.nextAccessAfterIso}`,
      notice.text || 'Wait, then retry.',
    );
  }
  if (waitSeconds > 0) await sleep(page, waitSeconds);
  reserveRateTimestamp('access', pace.accessInterval, `after-rate-limit-${context}`);
  if (context === 'submit') reserveRateTimestamp('submit', pace.submitInterval, `after-rate-limit-${context}`);
  const again = await getBlockingNotice(page);
  if (again?.blocked) {
    await dismissBlockingNotice(page, again);
    throw new CommandExecutionError(
      `ChatGPT is still rate-limited after waiting ${waitSeconds}s`,
      again.text || notice.text || 'Wait longer, then retry.',
    );
  }
  return true;
}

async function ensureComposer(page, message = 'ChatGPT composer is not available on the current page.', primary = {}, secondary = {}) {
  const state = await ensureChatGPTLogin(page, message);
  await ensureNoBlockingNotice(page, primary, secondary, 'access');
  if (!state.hasComposer) throw new CommandExecutionError(message);
  return state;
}

function buildComposerLocatorScript() {
  return `
    const markerAttr = 'data-opencli-chatgptx-composer';
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const findComposer = () => {
      for (const selector of ${JSON.stringify(COMPOSER_SELECTORS)}) {
        const candidates = Array.from(document.querySelectorAll(selector)).filter(node => node instanceof HTMLElement && isVisible(node));
        const node = candidates.find(c => c.isContentEditable) || candidates[0];
        if (node instanceof HTMLElement) {
          document.querySelectorAll('[' + markerAttr + ']').forEach(other => { if (other !== node) other.removeAttribute(markerAttr); });
          node.setAttribute(markerAttr, '1');
          return node;
        }
      }
      return null;
    };
  `;
}

async function closeSidebar(page) {
  await page.evaluate(`(() => {
    const labels = ${JSON.stringify(CLOSE_SIDEBAR_LABELS)};
    const closeBtn = Array.from(document.querySelectorAll('button')).find(b => labels.includes(b.getAttribute('aria-label') || ''));
    if (closeBtn) closeBtn.click();
  })()`).catch(() => null);
}

async function focusComposer(page, { clear = false } = {}) {
  await closeSidebar(page);
  const result = unwrap(await page.evaluate(`(() => {
    ${buildComposerLocatorScript()}
    const composer = findComposer();
    if (!composer) return { ready: false, reason: 'composer not found' };
    composer.focus();
    if (${clear ? 'true' : 'false'}) {
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        composer.value = '';
      } else if (composer.isContentEditable) {
        composer.textContent = '';
        composer.innerHTML = '<p><br></p>';
      } else {
        composer.textContent = '';
      }
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
    }
    composer.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = composer.getBoundingClientRect();
    return {
      ready: true,
      x: Math.round(rect.left + Math.max(8, Math.min(rect.width / 2, rect.width - 8))),
      y: Math.round(rect.top + Math.max(8, Math.min(rect.height / 2, rect.height - 8))),
    };
  })()`));
  if (!result?.ready) throw new CommandExecutionError(result?.reason || 'ChatGPT composer is not ready');
  if (typeof page.nativeClick === 'function') {
    await page.nativeClick(Number(result.x), Number(result.y));
    await sleep(page, 0.2);
  }
  return result;
}

async function typeIntoFocusedComposer(page, text) {
  const value = String(text ?? '');
  if (!value) return;
  try {
    if (typeof page.nativeType === 'function') {
      await page.nativeType(value);
      await page.evaluate(`(() => {
        ${buildComposerLocatorScript()}
        const composer = findComposer();
        if (!composer) return;
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
      })()`).catch(() => null);
      return;
    }
  } catch {
    // fall back below
  }
  await page.evaluate(`(() => {
    ${buildComposerLocatorScript()}
    const composer = findComposer();
    if (!composer) return;
    composer.focus();
    document.execCommand('insertText', false, ${JSON.stringify(value)});
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function clearComposer(page) {
  await focusComposer(page, { clear: true });
}

async function clickPoint(page, point, label) {
  if (!point?.ok && !point?.found) throw new CommandExecutionError(point?.reason || `Could not find ${label}`);
  if (typeof page.nativeClick === 'function') {
    await page.nativeClick(Number(point.x), Number(point.y));
  } else {
    throw new CommandExecutionError(`${label} requires native browser click support`);
  }
}

async function verifyGitHubPill(page) {
  return unwrap(await page.evaluate(`(() => {
    ${buildComposerLocatorScript()}
    const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const composer = findComposer();
    const explicit = Array.from(document.querySelectorAll('[data-inline-selection-pill]'));
    const insideComposer = composer ? Array.from(composer.querySelectorAll('[data-keyword], [data-testid], span, button, div')) : [];
    const nodes = [...explicit, ...insideComposer];
    const pill = nodes.find((node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return false;
      const keyword = normalize(node.getAttribute('data-keyword') || '');
      const testId = normalize(node.getAttribute('data-testid') || '');
      const text = normalize(node.innerText || node.textContent || '');
      const explicitPill = node.hasAttribute('data-inline-selection-pill') || /inline-selection-pill/i.test(testId);
      const inComposer = composer && composer.contains(node);
      return /github/i.test(keyword) || (explicitPill && /github/i.test(text)) || (inComposer && /github/i.test(text) && !/^@github$/i.test(text));
    });
    if (!(pill instanceof HTMLElement)) return { ok: false };
    const rect = pill.getBoundingClientRect();
    return { ok: true, text: normalize(pill.innerText || pill.textContent || pill.getAttribute('data-keyword') || 'GitHub'), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`));
}

async function findGitHubSuggestion(page) {
  return unwrap(await page.evaluate(`(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const scoreNode = (node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return 0;
      const text = normalize(node.innerText || node.textContent || node.getAttribute('aria-label') || '');
      const label = normalize(node.getAttribute('aria-label') || '');
      const role = normalize(node.getAttribute('role') || '');
      const rect = node.getBoundingClientRect();
      if (!/github/i.test(text + ' ' + label)) return 0;
      if (rect.width < 20 || rect.height < 12 || rect.height > 180 || rect.width > 1000) return 0;
      let score = 10;
      if (/^github$/i.test(text) || /^github$/i.test(label)) score += 100;
      if (/access repositories|repositories|repository|code/i.test(text + ' ' + label)) score += 60;
      if (/option|menuitem|button/i.test(role) || node.tagName === 'BUTTON') score += 30;
      if (node.getAttribute('aria-selected') === 'true') score += 20;
      if (node.closest('[role="listbox"], [role="menu"], [cmdk-list], [data-radix-popper-content-wrapper]')) score += 25;
      score += Math.max(0, 30 - Math.min(text.length, 30));
      return score;
    };
    const selectors = [
      '[role="option"]', '[role="menuitem"]', 'button', '[cmdk-item]', '[data-radix-collection-item]',
      '[aria-selected]', '[data-testid]', 'div', 'span'
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (seen.has(node)) continue;
        seen.add(node);
        const score = scoreNode(node);
        if (score > 0) candidates.push({ node, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]?.node;
    if (!(best instanceof HTMLElement)) return { ok: false, reason: 'GitHub connector suggestion not found' };
    best.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = best.getBoundingClientRect();
    return {
      ok: true,
      text: normalize(best.innerText || best.textContent || best.getAttribute('aria-label') || ''),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`));
}

async function selectGitHubConnector(page) {
  if (typeof page.nativeClick !== 'function') throw new CommandExecutionError('GitHub connector selection requires native browser click support.');
  await focusComposer(page, { clear: true });
  await typeIntoFocusedComposer(page, '@github');
  await sleep(page, 0.8);

  let pill = await verifyGitHubPill(page);
  if (pill?.ok) return { selected: true, label: pill.text || 'GitHub', method: 'already-pill' };

  let suggestion = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    suggestion = await findGitHubSuggestion(page);
    if (suggestion?.ok) break;
    await sleep(page, 0.4);
  }
  if (suggestion?.ok) {
    await clickPoint(page, suggestion, 'GitHub connector suggestion');
  } else if (typeof page.nativeKeyPress === 'function') {
    await page.nativeKeyPress('Enter');
  } else {
    throw new CommandExecutionError(suggestion?.reason || 'Could not find a GitHub connector suggestion.');
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(page, 0.5);
    pill = await verifyGitHubPill(page);
    if (pill?.ok) return { selected: true, label: pill.text || 'GitHub', method: suggestion?.ok ? 'click-suggestion' : 'enter' };
  }

  const composerState = unwrap(await page.evaluate(`(() => {
    ${buildComposerLocatorScript()}
    const composer = findComposer();
    return composer ? { text: composer.innerText || composer.textContent || '', html: (composer.innerHTML || '').slice(0, 1000) } : null;
  })()`));
  throw new CommandExecutionError(
    'GitHub connector pill was not created after selecting the GitHub suggestion.',
    `Composer state: ${JSON.stringify(composerState || {})}`,
  );
}

async function findSendButton(page) {
  return unwrap(await page.evaluate(`(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const isUsable = button => button && isVisible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    const labels = ${JSON.stringify(SEND_BUTTON_LABELS)};
    const looksLikeSend = (button) => {
      const label = button.getAttribute('aria-label') || '';
      const text = (button.innerText || button.textContent || '').replace(/\\s+/g, ' ').trim();
      return labels.includes(label) || labels.includes(text) || /send|发送/i.test(label) || /send|发送/i.test(text);
    };
    const form = Array.from(document.querySelectorAll('form')).find(node => node instanceof HTMLElement && isVisible(node));
    const root = form || document.body;
    const primary = root.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)})
      || ${JSON.stringify(SEND_BUTTON_FALLBACK_SELECTORS)}.map(selector => root.querySelector(selector)).find(Boolean);
    const sendBtn = isUsable(primary) ? primary : Array.from(root.querySelectorAll('button')).find(button => looksLikeSend(button) && isUsable(button));
    if (!(sendBtn instanceof HTMLElement)) return { ok: false, reason: 'send button not found or disabled' };
    sendBtn.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = sendBtn.getBoundingClientRect();
    return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`));
}

async function clickSend(page) {
  let button = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    button = await findSendButton(page);
    if (button?.ok) break;
    await sleep(page, 0.5);
  }
  if (!button?.ok) return false;
  if (typeof page.nativeClick === 'function') {
    await page.nativeClick(Number(button.x), Number(button.y));
  } else {
    await page.evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)}) || document.querySelector('#composer-submit-button');
      if (button) button.click();
    })()`);
  }
  return true;
}

async function sendConsultPrompt(page, prompt, { github = false } = {}) {
  await ensureComposer(page, 'chatgptx consult requires a logged-in ChatGPT session with a visible composer.');
  let connector = null;
  if (github) {
    connector = await selectGitHubConnector(page);
    await focusComposer(page, { clear: false });
    await typeIntoFocusedComposer(page, ` ${prompt}`);
  } else {
    await focusComposer(page, { clear: true });
    await typeIntoFocusedComposer(page, prompt);
  }
  const sent = await clickSend(page);
  if (!sent) throw new CommandExecutionError('Failed to send message to ChatGPT; send button was not usable.');
  return connector;
}

async function waitForConversationUrl(page, timeoutSeconds = 30) {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    const url = await currentUrl(page);
    try {
      const id = parseConversationId(url);
      return { conversationId: id, conversationUrl: url };
    } catch {
      await sleep(page, 1);
    }
  }
  throw new CommandExecutionError('ChatGPT did not create a conversation URL after sending the message.');
}

async function isGenerating(page) {
  const value = unwrap(await page.evaluate(`(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);
    if (buttons.some(button => /stop|停止/i.test((button.getAttribute('aria-label') || '') + ' ' + (button.innerText || button.textContent || '')))) return true;
    if (document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]')) return true;
    return !!document.querySelector('[data-testid*="result-streaming"], .result-streaming, [aria-busy="true"]');
  })()`).catch(() => false));
  return !!value;
}

async function waitUntilNotGenerating(page, timeoutSeconds) {
  const start = Date.now();
  while (await isGenerating(page)) {
    if (Date.now() - start > timeoutSeconds * 1000) {
      throw new CommandExecutionError('ChatGPT conversation is still generating; wait for it to finish before sending another message.');
    }
    await sleep(page, 3);
  }
}

async function getVisibleMessages(page) {
  const rows = unwrap(await page.evaluate(`(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const normalize = value => String(value || '')
      .replace(new RegExp(String.fromCharCode(160), 'g'), ' ')
      .replace(new RegExp('[ \\t]+' + String.fromCharCode(10), 'g'), String.fromCharCode(10))
      .replace(new RegExp(String.fromCharCode(10) + '{3,}', 'g'), String.fromCharCode(10) + String.fromCharCode(10))
      .trim();
    const roleOf = (node) => {
      const attr = node.getAttribute('data-message-author-role') || node.getAttribute('data-author') || '';
      if (/assistant/i.test(attr)) return 'Assistant';
      if (/user/i.test(attr)) return 'User';
      const testid = node.getAttribute('data-testid') || '';
      if (/assistant/i.test(testid)) return 'Assistant';
      if (/user/i.test(testid)) return 'User';
      const label = node.getAttribute('aria-label') || '';
      if (/assistant|chatgpt/i.test(label)) return 'Assistant';
      if (/you|user/i.test(label)) return 'User';
      return '';
    };
    let nodes = Array.from(document.querySelectorAll('[data-message-author-role], article[data-testid*="conversation-turn"]'));
    nodes = nodes.filter(node => node instanceof HTMLElement && isVisible(node));
    const rows = [];
    for (const node of nodes) {
      let role = roleOf(node);
      const roleNode = node.querySelector('[data-message-author-role], [data-author]');
      if (!role && roleNode) role = roleOf(roleNode);
      if (!role) continue;
      const contentNode = node.querySelector('[data-message-author-role] .markdown')
        || node.querySelector('.markdown')
        || node.querySelector('[data-message-author-role]')
        || node;
      const text = normalize(contentNode instanceof HTMLElement ? (contentNode.innerText || contentNode.textContent || '') : '');
      if (!text) continue;
      rows.push({ Role: role, Text: text });
    }
    return rows;
  })()`));
  if (!Array.isArray(rows)) throw new CommandExecutionError('ChatGPT message extraction returned malformed data');
  return rows
    .map((row, index) => ({ Index: index + 1, Role: row.Role === 'Assistant' ? 'Assistant' : 'User', Text: String(row.Text || '').trim() }))
    .filter(row => row.Text)
    .filter((row, index, all) => index === 0 || row.Role !== all[index - 1].Role || row.Text !== all[index - 1].Text);
}

function latestAssistantMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].Role === 'Assistant' && messages[index].Text) return messages[index];
  }
  return null;
}

function normalizeMessageText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function messagesAfterReceiptPrompt(messages, receipt) {
  const prompt = normalizeMessageText(receipt.prompt || '');
  if (prompt) {
    const needle = prompt.length > 240 ? prompt.slice(0, 240) : prompt;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const row = messages[index];
      if (row.Role !== 'User') continue;
      const text = normalizeMessageText(row.Text);
      if (text.includes(needle) || prompt.includes(text)) return messages.slice(index + 1);
    }
  }
  const baselineCount = Number.isInteger(receipt.baselineMessageCount) ? Math.max(0, receipt.baselineMessageCount) : 0;
  if (baselineCount > 0) {
    if (messages.length < baselineCount) return [];
    return messages.slice(baselineCount);
  }
  return messages;
}

async function waitForPromptAccepted(page, prompt, baselineCount, timeoutSeconds = 12) {
  const start = Date.now();
  const normalizedPrompt = normalizeMessageText(prompt);
  const needle = normalizedPrompt.length > 240 ? normalizedPrompt.slice(0, 240) : normalizedPrompt;
  while (Date.now() - start < timeoutSeconds * 1000) {
    const messages = await getVisibleMessages(page).catch(() => []);
    const afterBaseline = Number.isInteger(baselineCount) && messages.length >= baselineCount
      ? messages.slice(baselineCount)
      : messages;
    const userSeen = afterBaseline.some(row => row.Role === 'User' && (normalizeMessageText(row.Text).includes(needle) || normalizedPrompt.includes(normalizeMessageText(row.Text))));
    if (userSeen || messages.length > baselineCount) return { messageCount: messages.length, userSeen };
    await sleep(page, 0.5);
  }
  throw new CommandExecutionError('ChatGPT did not show the submitted prompt after clicking send; message may not have been accepted.');
}

async function waitForStableMessages(page, { timeoutSeconds, stableSeconds }) {
  const start = Date.now();
  let lastSnapshot = '';
  let stableSince = 0;
  let lastMessages = [];
  let generating = false;
  for (;;) {
    const messages = await getVisibleMessages(page);
    generating = await isGenerating(page);
    const snapshot = JSON.stringify(messages.map(row => [row.Role, row.Text]));
    if (snapshot === lastSnapshot) {
      if (!stableSince) stableSince = Date.now();
    } else {
      lastSnapshot = snapshot;
      stableSince = Date.now();
    }
    lastMessages = messages;
    const stableFor = Math.floor((Date.now() - stableSince) / 1000);
    if (!generating && stableFor >= stableSeconds) {
      return { messages, generating: false, stableSeconds: stableFor, timedOut: false };
    }
    if (Date.now() - start > timeoutSeconds * 1000) {
      return { messages: lastMessages, generating, stableSeconds: stableFor, timedOut: true };
    }
    await sleep(page, 1);
  }
}

async function harvestReceiptOnPage(page, receipt, kwargs = {}) {
  const timeoutSeconds = requirePositiveInt(kwargs.timeout ?? DEFAULT_HARVEST_TIMEOUT_SECONDS, '--timeout');
  const stableSeconds = requireNonNegativeInt(kwargs.stable ?? DEFAULT_STABLE_SECONDS, '--stable');
  const shouldWait = normalizeBooleanFlag(kwargs.wait, false);
  const readAfterSeconds = readAfterSecondsFor(receipt, kwargs);
  receipt.readAfterSeconds = readAfterSeconds;
  const conversationUrl = receipt.conversationUrl || (receipt.conversation ? parseConversationUrl(receipt.conversation) : '');
  if (!conversationUrl) throw new ArgumentError('receipt has no conversationUrl to harvest');

  receipt.attempts = receipt.attempts || {};
  receipt.attempts.harvest = Number(receipt.attempts.harvest || 0) + 1;
  appendHistory(receipt, 'harvest-start', { conversationUrl });
  receipt.status = 'harvesting';
  receipt.error = '';
  saveReceipt(receipt);

  try {
    await paceAccess(page, receipt, kwargs, 'harvest');
    await page.goto(conversationUrl, { settleMs: 2000 });
    await ensureNoBlockingNotice(page, receipt, kwargs, 'access');
    try { await page.wait({ selector: '[data-message-author-role], article[data-testid*="conversation-turn"]', timeout: 10 }); } catch {}
    await ensureChatGPTLogin(page, 'chatgptx harvest requires a logged-in ChatGPT session.');

    const detail = shouldWait
      ? await waitForStableMessages(page, { timeoutSeconds, stableSeconds })
      : { messages: await getVisibleMessages(page), generating: await isGenerating(page), stableSeconds: 0, timedOut: false };
    const baselineCount = Number.isInteger(receipt.baselineMessageCount) ? Math.max(0, receipt.baselineMessageCount) : 0;
    const candidateMessages = messagesAfterReceiptPrompt(detail.messages, receipt);

    if (!detail.messages.length || !candidateMessages.length) {
      receipt.status = 'sent';
      receipt.readAfterIso = isoAfterSeconds(readAfterSeconds);
      receipt.messageCount = detail.messages.length;
      receipt.generating = !!detail.generating;
      appendHistory(receipt, 'harvest-empty', { readAfterIso: receipt.readAfterIso, baselineMessageCount: baselineCount });
      saveReceipt(receipt);
      return { receipt, done: false, response: '', generating: detail.generating, stableSeconds: detail.stableSeconds };
    }

    const assistant = latestAssistantMessage(candidateMessages);
    if (!assistant || detail.generating || detail.timedOut) {
      receipt.status = 'sent';
      receipt.readAfterIso = isoAfterSeconds(readAfterSeconds);
      receipt.messageCount = detail.messages.length;
      receipt.generating = !!detail.generating;
      appendHistory(receipt, detail.timedOut ? 'harvest-timeout' : 'harvest-pending', { readAfterIso: receipt.readAfterIso, generating: !!detail.generating, baselineMessageCount: baselineCount });
      saveReceipt(receipt);
      return { receipt, done: false, response: assistant?.Text || '', generating: detail.generating, stableSeconds: detail.stableSeconds };
    }

    const response = assistant.Text;
    receipt.status = 'done';
    receipt.readAfterIso = '';
    receipt.responseHash = hashText(response);
    receipt.responseLength = response.length;
    receipt.messageCount = detail.messages.length;
    receipt.generating = false;
    receipt.completedAt = nowIso();
    appendHistory(receipt, 'harvest-done', { responseLength: response.length, outputPath: receipt.outputPath || '', baselineMessageCount: baselineCount });
    if (receipt.outputPath) writeTextAtomic(receipt.outputPath, `${response}\n`);
    saveReceipt(receipt);
    return { receipt, done: true, response, generating: false, stableSeconds: detail.stableSeconds };
  } catch (err) {
    receipt.status = 'sent';
    receipt.readAfterIso = isoAfterSeconds(readAfterSeconds);
    receipt.error = String(err?.message || err);
    appendHistory(receipt, 'harvest-error', { error: receipt.error, readAfterIso: receipt.readAfterIso });
    saveReceipt(receipt);
    throw err;
  }
}

async function sendReceiptOnPage(page, receipt, kwargs = {}) {
  const timeoutSeconds = requirePositiveInt(kwargs.timeout ?? DEFAULT_HARVEST_TIMEOUT_SECONDS, '--timeout');
  const readAfterSeconds = readAfterSecondsFor(receipt, kwargs);
  receipt.readAfterSeconds = readAfterSeconds;
  receipt.attempts = receipt.attempts || {};
  receipt.attempts.send = Number(receipt.attempts.send || 0) + 1;
  receipt.status = 'sending';
  receipt.error = '';
  appendHistory(receipt, 'send-start');
  saveReceipt(receipt);

  await paceAccess(page, receipt, kwargs, 'consult-navigate');
  await navigateForConsult(page, receipt);
  await ensureComposer(page, 'chatgptx consult requires a logged-in ChatGPT session with a visible composer.', receipt, kwargs);
  await waitUntilNotGenerating(page, timeoutSeconds);
  const baselineMessages = await getVisibleMessages(page).catch(() => []);
  receipt.baselineMessageCount = baselineMessages.length;
  receipt.baselineAssistantCount = baselineMessages.filter(row => row.Role === 'Assistant').length;
  appendHistory(receipt, 'baseline-recorded', { baselineMessageCount: receipt.baselineMessageCount, baselineAssistantCount: receipt.baselineAssistantCount });
  saveReceipt(receipt);
  await paceSubmit(page, receipt, kwargs, 'consult-submit');
  await ensureNoBlockingNotice(page, receipt, kwargs, 'submit');
  const connector = await sendConsultPrompt(page, receipt.prompt, { github: !!receipt.github });
  const accepted = await waitForPromptAccepted(page, receipt.prompt, receipt.baselineMessageCount, 12);
  receipt.acceptedMessageCount = accepted.messageCount;
  receipt.acceptedUserSeen = !!accepted.userSeen;
  appendHistory(receipt, 'prompt-accepted', { acceptedMessageCount: receipt.acceptedMessageCount, acceptedUserSeen: receipt.acceptedUserSeen });
  saveReceipt(receipt);
  const conversation = await waitForConversationUrl(page, 30);
  receipt.status = 'sent';
  receipt.conversationId = conversation.conversationId;
  receipt.conversationUrl = conversation.conversationUrl;
  receipt.githubConnector = connector || null;
  receipt.readAfterIso = isoAfterSeconds(readAfterSeconds);
  appendHistory(receipt, 'send-done', { conversationUrl: receipt.conversationUrl, readAfterIso: receipt.readAfterIso });
  saveReceipt(receipt);
  return receipt;
}

async function ensureProjectSources(page, project, ratePrimary = {}, rateSecondary = {}) {
  const id = parseProjectId(project);
  await page.goto(`${CHATGPT_URL}/g/g-p-${id}/project?tab=sources`, { settleMs: 2500 });
  await ensureNoBlockingNotice(page, ratePrimary, rateSecondary, 'access');
  await sleep(page, 1);
  const clicked = unwrap(await page.evaluate(`(() => {
    const selected = document.querySelector('[role="tab"][aria-selected="true"]');
    if (selected && /Sources|资料/.test(selected.textContent || '')) return false;
    const tab = Array.from(document.querySelectorAll('[role="tab"], button')).find(el => {
      const text = (el.innerText || el.textContent || '').trim();
      return text === 'Sources' || text === '资料' || (el.id || '').includes('-sources');
    });
    if (tab instanceof HTMLElement) { tab.click(); return true; }
    return false;
  })()`));
  if (clicked) await sleep(page, 1);
  try {
    await page.wait({ selector: '[data-project-home-sources-surface="true"], [aria-label="Sources"]', timeout: 10 });
  } catch {
    // Let extraction below produce a typed failure with page context.
  }
  return id;
}

async function projectSourceRows(page) {
  const rows = unwrap(await page.evaluate(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const root = document.querySelector('[data-project-home-sources-surface="true"]')
      || document.querySelector('[aria-label="Sources"]')
      || document;
    const rows = Array.from(root.querySelectorAll('[class*="file-row"]'))
      .filter(isVisible)
      .map((row) => {
        const labelled = Array.from(row.querySelectorAll('[aria-label]'))
          .map(el => el.getAttribute('aria-label'))
          .find(Boolean);
        const text = normalize(row.innerText || row.textContent || '');
        const parts = text.split(/ (?=Document|Spreadsheet|Image|PDF|Code|Text|File|Jul|Jan|Feb|Mar|Apr|May|Jun|Aug|Sep|Oct|Nov|Dec)/);
        const name = normalize(labelled || parts[0] || text || '');
        return { name, detail: text };
      })
      .filter(row => row.name && !/^Add sources$/i.test(row.name));
    const seen = new Set();
    return rows.filter(row => {
      const key = row.name + '::' + row.detail;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })()`));
  if (!Array.isArray(rows)) throw new CommandExecutionError('ChatGPT project source extraction returned malformed data');
  return rows;
}

async function findSourceAction(page, name) {
  const target = JSON.stringify(name);
  return unwrap(await page.evaluate(`(() => {
    const target = ${target};
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const rows = Array.from(document.querySelectorAll('[class*="file-row"]')).filter(isVisible);
    const row = rows.find(el => normalize(el.innerText || el.textContent || '').includes(target));
    if (!row) return { ok: false, reason: 'source row not found: ' + target };
    const action = row.querySelector('button[aria-label="Source actions"]');
    if (!(action instanceof HTMLElement) || !isVisible(action)) return { ok: false, reason: 'source actions button not visible: ' + target };
    const rect = action.getBoundingClientRect();
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`));
}

async function findMenuItem(page, text) {
  const expected = JSON.stringify(text);
  return unwrap(await page.evaluate(`(() => {
    const expected = ${expected};
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const item = Array.from(document.querySelectorAll('[role="menuitem"], button, [role="option"]'))
      .find(el => isVisible(el) && normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || '') === expected);
    if (!(item instanceof HTMLElement)) return { ok: false, reason: 'menu item not found: ' + expected };
    const rect = item.getBoundingClientRect();
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`));
}

cli({
  site: PLUGIN_NAME,
  name: 'status',
  access: 'read',
  description: 'Check that the chatgptx OpenCLI plugin is installed',
  strategy: Strategy.PUBLIC,
  browser: false,
  columns: ['Status', 'Plugin', 'StateDir', 'NextAccessAfter', 'NextSubmitAfter'],
  func: async () => {
    const rate = loadRateState();
    return [{ Status: 'ok', Plugin: PLUGIN_NAME, StateDir: stateRoot(), NextAccessAfter: rate.nextAccessAfterIso || '', NextSubmitAfter: rate.nextSubmitAfterIso || '' }];
  },
});

cli({
  site: PLUGIN_NAME,
  name: 'consult',
  access: 'write',
  description: 'Send a ChatGPT prompt with optional GitHub connector selection and write a receipt',
  domain: CHATGPT_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
    { name: 'github', type: 'boolean', default: false, help: 'Select the ChatGPT GitHub connector pill before sending' },
    { name: 'project', valueRequired: true, help: 'Start a new chat inside a ChatGPT project ID or /g/g-p-<id> URL' },
    { name: 'conversation', valueRequired: true, help: 'Continue an existing ChatGPT conversation ID or URL' },
    { name: 'new', type: 'boolean', default: true, help: 'Start a new chat when no project/conversation is provided' },
    { name: 'wait', type: 'boolean', default: false, help: 'Harvest in the same command after sending' },
    { name: 'timeout', type: 'int', default: DEFAULT_HARVEST_TIMEOUT_SECONDS, help: 'Max seconds for pre-send/harvest waits' },
    { name: 'stable', type: 'int', default: DEFAULT_STABLE_SECONDS, help: 'Stable seconds when --wait true' },
    { name: 'read-after', type: 'int', default: DEFAULT_READ_AFTER_SECONDS, help: 'Seconds before queued harvest should retry' },
    { name: 'model-tier', valueRequired: true, default: 'normal', help: 'normal or pro; controls submit pacing' },
    { name: 'submit-interval', type: 'int', help: 'Override seconds between prompt submissions' },
    { name: 'access-interval', type: 'int', default: DEFAULT_ACCESS_INTERVAL_SECONDS, help: 'Seconds between ChatGPT page accesses/harvests' },
    { name: 'rate-wait', type: 'boolean', default: true, help: 'Wait for pacing windows and dismissed rate-limit modals' },
    { name: 'receipt-dir', valueRequired: true, help: 'Directory for receipt JSON files' },
    { name: 'job-id', valueRequired: true, help: 'Explicit receipt/job id' },
    { name: 'output', valueRequired: true, help: 'Output file for harvested assistant response' },
    { name: 'tag', valueRequired: true, help: 'Human tag stored in the receipt' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Navigate and optionally select GitHub, then clear composer without sending' },
  ],
  columns: ['JobId', 'Status', 'Github', 'ConversationUrl', 'Receipt', 'Output', 'Response'],
  func: async (page, kwargs) => {
    const prompt = requireText(kwargs.prompt, 'prompt');
    assertConsultArgs(kwargs);
    const dryRun = normalizeBooleanFlag(kwargs['dry-run'], false);
    const github = normalizeBooleanFlag(kwargs.github, false);
    const timeoutSeconds = requirePositiveInt(kwargs.timeout ?? DEFAULT_HARVEST_TIMEOUT_SECONDS, '--timeout');
    if (dryRun) {
      const release = acquireLock('browser');
      try {
        await paceAccess(page, kwargs, {}, 'consult-dry-run');
        await navigateForConsult(page, kwargs);
        await ensureComposer(page, 'chatgptx consult --dry-run requires a visible composer.', kwargs, {});
        await waitUntilNotGenerating(page, timeoutSeconds);
        let connector = null;
        if (github) {
          connector = await selectGitHubConnector(page);
          await focusComposer(page, { clear: false });
        } else {
          await focusComposer(page, { clear: true });
        }
        await typeIntoFocusedComposer(page, github ? ` ${prompt}` : prompt);
        const state = await getPageState(page);
        await clearComposer(page).catch(() => null);
        return [{ JobId: '', Status: 'dry-run', Github: github ? (connector?.label || 'GitHub') : 'false', ConversationUrl: state?.url || '', Receipt: '', Output: '', Response: '' }];
      } finally {
        release();
      }
    }

    let receipt = null;
    let release = acquireLock('browser');
    try {
      receipt = createReceipt(prompt, { ...kwargs, github }, 'queued');
      saveReceipt(receipt);
      receipt = await sendReceiptOnPage(page, receipt, kwargs);
    } catch (err) {
      if (receipt) {
        receipt.status = 'failed';
        receipt.error = String(err?.message || err);
        appendHistory(receipt, 'send-failed', { error: receipt.error });
        saveReceipt(receipt);
      }
      throw err;
    } finally {
      release();
    }

    let response = '';
    if (normalizeBooleanFlag(kwargs.wait, false)) {
      release = acquireLock('browser');
      try {
        const harvested = await harvestReceiptOnPage(page, receipt, { ...kwargs, wait: true });
        receipt = harvested.receipt;
        response = harvested.response || '';
      } finally {
        release();
      }
    }

    return [{ JobId: receipt.jobId, Status: receipt.status, Github: receipt.github ? 'true' : 'false', ConversationUrl: receipt.conversationUrl || '', Receipt: receipt.receiptPath || '', Output: receipt.outputPath || '', Response: response }];
  },
});

cli({
  site: PLUGIN_NAME,
  name: 'harvest',
  access: 'read',
  description: 'Harvest a chatgptx receipt or conversation URL into its output file',
  domain: CHATGPT_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    { name: 'target', positional: true, required: true, help: 'Receipt path, job id, or ChatGPT conversation URL' },
    { name: 'wait', type: 'boolean', default: false, help: 'Wait for stable final answer before returning' },
    { name: 'timeout', type: 'int', default: DEFAULT_HARVEST_TIMEOUT_SECONDS, help: 'Max seconds when --wait true' },
    { name: 'stable', type: 'int', default: DEFAULT_STABLE_SECONDS, help: 'Stable seconds when --wait true' },
    { name: 'read-after', type: 'int', default: DEFAULT_READ_AFTER_SECONDS, help: 'Seconds before retry if still pending' },
    { name: 'access-interval', type: 'int', default: DEFAULT_ACCESS_INTERVAL_SECONDS, help: 'Seconds between ChatGPT page accesses/harvests' },
    { name: 'rate-wait', type: 'boolean', default: true, help: 'Wait for pacing windows and dismissed rate-limit modals' },
    { name: 'receipt-dir', valueRequired: true, help: 'Directory for receipt JSON files' },
    { name: 'output', valueRequired: true, help: 'Output file for ad-hoc conversation URL harvests' },
  ],
  columns: ['JobId', 'Status', 'ConversationUrl', 'Generating', 'StableSeconds', 'Receipt', 'Output', 'Response'],
  func: async (page, kwargs) => {
    let receipt;
    const target = requireText(kwargs.target, 'target');
    const receiptFile = resolveReceiptRef(target, kwargs);
    if (receiptFile) {
      receipt = loadReceiptRef(target, kwargs);
    } else {
      const url = parseConversationUrl(target);
      const jobId = `adhoc-${parseConversationId(url).slice(0, 12)}`;
      receipt = {
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        jobId,
        status: 'sent',
        prompt: '',
        promptHash: '',
        github: false,
        project: '',
        conversation: url,
        conversationUrl: url,
        conversationId: parseConversationId(url),
        receiptPath: receiptPathForJob(jobId, kwargs),
        outputPath: outputPathForJob(jobId, kwargs),
        readAfterSeconds: requireNonNegativeInt(kwargs['read-after'] ?? DEFAULT_READ_AFTER_SECONDS, '--read-after'),
        accessIntervalSeconds: accessIntervalSecondsFor(kwargs),
        rateWait: rateWaitFor(kwargs),
        readAfterIso: '',
        attempts: { send: 0, harvest: 0 },
        createdAt: nowIso(),
        updatedAt: nowIso(),
        error: '',
        history: [],
      };
      appendHistory(receipt, 'adhoc-created');
      saveReceipt(receipt);
    }

    const release = acquireLock('browser');
    try {
      const harvested = await harvestReceiptOnPage(page, receipt, kwargs);
      const updated = harvested.receipt;
      return [{
        JobId: updated.jobId,
        Status: updated.status,
        ConversationUrl: updated.conversationUrl || '',
        Generating: harvested.generating ? 'true' : 'false',
        StableSeconds: harvested.stableSeconds,
        Receipt: updated.receiptPath || '',
        Output: updated.outputPath || '',
        Response: harvested.response || '',
      }];
    } finally {
      release();
    }
  },
});

cli({
  site: PLUGIN_NAME,
  name: 'broker-enqueue',
  access: 'write',
  description: 'Queue a ChatGPT consult job without opening the browser',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'prompt', positional: true, required: true, help: 'Prompt to send later' },
    { name: 'github', type: 'boolean', default: false, help: 'Select GitHub connector when sending' },
    { name: 'project', valueRequired: true, help: 'Project ID or /g/g-p-<id> URL' },
    { name: 'conversation', valueRequired: true, help: 'Conversation ID or URL to continue' },
    { name: 'read-after', type: 'int', default: DEFAULT_READ_AFTER_SECONDS, help: 'Seconds after send before harvest should retry' },
    { name: 'model-tier', valueRequired: true, default: 'normal', help: 'normal or pro; controls submit pacing' },
    { name: 'submit-interval', type: 'int', help: 'Override seconds between prompt submissions' },
    { name: 'access-interval', type: 'int', default: DEFAULT_ACCESS_INTERVAL_SECONDS, help: 'Seconds between ChatGPT page accesses/harvests' },
    { name: 'rate-wait', type: 'boolean', default: true, help: 'Wait for pacing windows and dismissed rate-limit modals' },
    { name: 'receipt-dir', valueRequired: true, help: 'Directory for receipt JSON files' },
    { name: 'job-id', valueRequired: true, help: 'Explicit receipt/job id' },
    { name: 'output', valueRequired: true, help: 'Output file for harvested assistant response' },
    { name: 'tag', valueRequired: true, help: 'Human tag stored in the receipt' },
  ],
  columns: ['JobId', 'Action', 'Status', 'Github', 'ConversationUrl', 'ReadAfter', 'Receipt', 'Output', 'Error'],
  func: async (kwargs) => {
    const prompt = requireText(kwargs.prompt, 'prompt');
    assertConsultArgs({ ...kwargs, new: false });
    const release = acquireLock('broker');
    try {
      const receipt = createReceipt(prompt, kwargs, 'queued');
      appendHistory(receipt, 'queued', { readAfterSeconds: receipt.readAfterSeconds });
      saveReceipt(receipt);
      return [receiptRow(receipt, 'enqueue')];
    } finally {
      release();
    }
  },
});

cli({
  site: PLUGIN_NAME,
  name: 'broker-status',
  access: 'read',
  description: 'List chatgptx broker receipts',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'receipt-dir', valueRequired: true, help: 'Directory for receipt JSON files' },
    { name: 'status', valueRequired: true, help: 'Filter by status' },
    { name: 'limit', type: 'int', default: 50, help: 'Maximum rows to print' },
  ],
  columns: ['JobId', 'Action', 'Status', 'Github', 'ConversationUrl', 'ReadAfter', 'Receipt', 'Output', 'Error'],
  func: async (kwargs) => {
    const limit = requirePositiveInt(kwargs.limit ?? 50, '--limit');
    const filter = String(kwargs.status || '').trim();
    const receipts = loadReceipts(kwargs)
      .filter(receipt => !filter || receipt.status === filter)
      .sort((a, b) => String(a.updatedAt || a.createdAt || '').localeCompare(String(b.updatedAt || b.createdAt || '')))
      .slice(0, limit);
    return receipts.map(receipt => receiptRow(receipt, 'status'));
  },
});

cli({
  site: PLUGIN_NAME,
  name: 'broker-run',
  access: 'write',
  description: 'Send queued ChatGPT jobs and harvest due receipts under the chatgptx lock',
  domain: CHATGPT_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 1, help: 'Maximum send/harvest actions in this run' },
    { name: 'send', type: 'boolean', default: true, help: 'Send queued jobs' },
    { name: 'harvest', type: 'boolean', default: true, help: 'Harvest sent jobs whose readAfterIso is due' },
    { name: 'wait', type: 'boolean', default: false, help: 'Wait for stable harvest when harvesting' },
    { name: 'timeout', type: 'int', default: DEFAULT_HARVEST_TIMEOUT_SECONDS, help: 'Max seconds for pre-send/harvest waits' },
    { name: 'stable', type: 'int', default: DEFAULT_STABLE_SECONDS, help: 'Stable seconds when --wait true' },
    { name: 'read-after', type: 'int', default: DEFAULT_READ_AFTER_SECONDS, help: 'Seconds before retry if still pending' },
    { name: 'model-tier', valueRequired: true, default: 'normal', help: 'Fallback model tier for legacy queued receipts' },
    { name: 'submit-interval', type: 'int', help: 'Fallback seconds between prompt submissions' },
    { name: 'access-interval', type: 'int', default: DEFAULT_ACCESS_INTERVAL_SECONDS, help: 'Fallback seconds between ChatGPT page accesses/harvests' },
    { name: 'rate-wait', type: 'boolean', default: true, help: 'Wait for pacing windows and dismissed rate-limit modals' },
    { name: 'receipt-dir', valueRequired: true, help: 'Directory for receipt JSON files' },
  ],
  columns: ['JobId', 'Action', 'Status', 'Github', 'ConversationUrl', 'ReadAfter', 'Receipt', 'Output', 'Error'],
  func: async (page, kwargs) => {
    const limit = requirePositiveInt(kwargs.limit ?? 1, '--limit');
    const doSend = normalizeBooleanFlag(kwargs.send, true);
    const doHarvest = normalizeBooleanFlag(kwargs.harvest, true);
    const rows = [];

    if (doSend) {
      while (rows.length < limit) {
        const release = acquireLock('browser');
        let receipt = null;
        try {
          receipt = claimNextReceipt(kwargs, candidate => candidate.status === 'queued', 'sending', 'claim-send');
          if (!receipt) break;
          const sent = await sendReceiptOnPage(page, receipt, kwargs);
          rows.push(receiptRow(sent, 'send'));
        } catch (err) {
          if (receipt) {
            receipt.status = 'failed';
            receipt.error = String(err?.message || err);
            appendHistory(receipt, 'send-failed', { error: receipt.error });
            saveReceipt(receipt);
            rows.push(receiptRow(receipt, 'send'));
          } else {
            throw err;
          }
        } finally {
          release();
        }
      }
    }

    if (doHarvest && rows.length < limit) {
      while (rows.length < limit) {
        const release = acquireLock('browser');
        let receipt = null;
        try {
          receipt = claimNextReceipt(kwargs, candidate => candidate.status === 'sent' && isDue(candidate), 'harvesting', 'claim-harvest');
          if (!receipt) break;
          const harvested = await harvestReceiptOnPage(page, receipt, kwargs);
          rows.push(receiptRow(harvested.receipt, 'harvest'));
        } catch (err) {
          if (receipt) {
            let updated = receipt;
            try { updated = loadReceiptRef(receipt.jobId, kwargs); } catch {}
            if (updated.status === 'harvesting') {
              updated.status = updated.conversationUrl || updated.conversation ? 'sent' : 'failed';
              if (updated.status === 'sent') updated.readAfterIso = isoAfterSeconds(readAfterSecondsFor(updated, kwargs));
              updated.error = String(err?.message || err);
              appendHistory(updated, 'harvest-failed', { error: updated.error, readAfterIso: updated.readAfterIso || '' });
              saveReceipt(updated);
            } else if (!updated.error) {
              updated.error = String(err?.message || err);
              saveReceipt(updated);
            }
            rows.push(receiptRow(updated, 'harvest'));
          } else {
            throw err;
          }
        } finally {
          release();
        }
      }
    }

    return rows;
  },
});

cli({
  site: PLUGIN_NAME,
  name: 'project-source-list',
  access: 'read',
  description: 'List visible ChatGPT Project source files',
  domain: CHATGPT_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    { name: 'project', required: true, valueRequired: true, help: 'Project ID or /g/g-p-<id> URL' },
    { name: 'access-interval', type: 'int', default: DEFAULT_ACCESS_INTERVAL_SECONDS, help: 'Seconds between ChatGPT page accesses' },
    { name: 'rate-wait', type: 'boolean', default: true, help: 'Wait for pacing windows and dismissed rate-limit modals' },
  ],
  columns: ['Index', 'Name', 'Detail'],
  func: async (page, kwargs) => {
    const release = acquireLock('browser');
    try {
      await paceAccess(page, kwargs, {}, 'project-source-list');
      await ensureProjectSources(page, kwargs.project, kwargs, {});
      const rows = await projectSourceRows(page);
      return rows.map((row, index) => ({ Index: index + 1, Name: row.name, Detail: row.detail }));
    } finally {
      release();
    }
  },
});

cli({
  site: PLUGIN_NAME,
  name: 'project-source-delete',
  access: 'write',
  description: 'Delete a ChatGPT Project source file by visible file name',
  domain: CHATGPT_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    { name: 'project', required: true, valueRequired: true, help: 'Project ID or /g/g-p-<id> URL' },
    { name: 'name', required: true, valueRequired: true, help: 'Exact visible project source file name' },
    { name: 'access-interval', type: 'int', default: DEFAULT_ACCESS_INTERVAL_SECONDS, help: 'Seconds between ChatGPT page accesses' },
    { name: 'rate-wait', type: 'boolean', default: true, help: 'Wait for pacing windows and dismissed rate-limit modals' },
  ],
  columns: ['Status', 'Name'],
  func: async (page, kwargs) => {
    const release = acquireLock('browser');
    try {
      const name = requireText(kwargs.name, 'source name');
      await paceAccess(page, kwargs, {}, 'project-source-delete');
      await ensureProjectSources(page, kwargs.project, kwargs, {});
      const action = await findSourceAction(page, name);
      await clickPoint(page, action, 'source actions');
      await sleep(page, 0.5);
      const del = await findMenuItem(page, 'Delete');
      await clickPoint(page, del, 'Delete menu item');
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await sleep(page, 0.5);
        const rows = await projectSourceRows(page);
        if (!rows.some(row => row.name === name || row.detail.includes(name))) {
          return [{ Status: 'deleted', Name: name }];
        }
      }
      throw new CommandExecutionError(`ChatGPT project source still visible after delete: ${name}`);
    } finally {
      release();
    }
  },
});

cli({
  site: PLUGIN_NAME,
  name: 'retry',
  access: 'write',
  description: 'Open a ChatGPT conversation and retry the latest assistant response',
  domain: CHATGPT_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    { name: 'conversation', positional: true, required: true, help: 'Conversation ID or full ChatGPT conversation URL' },
    { name: 'mode', valueRequired: true, default: 'again', help: 'Retry mode: again, thinking, web' },
    { name: 'model-tier', valueRequired: true, default: 'normal', help: 'normal or pro; controls submit pacing' },
    { name: 'submit-interval', type: 'int', help: 'Override seconds between retry submissions' },
    { name: 'access-interval', type: 'int', default: DEFAULT_ACCESS_INTERVAL_SECONDS, help: 'Seconds between ChatGPT page accesses' },
    { name: 'rate-wait', type: 'boolean', default: true, help: 'Wait for pacing windows and dismissed rate-limit modals' },
  ],
  columns: ['Status', 'Mode', 'Url'],
  func: async (page, kwargs) => {
    const release = acquireLock('browser');
    try {
      const url = parseConversationUrl(kwargs.conversation);
      const mode = String(kwargs.mode || 'again').trim().toLowerCase();
      const labels = { again: 'Try again', retry: 'Try again', thinking: 'Use Thinking', web: 'Search the web', 'web-search': 'Search the web' };
      const label = labels[mode];
      if (!label) throw new ArgumentError('retry mode must be one of: again, thinking, web');
      await paceAccess(page, kwargs, {}, 'retry-open');
      await page.goto(url, { settleMs: 2500 });
      await ensureNoBlockingNotice(page, kwargs, {}, 'access');
      await sleep(page, 1);
      const switchButton = unwrap(await page.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('button[aria-label="Switch model"]'));
        const button = buttons[buttons.length - 1];
        if (!(button instanceof HTMLElement)) return { ok: false, reason: 'Switch model button not found on latest response' };
        const rect = button.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`));
      await clickPoint(page, switchButton, 'Switch model');
      await sleep(page, 0.5);
      const option = await findMenuItem(page, label);
      await paceSubmit(page, kwargs, {}, 'retry-submit');
      await ensureNoBlockingNotice(page, kwargs, {}, 'submit');
      await clickPoint(page, option, label);
      await sleep(page, 1);
      const current = await currentUrl(page);
      return [{ Status: 'submitted', Mode: label, Url: String(current || url) }];
    } finally {
      release();
    }
  },
});
