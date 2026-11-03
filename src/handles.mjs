import { usernameFromInstagram } from './score.mjs';
import { normalizeWebsite } from './sources.mjs';

/** Ilmaiset arvatut kahvat yritysnimestä. Hyväksytään vasta, kun tili täsmää yritykseen. */
export function handleCandidatesFromName(name) {
  const compact = compactName(name);
  if (compact.length < 3) return [];
  const variants = [compact, `${compact}oy`, `${compact}official`, `${compact}finland`];
  return [...new Set(variants)].filter((handle) => handle.length >= 3 && handle.length <= 30);
}

export function findAtHandles(html) {
  const text = String(html || '');
  const found = new Set();
  for (const match of text.matchAll(/(?:instagram\.com\/|@)([A-Za-z0-9._]{2,30})/gi)) {
    const handle = usernameFromInstagram(match[1]);
    if (handle) found.add(handle);
  }
  return [...found];
}

export function profileMatchesCompany(profile, { name, website }) {
  if (!profile) return false;
  if (profile.externalUrl && website) {
    try {
      const profileHost = hostOf(profile.externalUrl);
      const companyHost = hostOf(website);
      if (profileHost && companyHost && relatedHosts(profileHost, companyHost)) return true;
    } catch {
      /* ignore bad urls */
    }
  }
  const company = compactName(name);
  const blob = compactName(`${profile.fullName || ''} ${profile.username || ''}`);
  return company.length >= 4 && blob.includes(company);
}

function hostOf(value) {
  return new URL(normalizeWebsite(value)).hostname.replace(/^www\./, '').toLowerCase();
}

function relatedHosts(a, b) {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function compactName(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\b(oyj|oy|ab|ltd|inc|group|konserni|ky|ry|as)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
