import { usernameFromInstagram } from './score.mjs';
import { normalizeWebsite } from './sources.mjs';

export const MATCH_THRESHOLDS = {
  confirmed: 5,
  review: 3,
};

/** Ilmaiset arvatut kahvat yritysnimestä. Hyväksytään vasta pisteytyksellä. */
export function handleCandidatesFromName(name) {
  const compact = compactName(name);
  if (compact.length < 3) return [];
  const words = wordTokens(name);
  const variants = [
    compact,
    `${compact}oy`,
    `${compact}official`,
    `${compact}finland`,
    `${compact}fi`,
    `the${compact}`,
    ...words.filter((word) => word.length >= 4),
  ];
  if (words.length >= 2) {
    variants.push(words.slice(0, 2).join(''));
  }
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

/**
 * Pisteyttää, kuuluuko Instagram-profiili yritykselle.
 * AI ei päätä — vain säännöt. Epäselvä (3–4) → needs_review.
 */
export function scoreInstagramMatch(profile, { name, website, companyEmail = '', foundOnWebsite = false } = {}) {
  if (!profile) {
    return { score: 0, confidence: 'reject', reasons: ['Profiilia ei ole'], signals: [] };
  }

  const company = compactName(name);
  const signals = [];
  let score = 0;

  if (foundOnWebsite) {
    score += 5;
    signals.push({ points: 5, label: 'Löytyi yrityksen verkkosivulta' });
  }

  const linkUrls = [
    profile.externalUrl || '',
    ...(profile.bioLinks || []).map((link) => link.url || ''),
  ].filter(Boolean);

  if (website) {
    try {
      const companyHost = hostOf(website);
      for (const url of linkUrls) {
        try {
          const profileHost = hostOf(url);
          if (profileHost && companyHost && relatedHosts(profileHost, companyHost)) {
            score += 5;
            signals.push({ points: 5, label: `Bio-linkki samaan domainiin (${profileHost})` });
            break;
          }
        } catch {
          /* ignore bad bio link */
        }
      }
    } catch {
      /* ignore bad company website */
    }
  }

  if (companyEmail && profile.businessEmail) {
    if (normalizeEmail(profile.businessEmail) === normalizeEmail(companyEmail)) {
      score += 4;
      signals.push({ points: 4, label: 'Sama business-sähköposti kuin yrityksellä' });
    }
  }

  const biography = compactName(profile.biography || '');
  if (company.length >= 4 && biography.includes(company)) {
    score += 3;
    signals.push({ points: 3, label: 'Yrityksen nimi löytyy Instagram-biosta' });
  }

  const fullName = compactName(profile.fullName || '');
  if (company.length >= 4 && fullName.includes(company)) {
    score += 2;
    signals.push({ points: 2, label: 'Yrityksen nimi Instagram-nimessä' });
  }

  const username = compactName(profile.username || '');
  if (company.length >= 4 && username.includes(company)) {
    score += 1;
    signals.push({ points: 1, label: 'Käyttäjänimi sisältää yrityksen nimen' });
  }

  if (profile.isVerified || profile.isBusinessAccount) {
    score += 1;
    signals.push({
      points: 1,
      label: profile.isVerified ? 'Vahvistettu Instagram-tili' : 'Business-/professional-tili',
    });
  }

  let confidence = 'reject';
  if (score >= MATCH_THRESHOLDS.confirmed) confidence = 'confirmed';
  else if (score >= MATCH_THRESHOLDS.review) confidence = 'needs_review';

  const reasons = signals.map((item) => `${item.label} (+${item.points})`);
  if (confidence === 'needs_review') {
    reasons.push('Epäselvä osuma — vahvista Instagram itse ennen lähetystä');
  }
  if (confidence === 'reject' && reasons.length === 0) {
    reasons.push('Ei tarpeeksi yhtäläisyyksiä yritykseen');
  }

  return { score, confidence, reasons, signals };
}

/** Taaksepäin yhteensopiva: true vain varmistetulle osumalle. */
export function profileMatchesCompany(profile, context) {
  return scoreInstagramMatch(profile, context).confidence === 'confirmed';
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

function wordTokens(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\b(oyj|oy|ab|ltd|inc|group|konserni|ky|ry|as)\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
