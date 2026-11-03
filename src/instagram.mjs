import { fetchText, instagramJson, jsonErrorHint } from './http.mjs';
import { kvGet, kvSet } from './kv.mjs';
import { usernameFromInstagram } from './score.mjs';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 340.0.0.36.90 Android (34/14; 480dpi; 1080x2340; samsung; SM-S921B; e1s; s5e9945; en_US; 629151101)';
const WEB_APP_ID = '936619743392459';
const ANDROID_APP_ID = '3419628305025917';
const DEFAULT_GAP_MS = 4000;
const RATE_LIMIT_STATUSES = new Set([401, 403, 429]);

export async function fetchInstagramProfile(username, options = {}) {
  const handle = usernameFromInstagram(username);
  if (!handle) {
    const error = new Error('Instagram-osoite ei kelpaa');
    error.code = 'bad_handle';
    throw error;
  }

  await waitForInstagramGap(options.minGapMs ?? DEFAULT_GAP_MS);
  const sessionId = String(options.sessionId || process.env.IG_SESSIONID || '').trim();
  const cookie = sessionId ? `sessionid=${sessionId}` : '';

  let lastError = null;
  const apiAttempts = [
    {
      host: 'i.instagram.com',
      headers: apiHeaders({
        handle,
        appId: ANDROID_APP_ID,
        userAgent: ANDROID_UA,
        cookie,
      }),
    },
    {
      host: 'www.instagram.com',
      headers: apiHeaders({
        handle,
        appId: WEB_APP_ID,
        userAgent: DESKTOP_UA,
        cookie,
      }),
    },
  ];

  for (const attempt of apiAttempts) {
    try {
      const profile = await fetchViaWebProfileInfo(handle, attempt.host, attempt.headers);
      if (profile) return profile;
    } catch (error) {
      lastError = error;
      if (error.code === 'rate_limited') {
        await sleep(Math.min(Number(options.rateLimitWaitMs || 8000), 12000));
        try {
          const retried = await fetchViaWebProfileInfo(handle, attempt.host, attempt.headers);
          if (retried) return retried;
        } catch (retryError) {
          lastError = retryError;
        }
        break;
      }
    }
  }

  try {
    const htmlProfile = await fetchViaProfileHtml(handle, cookie);
    if (htmlProfile) return htmlProfile;
  } catch (error) {
    lastError = lastError || error;
  }

  const hint = lastError?.message || `Instagram-haku epäonnistui (@${handle})`;
  const error = new Error(hint);
  error.code = lastError?.code || 'bad_response';
  throw error;
}

export async function waitForInstagramGap(minGapMs = DEFAULT_GAP_MS) {
  const gap = Math.max(0, Number(minGapMs) || 0);
  if (!gap) return;
  try {
    const raw = await kvGet('ig:lastAt');
    const last = Number(raw || 0);
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(Math.min(wait, 15000));
    await kvSet('ig:lastAt', String(Date.now()));
  } catch {
    await sleep(Math.min(gap, 5000));
  }
}

export function parseProfileFromHtml(html, handle) {
  const fromEmbedded = parseEmbeddedUser(html, handle);
  if (fromEmbedded) return fromEmbedded;
  return parseOgMetaProfile(html, handle);
}

export function isInstagramRateLimitError(error) {
  return error?.code === 'rate_limited' || /429|rate.?limit|odota muutama|please wait/i.test(String(error?.message || ''));
}

async function fetchViaWebProfileInfo(handle, host, headers) {
  const profileUrl = `https://${host}/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  let response = await instagramJson(profileUrl, headers);
  if (response.status === 429) {
    await sleep(4000);
    response = await instagramJson(profileUrl, headers);
  }

  const user = response.body?.data?.user;
  if (user) return normalizeApiUser(user, handle);

  if (RATE_LIMIT_STATUSES.has(response.status) || response.body?.require_login) {
    const error = new Error(
      response.body?.message
        ? `Instagram rajoitti hakua (@${handle}): ${response.body.message}`
        : `Instagram rajoitti hakua (@${handle}, HTTP ${response.status})`,
    );
    error.code = 'rate_limited';
    throw error;
  }

  const hint = response.body
    ? `Instagram ei palauttanut tiliä ${handle}`
    : `Instagram-haku epäonnistui (@${handle}): ${jsonErrorHint(response.text, response.status)}`;
  const error = new Error(hint);
  error.code = response.body ? 'not_found' : 'bad_response';
  throw error;
}

async function fetchViaProfileHtml(handle, cookie) {
  const headers = {
    'user-agent': DESKTOP_UA,
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'fi-FI,fi;q=0.9,en;q=0.8',
  };
  if (cookie) headers.cookie = cookie;
  const response = await fetchText(`https://www.instagram.com/${handle}/`, {
    headers,
    timeoutMs: 25000,
    maxBytes: 2_500_000,
  });
  if (!response.ok) {
    const error = new Error(`Instagram-sivu epäonnistui (@${handle}, HTTP ${response.status})`);
    error.code = RATE_LIMIT_STATUSES.has(response.status) ? 'rate_limited' : 'bad_response';
    throw error;
  }
  const profile = parseProfileFromHtml(response.text, handle);
  if (!profile) {
    const error = new Error(
      cookie
        ? `Instagram-sivulta ei löytynyt julkisia lukuja (@${handle})`
        : `Instagram ei antanut julkisia lukuja ilman istuntoa (@${handle})`,
    );
    error.code = 'no_public_metrics';
    throw error;
  }
  return profile;
}

function normalizeApiUser(user, handle) {
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
  const bioLinks = Array.isArray(user.bio_links)
    ? user.bio_links
      .map((link) => ({
        url: typeof link?.url === 'string' ? link.url : '',
        title: typeof link?.title === 'string' ? link.title : '',
      }))
      .filter((link) => link.url)
    : [];

  return {
    username: user.username || handle,
    fullName: user.full_name || '',
    biography: typeof user.biography === 'string' ? user.biography : '',
    isPrivate: user.is_private === true,
    isVerified: user.is_verified === true,
    isBusinessAccount: user.is_business_account === true || user.is_professional_account === true,
    followers: numberOrNull(user.edge_followed_by?.count),
    businessEmail: typeof user.business_email === 'string' ? user.business_email.toLowerCase() : '',
    externalUrl: typeof user.external_url === 'string' ? user.external_url : '',
    bioLinks,
    posts,
  };
}

function parseEmbeddedUser(html, handle) {
  const scripts = String(html).match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    if (!/xig_user_by_username|follower_count|edge_followed_by/i.test(body)) continue;
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      continue;
    }
    const user = findUserNode(json);
    if (!user) continue;
    return normalizeEmbeddedUser(user, handle);
  }

  const shared = String(html).match(/window\._sharedData\s*=\s*(\{[\s\S]*?\});/);
  if (shared) {
    try {
      const json = JSON.parse(shared[1]);
      const user = json?.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (user) return normalizeApiUser(user, handle);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function normalizeEmbeddedUser(user, handle) {
  const posts = [];
  const media = user.edge_owner_to_timeline_media?.edges
    || user.media?.nodes
    || user.timeline_media?.edges
    || [];
  for (const item of media.slice(0, 12)) {
    const node = item.node || item;
    posts.push({
      isVideo: node.is_video === true || node.media_type === 2,
      likes: numberOrNull(node.edge_liked_by?.count ?? node.like_count ?? node.likes),
      comments: numberOrNull(node.edge_media_to_comment?.count ?? node.comment_count ?? node.comments),
      views: numberOrNull(node.video_view_count ?? node.view_count ?? node.play_count),
    });
  }

  const bioLinks = [];
  if (typeof user.external_url === 'string' && user.external_url) {
    bioLinks.push({ url: user.external_url, title: '' });
  }
  for (const link of user.bio_links || []) {
    if (typeof link?.url === 'string' && link.url) {
      bioLinks.push({ url: link.url, title: typeof link.title === 'string' ? link.title : '' });
    }
  }

  return {
    username: user.username || handle,
    fullName: user.full_name || user.fullName || '',
    biography: typeof user.biography === 'string' ? user.biography : '',
    isPrivate: user.is_private === true || user.isPrivate === true,
    isVerified: user.is_verified === true || user.isVerified === true,
    isBusinessAccount: user.is_business_account === true || user.is_professional_account === true || user.isBusinessAccount === true,
    followers: numberOrNull(user.edge_followed_by?.count ?? user.follower_count ?? user.followerCount),
    businessEmail: typeof user.business_email === 'string' ? user.business_email.toLowerCase() : '',
    externalUrl: typeof user.external_url === 'string' ? user.external_url : '',
    bioLinks,
    posts,
  };
}

function parseOgMetaProfile(html, handle) {
  const desc =
    html.match(/property="og:description" content="([^"]*)"/i)?.[1]
    || html.match(/name="description" content="([^"]*)"/i)?.[1]
    || '';
  const decoded = decodeBasicEntities(desc);
  const followers = parseCount(decoded.match(/([\d.,\s]+)\s*Followers/i)?.[1])
    ?? parseCount(decoded.match(/([\d.,\s]+)\s*seuraajaa/i)?.[1]);
  const postsCount = parseCount(decoded.match(/([\d.,\s]+)\s*Posts/i)?.[1])
    ?? parseCount(decoded.match(/([\d.,\s]+)\s*julkaisua/i)?.[1]);
  const title =
    html.match(/property="og:title" content="([^"]*)"/i)?.[1]
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || '';
  const fullName = decodeBasicEntities(title)
    .replace(/\s*\(@[\w._]+\).*/i, '')
    .replace(/\s*[•|].*/g, '')
    .replace(/\s*Instagram\s*$/i, '')
    .trim();

  if (followers == null && postsCount == null) return null;
  return {
    username: handle,
    fullName,
    biography: '',
    isPrivate: false,
    isVerified: false,
    isBusinessAccount: false,
    followers,
    businessEmail: '',
    externalUrl: '',
    bioLinks: [],
    posts: [],
    source: 'og_meta',
  };
}

function findUserNode(value, depth = 0) {
  if (!value || depth > 12) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUserNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  if (value.username && (value.follower_count != null || value.edge_followed_by || value.full_name != null || value.biography != null)) {
    return value;
  }
  if (value.xig_user_by_username) {
    const nested = value.xig_user_by_username?.user || value.xig_user_by_username?.data?.user || value.xig_user_by_username;
    if (nested?.username) return nested;
  }
  for (const child of Object.values(value)) {
    const found = findUserNode(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function apiHeaders({ handle, appId, userAgent, cookie }) {
  const headers = {
    'user-agent': userAgent,
    'x-ig-app-id': appId,
    accept: '*/*',
    'accept-language': 'fi-FI,fi;q=0.9,en;q=0.8',
    referer: `https://www.instagram.com/${handle}/`,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseCount(raw) {
  if (raw == null) return null;
  const text = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  const match = text.match(/^([\d.,]+)([kmb])?$/i);
  if (!match) return null;
  let num = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) {
    num = Number(match[1].replace(/\./g, '').replace(',', '.'));
  }
  if (!Number.isFinite(num)) return null;
  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'k') num *= 1000;
  if (suffix === 'm') num *= 1_000_000;
  if (suffix === 'b') num *= 1_000_000_000;
  return Math.round(num);
}

function decodeBasicEntities(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&#64;', '@')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
