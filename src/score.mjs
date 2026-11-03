export const DEFAULT_THRESHOLDS = {
  minFollowers: 3000,
  minMedianLikes: 30,
  minMedianComments: 3,
  minMedianViews: 1000,
};

export function median(values) {
  const nums = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

export function usernameFromInstagram(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text) && !text.includes('instagram.com')) {
    const handle = text.replace(/^@/, '').split(/[/?#]/)[0];
    return isHandle(handle) ? handle : '';
  }
  try {
    const url = new URL(text.startsWith('http') ? text : `https://${text}`);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return '';
    const segment = url.pathname.split('/').filter(Boolean)[0] || '';
    return isHandle(segment) ? segment : '';
  } catch {
    return '';
  }
}

function isHandle(value) {
  if (!/^[A-Za-z0-9._]{1,30}$/.test(value)) return false;
  return !['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tv', 'direct'].includes(value.toLowerCase());
}

/**
 * Päätös perustuu julkisiin signaaleihin. Yksi vahva signaali riittää siihen,
 * ettei yritykselle lähetetä viestiä. Puuttuvaa tietoa ei tulkita heikkoudeksi.
 */
export function assessPresence(signals, thresholds = DEFAULT_THRESHOLDS) {
  const profile = signals.profile;
  const followers = profile?.followers ?? null;
  const likes = median((profile?.posts || []).map((post) => post.likes));
  const comments = median((profile?.posts || []).map((post) => post.comments));
  const views = median((profile?.posts || []).filter((post) => post.isVideo).map((post) => post.views));
  const strong = [];

  if (followers != null && followers >= thresholds.minFollowers) {
    strong.push(`${formatNumber(followers)} seuraajaa`);
  }
  if (likes != null && likes >= thresholds.minMedianLikes) {
    strong.push(`julkaisujen tykkäysten mediaani ${formatNumber(likes)}`);
  }
  if (comments != null && comments >= thresholds.minMedianComments) {
    strong.push(`kommenttien mediaani ${formatNumber(comments)}`);
  }
  if (views != null && views >= thresholds.minMedianViews) {
    strong.push(`videoiden katseluiden mediaani ${formatNumber(views)}`);
  }
  if (signals.ads?.active === true) {
    strong.push('Meta-mainoskirjastossa on aktiivinen mainos');
  }

  const base = {
    followers,
    medianLikes: likes,
    medianComments: comments,
    medianViews: views,
  };

  if (strong.length > 0) {
    return { ...base, decision: 'strong', reasons: strong };
  }

  if (!signals.website && !profile && !signals.instagramUsername) {
    return {
      ...base,
      decision: 'unknown',
      reasons: ['Verkkosivua ei löytynyt, joten Instagramia ei voitu yhdistää yritykseen'],
    };
  }

  if (signals.websiteFetchFailed && !profile) {
    return {
      ...base,
      decision: 'unknown',
      reasons: ['Yrityksen verkkosivu ei auennut, joten somea ei arvioitu'],
    };
  }

  if (signals.instagramUsername && signals.instagramError) {
    const detail = shortError(signals.instagramError);
    return {
      ...base,
      decision: 'unknown',
      reasons: [
        detail
          ? `Instagram-tili löytyi, mutta julkisia lukuja ei saatu (${detail})`
          : 'Instagram-tili löytyi, mutta julkisia lukuja ei saatu',
      ],
    };
  }

  if (!profile && signals.instagramError && isRateLimitMessage(signals.instagramError)) {
    return {
      ...base,
      decision: 'unknown',
      reasons: [`Instagram rajoitti hakua kesken erän (${shortError(signals.instagramError)}) — odota hetki tai lisää sessionid asetuksiin`],
    };
  }

  if (profile?.isPrivate && followers == null) {
    return {
      ...base,
      decision: 'unknown',
      reasons: ['Instagram-tili on yksityinen eikä seuraajamäärää näy'],
    };
  }

  const reasons = [];
  if (!profile && !signals.instagramUsername) {
    reasons.push('Viralliselta verkkosivulta ei löytynyt Instagram-osoitetta');
  } else if (profile) {
    if (followers != null) reasons.push(`${formatNumber(followers)} seuraajaa`);
    if (likes != null) reasons.push(`tykkäysten mediaani ${formatNumber(likes)}`);
    if (comments != null) reasons.push(`kommenttien mediaani ${formatNumber(comments)}`);
    if (views != null) reasons.push(`katseluiden mediaani ${formatNumber(views)}`);
    if (profile.posts?.length === 0) reasons.push('julkisia julkaisuja ei näy');
    if (signals.ads?.checked && signals.ads.active === false) {
      reasons.push('aktiivista Meta-mainosta ei löytynyt');
    }
  }

  if (reasons.length === 0) {
    return { ...base, decision: 'unknown', reasons: ['Julkisia somelukuja ei saatu'] };
  }

  return { ...base, decision: 'weak', reasons };
}

function formatNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function shortError(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Instagram[^:]*:\s*/i, '')
    .slice(0, 120);
}

function isRateLimitMessage(value) {
  return /429|rate.?limit|rajoitti|please wait|odota|require_login|login/i.test(String(value || ''));
}
