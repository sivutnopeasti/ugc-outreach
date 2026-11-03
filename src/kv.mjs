import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

const FS_ROOT = path.resolve(process.cwd(), 'data');

export function usingRedis() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redis(command) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    throw new Error(`Redis-virhe ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const body = await response.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}

export async function kvGet(key) {
  if (usingRedis()) {
    return redis(['GET', key]);
  }
  try {
    return await readFile(fsPath(key), 'utf8');
  } catch {
    return null;
  }
}

export async function kvSet(key, value) {
  if (usingRedis()) {
    await redis(['SET', key, value]);
    return;
  }
  await mkdir(path.dirname(fsPath(key)), { recursive: true });
  await writeFile(fsPath(key), value, 'utf8');
}

export async function kvDel(key) {
  if (usingRedis()) {
    await redis(['DEL', key]);
    return;
  }
  await unlink(fsPath(key)).catch(() => {});
}

export async function kvKeys(prefix) {
  if (usingRedis()) {
    const keys = await redis(['KEYS', `${prefix}*`]);
    return Array.isArray(keys) ? keys : [];
  }
  await mkdir(FS_ROOT, { recursive: true });
  if (prefix.startsWith('run:')) {
    const dir = path.join(FS_ROOT, 'runs');
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    return files.filter((name) => name.endsWith('.json')).map((name) => `run:${name.replace(/\.json$/, '')}`);
  }
  return [];
}

function fsPath(key) {
  if (key === 'settings') return path.join(FS_ROOT, 'settings.json');
  if (key === 'suppression') return path.join(FS_ROOT, 'suppression.txt');
  if (key === 'sessions') return path.join(FS_ROOT, 'sessions.json');
  if (key.startsWith('run:')) return path.join(FS_ROOT, 'runs', `${key.slice(4)}.json`);
  if (key.startsWith('csv:')) return path.join(FS_ROOT, 'uploads', `${key.slice(4)}.csv`);
  return path.join(FS_ROOT, `${key}.txt`);
}

export async function ensureLocalDirs() {
  if (usingRedis()) return;
  await mkdir(path.join(FS_ROOT, 'runs'), { recursive: true });
  await mkdir(path.join(FS_ROOT, 'uploads'), { recursive: true });
}
