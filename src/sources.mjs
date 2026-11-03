import { curlJson, fetchJson, fetchText } from './http.mjs';
import { usernameFromInstagram } from './score.mjs';

const CONTACT_PATHS = ['/yhteystiedot', '/ota-yhteytta', '/contact', '/meista'];
const ROLE_LOCALS = new Set([
  'info',
  'myynti',
  'hello',
  'hei',
  'contact',
  'asiakaspalvelu',
  'markkinointi',
  'sales',
  'office',
  'toimisto',
  'viestinta',
  'tilaukset',
  'tuki',
]);
const FREE_MAIL = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.fi', 'live.com']);

export function normalizeWebsite(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch {
    return '';
  }
}

export async function lookupCompany(businessId) {
  const url = `https://avoindata.prh.fi/opendata-ytj-api/v3/companies?businessId=${encodeURIComponent(businessId)}`;
  const response = await fetchJson(url, { headers: { 'user-agent': 'UGCSuomiOutreach/1.0' } });
  const company = response.body?.companies?.[0];
  if (!company) return null;
  const name = currentName(company.names);
  const form = formDescriptions(company.companyForms).join(' ').toLowerCase();
  return {
    name,
    website: normalizeWebsite(company.website?.url || ''),
    naturalPerson: /elinkeinonharjoittaja|toiminimi/.test(form),
    dissolved: company.tradeRegisterStatus != null && String(company.tradeRegisterStatus) !== '1',
  };
}

export async function fetchSite(website) {
  const start = normalizeWebsite(website);
  if (!start) return { ok: false, instagram: '', email: '', pageText: '' };
  const pages = [start, ...CONTACT_PATHS.map((path) => new URL(path, start).href)];
  let sawOk = false;
  let instagram = '';
  let pageText = '';
  const emails = [];
  for (const page of pages) {
    if (instagram && emails.length > 0 && pageText) break;
    let response;
    try {
      response = await fetchText(page);
    } catch {
      continue;
    }
    if (!response.ok) continue;
    sawOk = true;
    if (!pageText) pageText = stripTags(response.text).slice(0, 4000);
    if (!instagram) instagram = findInstagram(response.text);
    emails.push(...findEmails(response.text));
  }
  return {
    ok: sawOk,
    instagram,
    email: pickEmail(emails, start),
    pageText,
  };
}

export async function fetchInstagram(username) {
  const handle = usernameFromInstagram(username);
  if (!handle) {
    const error = new Error('Instagram-osoite ei kelpaa');
    error.code = 'bad_handle';
    throw error;
  }
  const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  let response = await curlJson(profileUrl, instagramHeaders(handle));
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    response = await curlJson(profileUrl, instagramHeaders(handle));
  }
  const user = response.body?.data?.user;
  if (!user) {
    const error = new Error(`Instagram ei palauttanut tiliä ${handle}`);
    error.code = 'not_found';
    throw error;
  }
  const posts = (user.edge_owner_to_timeline_media?.edges || []).slice(0, 12).map((edge) => {
    const node = edge.node || {};
    const hidden = node.like_and_view_counts_disabled === true;
    return {
      isVideo: node.is_video === true,
      likes: hidden ? null : numberOrNull(node.edge_liked_by?.count),
      comments: numberOrNull(node.edge_media_to_comment?.count),
      views: hidden ? null : numberOrNull(node.video_view_count),
    };
  });
  return {
    username: user.username || handle,
    fullName: user.full_name || '',
    isPrivate: user.is_private === true,
    followers: numberOrNull(user.edge_followed_by?.count),
    businessEmail: typeof user.business_email === 'string' ? user.business_email.toLowerCase() : '',
    externalUrl: typeof user.external_url === 'string' ? user.external_url : '',
    posts,
  };
}

export async function fetchAds(companyName, accessToken) {
  if (!accessToken) return { checked: false, active: null };
  const params = new URLSearchParams({
    search_terms: companyName,
    ad_type: 'ALL',
    ad_active_status: 'ACTIVE',
    fields: 'page_name',
    limit: '25',
    access_token: accessToken,
  });
  params.append('ad_reached_countries', 'FI');
  const response = await fetchJson(`https://graph.facebook.com/v21.0/ads_archive?${params}`);
  if (!response.ok || !Array.isArray(response.body?.data)) {
    return { checked: false, active: null };
  }
  const active = response.body.data.some((ad) => namesMatch(ad.page_name || '', companyName));
  return { checked: true, active };
}

export function pickEmail(emails, website) {
  let host = '';
  try {
    host = new URL(normalizeWebsite(website)).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const ranked = unique
    .map((email) => ({ email, score: scoreEmail(email, host) }))
    .filter((item) => item.score > -10)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.email || '';
}

export function findInstagram(html) {
  const matches = String(html).match(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._/]+/gi) || [];
  for (const match of matches) {
    const handle = usernameFromInstagram(match);
    if (handle) return `https://www.instagram.com/${handle}/`;
  }
  return '';
}

export function findEmails(html) {
  const text = decodeBasicEntities(String(html));
  const found = new Set();
  for (const match of text.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    found.add(match[1]);
  }
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    found.add(match[0]);
  }
  return [...found];
}

function scoreEmail(email, host) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return -10;
  if (local.includes('noreply') || local.includes('no-reply')) return -10;
  const sameSite = host && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`));
  if (host && !sameSite) return -10;
  let score = 0;
  if (sameSite) score += 5;
  if (ROLE_LOCALS.has(local.split('+')[0])) score += 3;
  if (FREE_MAIL.has(domain)) score -= 1;
  return score;
}

function normalizeEmail(value) {
  let raw = String(value || '').trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep the original address */
  }
  const email = raw.toLowerCase().replace(/^mailto:/, '');
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return '';
  const tld = email.split('.').pop();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js'].includes(tld)) return '';
  return email;
}

function currentName(names) {
  const current = (names || []).filter((item) => !item.endDate);
  const official = current.find((item) => String(item.type) === '1') || current[0] || names?.[0];
  return official?.name || '';
}

function formDescriptions(forms) {
  const texts = [];
  for (const form of forms || []) {
    for (const description of form.descriptions || []) texts.push(description.description || '');
  }
  return texts;
}

function namesMatch(pageName, companyName) {
  const page = compactName(pageName);
  const company = compactName(companyName);
  if (page.length < 3 || company.length < 3) return false;
  return page.includes(company) || company.includes(page);
}

function compactName(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\b(oyj|oy|ab|ltd|inc|group|konserni)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function instagramHeaders(handle) {
  return {
    'x-ig-app-id': '936619743392459',
    referer: `https://www.instagram.com/${handle}/`,
  };
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decodeBasicEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&#64;', '@')
    .replaceAll('&commat;', '@');
}

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
