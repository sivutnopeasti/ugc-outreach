import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ensureLocalDirs, kvDel, kvGet, kvKeys, kvSet, usingRedis } from './kv.mjs';

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
    aiKeySet: Boolean(settings.aiApiKey),
    aiBaseUrl: settings.aiBaseUrl || '',
    aiModel: settings.aiModel || '',
    minFollowers: settings.minFollowers || 3000,
    minMedianLikes: settings.minMedianLikes || 30,
    minMedianComments: settings.minMedianComments || 3,
    minMedianViews: settings.minMedianViews || 1000,
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
    appPasswordHash: '',
  };
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
    AI_API_KEY: settings.aiApiKey || '',
    AI_BASE_URL: settings.aiBaseUrl || '',
    AI_MODEL: settings.aiModel || 'gpt-4o-mini',
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

export async function createRun({ name, csvText }) {
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
    error: '',
  };
  await saveRun(run);
  return run;
}

export async function saveRun(run) {
  await ensureLocalDirs();
  await kvSet(`run:${run.id}`, JSON.stringify(run));
}

export async function getRun(id) {
  const raw = await kvGet(`run:${id}`);
  if (!raw) {
    const error = new Error('Kampanjaa ei löytynyt');
    error.status = 404;
    throw error;
  }
  return JSON.parse(raw);
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
        weakCount: (run.results || []).filter((row) => row.decision === 'weak').length,
        sentCount: (run.results || []).filter((row) => row.delivery === 'lähetetty').length,
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
