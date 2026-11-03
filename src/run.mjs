import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { aiConfig, polishOutreachMessage, suggestInstagramHandles } from './ai.mjs';
import { parseCsv, rowFromRecord, toCsv } from './csv.mjs';
import { findAtHandles, handleCandidatesFromName, scoreInstagramMatch } from './handles.mjs';
import { isInstagramRateLimitError } from './instagram.mjs';
import { assessPresence, usernameFromInstagram } from './score.mjs';
import { fetchAds, fetchInstagram, fetchSite, lookupCompany, normalizeWebsite, pickEmail } from './sources.mjs';
import { buildMessage } from './template.mjs';

const MAX_HANDLE_CANDIDATES = 2;

export async function loadRows(csvPath) {
  const text = await readFile(csvPath, 'utf8');
  return parseCsv(text).map(rowFromRecord).filter((row) => row.name || row.businessId);
}

export async function evaluateCompany(input, deps, options) {
  const result = blankResult(input);
  let officialName = input.name;
  const progress = async (phase, label) => {
    if (typeof options?.onProgress === 'function') {
      await options.onProgress({ phase, label, companyName: officialName || input.name || input.businessId });
    }
  };

  if (input.businessId && deps.lookupCompany) {
    await progress('prh', 'Haetaan yritystiedot YTJ:stä…');
    let company = null;
    try {
      company = await deps.lookupCompany(input.businessId);
    } catch (error) {
      result.decision = 'unknown';
      result.reasons = [`Kaupparekisterihaku epäonnistui: ${error.message}`];
      return finish(result, options);
    }
    if (!company) {
      result.decision = 'unknown';
      result.reasons = ['Y-tunnusta ei löytynyt kaupparekisteristä'];
      return finish(result, options);
    }
    officialName = company.name || officialName;
    result.name = officialName;
    if (!result.website) result.website = company.website || '';
    if (company.naturalPerson) {
      result.decision = 'skip';
      result.reasons = ['Yksityinen elinkeinonharjoittaja jätetään väliin'];
      return finish(result, options);
    }
    if (company.dissolved) {
      result.decision = 'skip';
      result.reasons = ['Yritys ei ole kaupparekisterissä aktiivinen'];
      return finish(result, options);
    }
  }

  if (!result.businessId) {
    result.decision = 'unknown';
    result.reasons = ['Y-tunnus puuttuu tai on väärän muotoinen'];
    return finish(result, options);
  }

  result.website = normalizeWebsite(result.website);
  let site = { ok: false, instagram: '', email: '', pageText: '' };
  if (result.website) {
    await progress('website', `Luetaan verkkosivua ${result.website}…`);
    try {
      site = await deps.fetchSite(result.website);
    } catch (error) {
      site = { ok: false, instagram: '', email: '', pageText: '', error: error.message };
    }
  }
  const foundOnWebsite = Boolean(!result.instagram && site.instagram);
  if (!result.instagram && site.instagram) result.instagram = site.instagram;
  if (!result.email && site.email) result.email = site.email;

  let profile = null;
  let instagramError = '';
  let instagramUsername = usernameFromInstagram(result.instagram);
  let match = { score: 0, confidence: 'none', reasons: [] };

  if (instagramUsername) {
    await progress('instagram', `Luetaan Instagram-tiliä @${instagramUsername}…`);
    ({ profile, instagramError } = await loadProfile(deps, instagramUsername, result));
    if (profile) {
      match = scoreInstagramMatch(profile, {
        name: officialName,
        website: result.website,
        companyEmail: result.email,
        foundOnWebsite: foundOnWebsite || Boolean(input.instagram),
      });
    }
  } else {
    await progress('instagram', options.ai?.enabled
      ? 'Etsitään Instagramia (nimet + Grok-ehdotukset)…'
      : 'Etsitään Instagramia nimen perusteella…');
    const discovered = await discoverInstagram({
      deps,
      options,
      companyName: officialName,
      website: result.website,
      companyEmail: result.email,
      pageText: site.pageText || '',
    });
    if (discovered.profile) {
      profile = discovered.profile;
      match = discovered.match;
      instagramUsername = discovered.username;
      result.instagram = `https://www.instagram.com/${discovered.username}/`;
      if (!result.email && profile.businessEmail) {
        result.email = pickEmail([profile.businessEmail], result.website || profile.externalUrl || '');
      }
    } else if (discovered.error) {
      instagramError = discovered.error;
    }
  }

  result.instagramConfidence = match.confidence === 'confirmed' || match.confidence === 'needs_review'
    ? match.confidence
    : (profile ? 'reject' : 'none');
  result.instagramScore = match.score || 0;
  result.instagramMatchReasons = match.reasons || [];

  await progress('score', 'Arvioidaan someaktiivisuutta…');
  let ads = { checked: false, active: null };
  try {
    ads = await deps.fetchAds(officialName);
  } catch {
    ads = { checked: false, active: null };
  }
  result.activeAds = ads.checked ? (ads.active ? 'kyllä' : 'ei') : 'ei tarkistettu';

  const assessment = assessPresence({
    website: result.website,
    websiteFetchFailed: Boolean(result.website) && site.ok === false && !profile,
    instagramUsername,
    instagramError,
    profile: match.confidence === 'reject' ? null : profile,
    ads,
  }, options.thresholds);

  result.followers = assessment.followers ?? '';
  result.medianLikes = assessment.medianLikes ?? '';
  result.medianComments = assessment.medianComments ?? '';
  result.medianViews = assessment.medianViews ?? '';

  if (match.confidence === 'needs_review') {
    result.decision = 'needs_review';
    result.pendingDecision = assessment.decision;
    result.pendingReasons = assessment.reasons;
    result.reasons = [
      ...(match.reasons || []),
      `Alustava somearvio: ${assessment.decision}`,
      ...(assessment.reasons || []),
    ];
    return finish(result, options);
  }

  if (match.confidence === 'reject' && profile) {
    result.instagram = '';
    result.instagramUsername = '';
    result.decision = assessment.decision === 'strong' ? 'unknown' : assessment.decision;
    result.reasons = [
      'Löytynyt Instagram-ehdokas hylättiin (liian heikko osuma)',
      ...(match.reasons || []),
      ...(assessment.decision === 'unknown' ? assessment.reasons : ['Somea ei voitu varmistaa yritykseen']),
    ];
    result.followers = '';
    result.medianLikes = '';
    result.medianComments = '';
    result.medianViews = '';
    return finish(result, options);
  }

  result.decision = assessment.decision;
  result.reasons = [
    ...(match.confidence === 'confirmed' ? (match.reasons || []).slice(0, 2) : []),
    ...assessment.reasons,
  ];
  return finish(result, options);
}

export async function processFile({ csvPath, outDir, options, deps, deliver }) {
  const rows = await loadRows(csvPath);
  const suppression = await loadSuppression(options.suppressionPath);
  const sent = await loadSent(options.sentPath);
  await mkdir(outDir, { recursive: true });
  const limited = rows.slice(0, options.limit || rows.length);
  const results = [];
  const ai = options.ai || { enabled: false };

  for (let index = 0; index < limited.length; index += 1) {
    const input = limited[index];
    const result = await evaluateCompany(input, deps, options);
    result.delivery = 'ei lähetetä';
    if (result.decision === 'weak') {
      let message = buildMessage({
        companyName: result.name,
        businessId: result.businessId,
        instagramUrl: result.instagram,
        reasons: result.reasons,
        fromName: options.fromName,
        fromEmail: options.fromEmail,
        postalAddress: options.postalAddress,
      });
      if (ai.enabled && deps.polishMessage) {
        try {
          message = await deps.polishMessage(message, { companyName: result.name });
        } catch (error) {
          result.reasons = [...result.reasons, `AI-viesti ohitettiin: ${error.message}`];
        }
      }
      const previewName = `${safeName(result.businessId || result.name)}.txt`;
      await writeFile(path.join(outDir, previewName), `${message.subject}\n\n${message.text}\n`, 'utf8');
      result.delivery = await maybeSend({ result, message, options, suppression, sent, deliver });
    }
    results.push(result);
    console.log(`${result.businessId || '–'}  ${result.name}  ${result.decision}  ${result.delivery}`);
    if (index < limited.length - 1 && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }

  await writeFile(path.join(outDir, 'tulokset.csv'), toCsv(results), 'utf8');
  return results;
}

async function loadProfile(deps, username, result) {
  try {
    const profile = await deps.fetchInstagram(username);
    if (profile?.username) result.instagram = `https://www.instagram.com/${profile.username}/`;
    if (!result.email && profile?.businessEmail) {
      result.email = pickEmail([profile.businessEmail], result.website || profile.externalUrl || '');
    }
    return { profile, instagramError: '' };
  } catch (error) {
    return { profile: null, instagramError: error.message };
  }
}

async function discoverInstagram({ deps, options, companyName, website, companyEmail, pageText }) {
  const candidates = [
    ...findAtHandles(pageText),
    ...handleCandidatesFromName(companyName),
  ];
  let aiError = '';
  if (options.ai?.enabled && deps.suggestHandles) {
    try {
      const suggested = await deps.suggestHandles({ companyName, website, pageText });
      candidates.push(...suggested);
    } catch (error) {
      aiError = `AI-kahvaehdotus epäonnistui: ${error.message}`;
    }
  }

  const tried = new Set();
  let bestReview = null;
  let lastFetchError = '';
  let attempts = 0;

  for (const raw of candidates) {
    const username = usernameFromInstagram(raw);
    if (!username || tried.has(username)) continue;
    tried.add(username);
    attempts += 1;
    if (attempts > MAX_HANDLE_CANDIDATES) break;
    try {
      const profile = await deps.fetchInstagram(username);
      const match = scoreInstagramMatch(profile, {
        name: companyName,
        website,
        companyEmail,
        foundOnWebsite: false,
      });
      if (match.confidence === 'confirmed') {
        return {
          profile,
          username: profile.username || username,
          match,
          error: aiError,
        };
      }
      if (match.confidence === 'needs_review') {
        if (!bestReview || match.score > bestReview.match.score) {
          bestReview = {
            profile,
            username: profile.username || username,
            match,
            error: aiError,
          };
        }
      }
    } catch (error) {
      lastFetchError = error.message || String(error);
      // Rate limit: stop guessing more handles so the rest of the batch can recover.
      if (isInstagramRateLimitError(error)) {
        return {
          profile: null,
          username: '',
          match: { score: 0, confidence: 'none', reasons: [] },
          error: lastFetchError || aiError,
        };
      }
    }
  }

  if (bestReview) return bestReview;
  return {
    profile: null,
    username: '',
    match: { score: 0, confidence: 'none', reasons: [] },
    error: aiError || lastFetchError,
  };
}

async function maybeSend({ result, message, options, suppression, sent, deliver }) {
  if (!result.email) return 'ei sähköpostia';
  if (suppression.has(result.email)) return 'estolistalla';
  if (sent.has(result.businessId)) return 'lähetetty aiemmin';
  if (!options.send) return 'esikatselu';
  if (!options.fromEmail || !options.fromName || !options.postalAddress) {
    return 'lähettäjän nimi, sähköposti tai postiosoite puuttuu';
  }
  await deliver({
    to: result.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: {
      'List-Unsubscribe': `<mailto:${options.fromEmail}?subject=Ei%20kiitos>`,
    },
  });
  await appendFile(options.sentPath, `${JSON.stringify({ businessId: result.businessId, email: result.email, at: new Date().toISOString() })}\n`);
  sent.add(result.businessId);
  return 'lähetetty';
}

function finish(result) {
  result.reasons = result.reasons || [];
  return result;
}

function blankResult(input) {
  return {
    name: input.name || '',
    businessId: input.businessId || '',
    website: input.website || '',
    instagram: input.instagram || '',
    email: input.email || '',
    followers: '',
    medianLikes: '',
    medianComments: '',
    medianViews: '',
    activeAds: 'ei tarkistettu',
    decision: 'unknown',
    reasons: [],
    delivery: '',
    instagramConfidence: 'none',
    instagramScore: 0,
    instagramMatchReasons: [],
    pendingDecision: '',
    pendingReasons: [],
  };
}

async function loadSuppression(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    return new Set(text.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter((line) => line && !line.startsWith('#')));
  } catch {
    return new Set();
  }
}

async function loadSent(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    const ids = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).businessId);
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'yritys';
}

export function defaultDeps(env = process.env) {
  const ai = aiConfig(env);
  const sessionId = env.IG_SESSIONID || '';
  return {
    lookupCompany,
    fetchSite,
    fetchInstagram: (username) => fetchInstagram(username, { sessionId }),
    fetchAds: (name) => fetchAds(name, env.META_ACCESS_TOKEN || ''),
    suggestHandles: (payload) => suggestInstagramHandles(payload, ai),
    polishMessage: (message, context) => polishOutreachMessage(message, context, ai),
  };
}
