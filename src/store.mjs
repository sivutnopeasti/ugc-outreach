import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ensureLocalDirs, kvDel, kvGet, kvKeys, kvSet, usingRedis } from './kv.mjs';
import { aiConfig } from './ai.mjs';
import { publicMailAccounts } from './mail.mjs';

export async function readSettings() {
  await ensureLocalDirs();
  const raw = await kvGet('settings');
  if (!raw) return defaultSettings();
  try {
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

export async function writeSettings(next) {
  await ensureLocalDirs();
  const current = await readSettings();
  const merged = { ...current, ...next, updatedAt: new Date().toISOString() };
  if (next.appPassword && next.appPassword !== current.appPassword) {
    merged.appPasswordHash = hashSecret(next.appPassword);
  }
  delete merged.appPassword;
  await kvSet('settings', JSON.stringify(merged, null, 2));
  return publicSettings(merged);
}

export function publicSettings(settings) {
  return {
    fromName: settings.fromName || '',
    fromEmail: settings.fromEmail || '',
    postalAddress: settings.postalAddress || '',
    mailProvider: settings.mailProvider || 'gmail',
    smtpHost: settings.smtpHost || '',
    smtpPort: settings.smtpPort || 587,
    smtpUser: settings.smtpUser || '',
    smtpPassSet: Boolean(settings.smtpPass),
    metaTokenSet: Boolean(settings.metaAccessToken),
    aiKeySet: Boolean(aiConfig(process.env).enabled || settings.aiApiKey),
    aiFromEnv: Boolean(process.env.GROK_TOKEN || process.env.XAI_API_KEY),
    aiProvider: aiConfig({
      ...process.env,
      AI_API_KEY: settings.aiApiKey || process.env.AI_API_KEY || '',
      AI_BASE_URL: settings.aiBaseUrl || process.env.AI_BASE_URL || '',
      AI_MODEL: settings.aiModel || process.env.AI_MODEL || '',
    }).provider,
    aiBaseUrl: settings.aiBaseUrl || '',
    aiModel: settings.aiModel || '',
    minFollowers: settings.minFollowers || 3000,
    minMedianLikes: settings.minMedianLikes || 30,
    minMedianComments: settings.minMedianComments || 3,
    minMedianViews: settings.minMedianViews || 1000,
    testMode: settings.testMode !== false,
    testInboxEmail: settings.testInboxEmail || '',
    maxEmailsPerDay: Number(settings.maxEmailsPerDay || settings.maxSendPerBatch || 6),
    maxEmailsPerDomain: Number(settings.maxEmailsPerDomain || 2),
    mailAccounts: publicMailAccounts(settings.mailAccounts || []),
    hasPassword: Boolean(settings.appPasswordHash),
    setupComplete: Boolean(settings.fromName && settings.fromEmail && settings.postalAddress && settings.appPasswordHash),
    storage: usingRedis() ? 'redis' : 'local',
    updatedAt: settings.updatedAt || null,
  };
}

export function defaultSettings() {
  return {
    fromName: '',
    fromEmail: '',
    postalAddress: '',
    mailProvider: 'gmail',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    metaAccessToken: '',
    aiApiKey: '',
    aiBaseUrl: '',
    aiModel: 'gpt-4o-mini',
    minFollowers: 3000,
    minMedianLikes: 30,
    minMedianComments: 3,
    minMedianViews: 1000,
    testMode: true,
    testInboxEmail: '',
    maxEmailsPerDay: 6,
    maxEmailsPerDomain: 2,
    mailAccounts: [],
    appPasswordHash: '',
  };
}

export function helsinkiDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export async function readDailySendStats(day = helsinkiDayKey()) {
  await ensureLocalDirs();
  const raw = await kvGet(`send-stats:${day}`);
  if (!raw) return { day, total: 0, byDomain: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      day,
      total: Number(parsed.total || 0),
      byDomain: parsed.byDomain && typeof parsed.byDomain === 'object' ? parsed.byDomain : {},
    };
  } catch {
    return { day, total: 0, byDomain: {} };
  }
}

export async function recordDailySend({ domain, count = 1, day = helsinkiDayKey() } = {}) {
  const stats = await readDailySendStats(day);
  const next = {
    day,
    total: Number(stats.total || 0) + Number(count || 0),
    byDomain: { ...(stats.byDomain || {}) },
  };
  if (domain) {
    next.byDomain[domain] = Number(next.byDomain[domain] || 0) + Number(count || 0);
  }
  await kvSet(`send-stats:${day}`, JSON.stringify(next));
  return next;
}

export function settingsToEnv(settings) {
  const provider = settings.mailProvider || 'gmail';
  return {
    OUTREACH_FROM_NAME: settings.fromName || '',
    OUTREACH_FROM_EMAIL: settings.fromEmail || '',
    OUTREACH_POSTAL_ADDRESS: settings.postalAddress || '',
    MAIL_PROVIDER: provider,
    SMTP_HOST: settings.smtpHost || '',
    SMTP_PORT: String(settings.smtpPort || 587),
    SMTP_USER: settings.smtpUser || '',
    SMTP_PASS: settings.smtpPass || '',
    META_ACCESS_TOKEN: settings.metaAccessToken || '',
    GROK_TOKEN: process.env.GROK_TOKEN || process.env.XAI_API_KEY || '',
    XAI_API_KEY: process.env.XAI_API_KEY || '',
    AI_API_KEY: settings.aiApiKey || '',
    AI_BASE_URL: settings.aiBaseUrl || '',
    AI_MODEL: settings.aiModel || '',
    GROK_MODEL: process.env.GROK_MODEL || '',
    MIN_FOLLOWERS: String(settings.minFollowers || 3000),
    MIN_MEDIAN_LIKES: String(settings.minMedianLikes || 30),
    MIN_MEDIAN_COMMENTS: String(settings.minMedianComments || 3),
    MIN_MEDIAN_VIEWS: String(settings.minMedianViews || 1000),
  };
}

export async function readSuppression() {
  await ensureLocalDirs();
  return (await kvGet('suppression')) || '# Yksi sähköposti per rivi\n';
}

export async function writeSuppression(text) {
  await ensureLocalDirs();
  await kvSet('suppression', String(text || ''));
}

export async function createRun({ name, csvText, batchMeta = null }) {
  await ensureLocalDirs();
  const id = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  await kvSet(`csv:${id}`, csvText);
  const run = {
    id,
    name: name || `Kampanja ${new Date().toLocaleString('fi-FI')}`,
    createdAt: new Date().toISOString(),
    status: 'queued',
    progress: 0,
    total: 0,
    cursor: 0,
    message: 'Jonossa',
    results: [],
    activity: [],
    batchMeta,
    pipeline: {
      active: false,
      stage: 'idle',
      phase: 'queued',
      label: 'Jonossa — analyysi alkaa pian',
      companyName: '',
      businessId: '',
      step: 0,
      total: 0,
      updatedAt: new Date().toISOString(),
    },
    error: '',
  };
  await saveRun(run);
  return run;
}

export async function saveRun(run) {
  await ensureLocalDirs();
  await kvSet(`run:${run.id}`, JSON.stringify(run));
  if (run.pipeline) {
    await kvSet(`pipeline:${run.id}`, JSON.stringify(run.pipeline));
  }
}

/** Kevyt live-päivitys ilman koko kampanjan uudelleenkirjoitusta. */
export async function savePipeline(runId, pipeline, message = '') {
  await ensureLocalDirs();
  await kvSet(`pipeline:${runId}`, JSON.stringify(pipeline));
  if (message) {
    try {
      const run = await getRun(runId);
      run.pipeline = pipeline;
      run.message = message;
      await kvSet(`run:${run.id}`, JSON.stringify(run));
    } catch {
      /* pipeline-avain riittää pollaukseen */
    }
  }
}

export async function getRun(id) {
  const raw = await kvGet(`run:${id}`);
  if (!raw) {
    const error = new Error('Kampanjaa ei löytynyt');
    error.status = 404;
    throw error;
  }
  let run;
  try {
    run = JSON.parse(raw);
  } catch {
    const error = new Error('Kampanjadata on vioittunut (ei kelvollista JSONia)');
    error.status = 500;
    throw error;
  }
  const live = await kvGet(`pipeline:${id}`);
  if (live) {
    try {
      run.pipeline = JSON.parse(live);
    } catch {
      /* pidä run.pipeline */
    }
  }
  return run;
}

export async function getRunCsv(id) {
  const csv = await kvGet(`csv:${id}`);
  if (!csv) {
    const error = new Error('CSV:ää ei löytynyt');
    error.status = 404;
    throw error;
  }
  return csv;
}

export async function listRuns() {
  await ensureLocalDirs();
  const keys = await kvKeys('run:');
  const runs = [];
  for (const key of keys) {
    try {
      const run = JSON.parse(await kvGet(key));
      runs.push({
        id: run.id,
        name: run.name,
        createdAt: run.createdAt,
        status: run.status,
        progress: run.progress,
        total: run.total,
        message: run.message || '',
        pipeline: run.pipeline || null,
        weakCount: (run.results || []).filter((row) => row.decision === 'weak').length,
        sentCount: (run.results || []).filter((row) => row.sentAt || String(row.delivery || '').startsWith('lähetetty') || String(row.delivery || '').startsWith('testilähetys')).length,
        error: run.error || '',
      });
    } catch {
      /* skip */
    }
  }
  return runs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function deleteRun(id) {
  await kvDel(`run:${id}`);
  await kvDel(`csv:${id}`);
  await kvDel(`pipeline:${id}`);
}

export function hashSecret(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function secretsEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function createSession() {
  await ensureLocalDirs();
  const token = randomBytes(24).toString('hex');
  const sessions = await readSessions();
  sessions[token] = { createdAt: Date.now() };
  await kvSet('sessions', JSON.stringify(sessions));
  return token;
}

export async function sessionValid(token) {
  if (!token) return false;
  const sessions = await readSessions();
  const row = sessions[token];
  if (!row) return false;
  return Date.now() - row.createdAt < 1000 * 60 * 60 * 24 * 30;
}

async function readSessions() {
  try {
    return JSON.parse((await kvGet('sessions')) || '{}');
  } catch {
    return {};
  }
}
