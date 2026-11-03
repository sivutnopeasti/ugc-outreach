import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export async function fetchText(url, { headers = {}, timeoutMs = 15000, maxBytes = 1_000_000 } = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'fi-FI,fi;q=0.9,en;q=0.8',
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await readLimited(response, maxBytes);
  return { ok: response.ok, status: response.status, url: response.url, text };
}

export async function fetchJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    body: parseJsonSafe(text),
    text,
  };
}

/** Instagram-profiili: curl paikallisesti jos saatavilla, muuten Node fetch (Vercel). */
export async function instagramJson(url, headers = {}) {
  if (await canUseCurl()) {
    try {
      return await curlJson(url, headers);
    } catch (error) {
      // Vercelissä curl usein puuttuu — pudotaan fetchiin.
      if (!/ENOENT|not found|curl/i.test(String(error?.message || error))) throw error;
    }
  }
  return fetchJson(url, {
    headers: {
      'user-agent': BROWSER_UA,
      accept: '*/*',
      'accept-language': 'fi-FI,fi;q=0.9,en;q=0.8',
      ...headers,
    },
    timeoutMs: 25000,
  });
}

export async function curlJson(url, headers = {}) {
  const ua = headers['user-agent'] || headers['User-Agent'] || BROWSER_UA;
  const args = ['-sS', '-L', '--max-time', '25', '-A', ua];
  for (const [key, value] of Object.entries(headers)) {
    if (/^user-agent$/i.test(key)) continue;
    args.push('-H', `${key}: ${value}`);
  }
  args.push('-w', '\n%{http_code}', url);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 8_000_000 });
  const marker = stdout.lastIndexOf('\n');
  const text = marker === -1 ? stdout : stdout.slice(0, marker);
  const status = Number(marker === -1 ? 0 : stdout.slice(marker + 1).trim());
  return {
    ok: status >= 200 && status < 300,
    status,
    body: parseJsonSafe(text),
    text,
  };
}

export function parseJsonSafe(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function jsonErrorHint(text, status) {
  const snippet = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (/request entity too large/i.test(snippet)) {
    return `Palvelin hylkäsi liian ison pyynnön (${status || 413}).`;
  }
  if (snippet) return `Ei-JSON-vastaus (${status || '?'}): ${snippet}`;
  return `Tyhjä tai virheellinen JSON-vastaus (${status || '?'})`;
}

let curlAvailable = null;
async function canUseCurl() {
  if (curlAvailable != null) return curlAvailable;
  try {
    await execFileAsync('curl', ['--version'], { timeout: 3000 });
    curlAvailable = true;
  } catch {
    curlAvailable = false;
  }
  return curlAvailable;
}

async function readLimited(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    chunks.push(value);
  }
  try {
    await reader.cancel();
  } catch {
    /* the interesting prefix is already buffered */
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}
