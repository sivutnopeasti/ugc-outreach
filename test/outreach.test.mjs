import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { aiConfig, parseHandleList } from '../src/ai.mjs';
import { normalizeBusinessId, parseCsv, rowFromRecord } from '../src/csv.mjs';
import { handleCandidatesFromName, profileMatchesCompany, scoreInstagramMatch } from '../src/handles.mjs';
import { emailDomain, pickSenderAccount, resolveMailAccounts, resolveSendTarget, resolveSmtpConfig } from '../src/mail.mjs';
import { helsinkiDayKey } from '../src/store.mjs';
import { assessPresence } from '../src/score.mjs';
import { findInstagram, pickEmail } from '../src/sources.mjs';
import { evaluateCompany, processFile } from '../src/run.mjs';
import { CAMPAIGN_FORM_URL, buildMessage } from '../src/template.mjs';

test('CSV accepts Finnish semicolon headers and a business id', () => {
  const rows = parseCsv('Yrityksen nimi;Y-tunnus;Verkkosivu\n"Oy Testi, Ab";1234567-8;https://testi.fi\n').map(rowFromRecord);
  assert.equal(rows[0].name, 'Oy Testi, Ab');
  assert.equal(rows[0].businessId, '1234567-8');
  assert.equal(normalizeBusinessId('12345678'), '1234567-8');
});

test('a large public account is left alone', () => {
  const result = assessPresence({
    website: 'https://nokia.com',
    profile: {
      followers: 990906,
      posts: [{ likes: 1866, comments: 1504, views: 36997, isVideo: true }],
    },
    ads: { checked: false, active: null },
  });
  assert.equal(result.decision, 'strong');
});

test('a quiet account is weak', () => {
  const result = assessPresence({
    website: 'https://esimerkki.fi',
    instagramUsername: 'esimerkki',
    profile: {
      followers: 80,
      posts: [
        { likes: 2, comments: 0, views: null, isVideo: false },
        { likes: 1, comments: 0, views: 40, isVideo: true },
      ],
    },
    ads: { checked: true, active: false },
  });
  assert.equal(result.decision, 'weak');
  assert.match(result.reasons.join(' '), /80 seuraajaa/);
});

test('missing data is not treated as a weak account', () => {
  const blocked = assessPresence({
    website: 'https://esimerkki.fi',
    instagramUsername: 'esimerkki',
    instagramError: 'timeout',
    ads: { checked: false, active: null },
  });
  assert.equal(blocked.decision, 'unknown');

  const noSite = assessPresence({ ads: { checked: false, active: null } });
  assert.equal(noSite.decision, 'unknown');
});

test('instagram links and company emails are chosen from the website', () => {
  const html = '<a href="https://www.instagram.com/p/ABC123/">post</a> <a href="https://instagram.com/esimerkki/">ig</a> info@esimerkki.fi joku@gmail.com';
  assert.equal(findInstagram(html), 'https://www.instagram.com/esimerkki/');
  assert.equal(pickEmail(['joku@gmail.com', 'info@esimerkki.fi'], 'https://esimerkki.fi'), 'info@esimerkki.fi');
  assert.equal(pickEmail(['muu@toinen.fi'], 'https://esimerkki.fi'), '');
});

test('weak company gets a preview and is not mailed until send is on', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'ugc-'));
  const csvPath = path.join(outDir, 'yritykset.csv');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(csvPath, 'nimi;y_tunnus\nEsimerkki Oy;1234567-8\n', 'utf8');
  let sent = 0;
  const deps = {
    lookupCompany: async () => ({ name: 'Esimerkki Oy', website: 'https://esimerkki.fi', naturalPerson: false, dissolved: false }),
    fetchSite: async () => ({ ok: true, instagram: 'https://www.instagram.com/esimerkki/', email: 'info@esimerkki.fi' }),
    fetchInstagram: async () => ({ username: 'esimerkki', followers: 40, posts: [{ likes: 1, comments: 0, views: null, isVideo: false }], businessEmail: '' }),
    fetchAds: async () => ({ checked: false, active: null }),
  };
  const results = await processFile({
    csvPath,
    outDir,
    options: {
      send: false,
      delayMs: 0,
      suppressionPath: path.join(outDir, 'missing.txt'),
      sentPath: path.join(outDir, 'lahetetyt.jsonl'),
      fromName: 'UGC Suomi',
      fromEmail: 'tuki@ugcsuomi.fi',
      postalAddress: 'Esimerkkikatu 1, 00100 Helsinki',
      thresholds: { minFollowers: 3000, minMedianLikes: 30, minMedianComments: 3, minMedianViews: 1000 },
    },
    deps,
    deliver: async () => { sent += 1; },
  });
  assert.equal(results[0].decision, 'weak');
  assert.equal(results[0].delivery, 'esikatselu');
  assert.equal(sent, 0);
  const preview = await readFile(path.join(outDir, '1234567-8.txt'), 'utf8');
  assert.match(preview, new RegExp(CAMPAIGN_FORM_URL.replaceAll('/', '\\/')));
  assert.match(preview, /Ei kiitos/);
});

test('send delivers one message and records the business id', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'ugc-send-'));
  const csvPath = path.join(outDir, 'yritykset.csv');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(csvPath, 'nimi;y_tunnus;email\nEsimerkki Oy;1234567-8;info@esimerkki.fi\n', 'utf8');
  const sentTo = [];
  const deps = {
    lookupCompany: async () => ({ name: 'Esimerkki Oy', website: 'https://esimerkki.fi', naturalPerson: false, dissolved: false }),
    fetchSite: async () => ({ ok: true, instagram: '', email: '' }),
    fetchInstagram: async () => { throw new Error('ei tiliä'); },
    fetchAds: async () => ({ checked: true, active: false }),
  };
  const results = await processFile({
    csvPath,
    outDir,
    options: {
      send: true,
      delayMs: 0,
      suppressionPath: path.join(outDir, 'missing.txt'),
      sentPath: path.join(outDir, 'lahetetyt.jsonl'),
      fromName: 'UGC Suomi',
      fromEmail: 'tuki@ugcsuomi.fi',
      postalAddress: 'Esimerkkikatu 1, 00100 Helsinki',
      thresholds: { minFollowers: 3000, minMedianLikes: 30, minMedianComments: 3, minMedianViews: 1000 },
    },
    deps,
    deliver: async (message) => { sentTo.push(message.to); },
  });
  assert.deepEqual(sentTo, ['info@esimerkki.fi']);
  assert.equal(results[0].delivery, 'lähetetty');
  const again = await processFile({
    csvPath,
    outDir,
    options: {
      send: true,
      delayMs: 0,
      suppressionPath: path.join(outDir, 'missing.txt'),
      sentPath: path.join(outDir, 'lahetetyt.jsonl'),
      fromName: 'UGC Suomi',
      fromEmail: 'tuki@ugcsuomi.fi',
      postalAddress: 'Esimerkkikatu 1, 00100 Helsinki',
      thresholds: { minFollowers: 3000, minMedianLikes: 30, minMedianComments: 3, minMedianViews: 1000 },
    },
    deps,
    deliver: async (message) => { sentTo.push(message.to); },
  });
  assert.equal(again[0].delivery, 'lähetetty aiemmin');
  assert.deepEqual(sentTo, ['info@esimerkki.fi']);
});

test('message names the company and the form', () => {
  const message = buildMessage({
    companyName: 'Esimerkki Oy',
    businessId: '1234567-8',
    instagramUrl: 'https://www.instagram.com/esimerkki/',
    reasons: ['40 seuraajaa'],
    fromName: 'UGC Suomi',
    fromEmail: 'tuki@ugcsuomi.fi',
    postalAddress: 'Esimerkkikatu 1, 00100 Helsinki',
  });
  assert.match(message.subject, /Esimerkki Oy/);
  assert.match(message.text, /40 seuraajaa/);
  assert.match(message.text, /ugcsuomi\.fi\/ilmoita-kampanjasta-sisallontuottajille/);
});

test('gmail preset fills free SMTP settings', () => {
  const smtp = resolveSmtpConfig({ MAIL_PROVIDER: 'gmail', SMTP_USER: 'a@gmail.com', SMTP_PASS: 'x' });
  assert.equal(smtp.host, 'smtp.gmail.com');
  assert.equal(smtp.port, 587);
});

test('handle candidates stay free and require a company match', () => {
  assert.ok(handleCandidatesFromName('Esimerkki Oy').includes('esimerkki'));
  assert.equal(
    profileMatchesCompany(
      { username: 'esimerkki', fullName: 'Esimerkki', externalUrl: 'https://esimerkki.fi' },
      { name: 'Esimerkki Oy', website: 'https://www.esimerkki.fi' },
    ),
    true,
  );
  assert.equal(
    profileMatchesCompany(
      { username: 'randomfood', fullName: 'Food Blog', externalUrl: 'https://muu.fi' },
      { name: 'Esimerkki Oy', website: 'https://esimerkki.fi' },
    ),
    false,
  );
});

test('bio name alone is needs_review, bio+domain is confirmed', () => {
  const review = scoreInstagramMatch(
    {
      username: 'joku',
      fullName: '',
      biography: 'Esimerkki Oy — paikallinen palvelu',
      externalUrl: '',
      bioLinks: [],
    },
    { name: 'Esimerkki Oy', website: 'https://esimerkki.fi' },
  );
  assert.equal(review.confidence, 'needs_review');
  assert.ok(review.score >= 3);

  const confirmed = scoreInstagramMatch(
    {
      username: 'esimerkki',
      fullName: 'Esimerkki',
      biography: 'Virallinen tili Esimerkki Oy',
      externalUrl: 'https://esimerkki.fi',
      bioLinks: [],
    },
    { name: 'Esimerkki Oy', website: 'https://www.esimerkki.fi' },
  );
  assert.equal(confirmed.confidence, 'confirmed');
  assert.ok(confirmed.score >= 5);
});

test('AI handle parsing accepts a JSON array', () => {
  assert.deepEqual(parseHandleList('["esimerkki","esimerkkioy"]'), ['esimerkki', 'esimerkkioy']);
});

test('GROK_TOKEN enables xAI Grok defaults', () => {
  const config = aiConfig({ GROK_TOKEN: 'test-token' });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, 'grok');
  assert.equal(config.baseUrl, 'https://api.x.ai/v1');
  assert.equal(config.model, 'grok-3-mini');
});

test('name-based Instagram discovery verifies the public profile', async () => {
  const result = await evaluateCompany(
    { name: 'Esimerkki Oy', businessId: '1234567-8', website: '', email: '', instagram: '' },
    {
      lookupCompany: async () => ({ name: 'Esimerkki Oy', website: 'https://esimerkki.fi', naturalPerson: false, dissolved: false }),
      fetchSite: async () => ({ ok: true, instagram: '', email: 'info@esimerkki.fi', pageText: 'Tervetuloa' }),
      fetchInstagram: async (username) => {
        if (username !== 'esimerkki') throw new Error('ei');
        return {
          username: 'esimerkki',
          fullName: 'Esimerkki Oy',
          biography: 'Esimerkki Oy virallinen',
          followers: 40,
          externalUrl: 'https://esimerkki.fi',
          bioLinks: [],
          posts: [{ likes: 1, comments: 0, views: null, isVideo: false }],
          businessEmail: '',
        };
      },
      fetchAds: async () => ({ checked: false, active: null }),
    },
    { thresholds: { minFollowers: 3000, minMedianLikes: 30, minMedianComments: 3, minMedianViews: 1000 }, ai: { enabled: false } },
  );
  assert.equal(result.decision, 'weak');
  assert.equal(result.instagramConfidence, 'confirmed');
  assert.equal(result.instagram, 'https://www.instagram.com/esimerkki/');
  assert.equal(result.followers, 40);
});

test('uncertain Instagram match waits for manual review', async () => {
  const result = await evaluateCompany(
    { name: 'Esimerkki Oy', businessId: '1234567-8', website: '', email: '', instagram: '' },
    {
      lookupCompany: async () => ({ name: 'Esimerkki Oy', website: 'https://esimerkki.fi', naturalPerson: false, dissolved: false }),
      fetchSite: async () => ({ ok: true, instagram: '', email: 'info@esimerkki.fi', pageText: 'Tervetuloa' }),
      fetchInstagram: async (username) => {
        if (username !== 'esimerkki') throw new Error('ei');
        return {
          username: 'esimerkki',
          fullName: '',
          biography: 'Terveisiä Esimerkki Oy:ltä',
          followers: 40,
          externalUrl: '',
          bioLinks: [],
          posts: [{ likes: 1, comments: 0, views: null, isVideo: false }],
          businessEmail: '',
        };
      },
      fetchAds: async () => ({ checked: false, active: null }),
    },
    { thresholds: { minFollowers: 3000, minMedianLikes: 30, minMedianComments: 3, minMedianViews: 1000 }, ai: { enabled: false } },
  );
  assert.equal(result.decision, 'needs_review');
  assert.equal(result.instagramConfidence, 'needs_review');
  assert.equal(result.pendingDecision, 'weak');
});

test('helsinki day key is YYYY-MM-DD', () => {
  assert.match(helsinkiDayKey(new Date('2026-11-03T12:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
});

test('sender accounts rotate within domain limits', () => {
  const accounts = resolveMailAccounts({
    fromName: 'UGC',
    mailAccounts: [
      { id: 'a', fromEmail: 'a@gmail.com', smtpUser: 'a@gmail.com', smtpPass: 'x', enabled: true },
      { id: 'b', fromEmail: 'b@gmail.com', smtpUser: 'b@gmail.com', smtpPass: 'y', enabled: true },
      { id: 'c', fromEmail: 'c@outlook.com', smtpUser: 'c@outlook.com', smtpPass: 'z', enabled: true },
    ],
  });
  assert.equal(accounts.length, 3);
  assert.equal(emailDomain('a@gmail.com'), 'gmail.com');

  const usage = {};
  const first = pickSenderAccount(accounts, usage, 1);
  usage[emailDomain(first.fromEmail)] = 1;
  const second = pickSenderAccount(accounts, usage, 1);
  assert.equal(emailDomain(second.fromEmail), 'outlook.com');
  usage[emailDomain(second.fromEmail)] = 1;
  assert.equal(pickSenderAccount(accounts, usage, 1), null);
});

test('test mode redirects mail to the operator inbox', () => {
  const live = resolveSendTarget({
    testMode: false,
    testInboxEmail: 'me@ugcsuomi.fi',
    fromEmail: 'me@ugcsuomi.fi',
    companyEmail: 'info@yritys.fi',
  });
  assert.equal(live.to, 'info@yritys.fi');
  assert.equal(live.subjectPrefix, '');

  const test = resolveSendTarget({
    testMode: true,
    testInboxEmail: '',
    fromEmail: 'me@ugcsuomi.fi',
    companyEmail: 'info@yritys.fi',
  });
  assert.equal(test.to, 'me@ugcsuomi.fi');
  assert.equal(test.subjectPrefix, '[TEST] ');
  assert.match(test.prefaceText, /info@yritys\.fi/);
  assert.match(test.label, /testilähetys/);
});

test('evaluateCompany skips a sole trader', async () => {
  const result = await evaluateCompany(
    { name: 'Matti', businessId: '1234567-8', website: '', email: '', instagram: '' },
    {
      lookupCompany: async () => ({ name: 'Matti Meikäläinen', website: '', naturalPerson: true, dissolved: false }),
      fetchSite: async () => { throw new Error('ei pitäisi hakea'); },
      fetchInstagram: async () => null,
      fetchAds: async () => ({ checked: false, active: null }),
    },
    { thresholds: { minFollowers: 3000, minMedianLikes: 30, minMedianComments: 3, minMedianViews: 1000 } },
  );
  assert.equal(result.decision, 'skip');
});
