import { writeFile } from 'node:fs/promises';
import { aiConfig } from './ai.mjs';
import {
  createAccountMailer,
  emailDomain,
  pickSenderAccount,
  resolveMailAccounts,
  resolveSendTarget,
} from './mail.mjs';
import { defaultDeps, evaluateCompany } from './run.mjs';
import { parseCsv, rowFromRecord } from './csv.mjs';
import { buildMessage } from './template.mjs';
import {
  getRun,
  getRunCsv,
  saveRun,
  settingsToEnv,
  readSettings,
  readSuppression,
  readDailySendStats,
  recordDailySend,
} from './store.mjs';

export async function prepareAnalysis(runId) {
  const run = await getRun(runId);
  const csvText = await getRunCsv(runId);
  const rows = parseCsv(csvText).map(rowFromRecord).filter((row) => row.name || row.businessId);
  run.status = 'running';
  run.total = rows.length;
  run.cursor = 0;
  run.progress = 0;
  run.results = [];
  run.message = 'Analysoidaan yrityksiä…';
  run.error = '';
  run.activity = [];
  run.pipeline = {
    active: true,
    stage: 'analyze',
    phase: 'start',
    label: 'Pipeline käynnistyy…',
    companyName: '',
    businessId: '',
    step: 0,
    total: rows.length,
    updatedAt: new Date().toISOString(),
  };
  await saveRun(run);
  return run;
}

/** Analysoi yhden yrityksen. Sopii Vercelin lyhyisiin funktioihin. */
export async function analyzeNext(runId) {
  const settings = await readSettings();
  const env = settingsToEnv(settings);
  const deps = defaultDeps(env);
  const options = {
    send: false,
    delayMs: 0,
    thresholds: {
      minFollowers: Number(settings.minFollowers || 3000),
      minMedianLikes: Number(settings.minMedianLikes || 30),
      minMedianComments: Number(settings.minMedianComments || 3),
      minMedianViews: Number(settings.minMedianViews || 1000),
    },
    ai: aiConfig(env),
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    postalAddress: settings.postalAddress,
  };

  let run = await getRun(runId);
  if (run.status === 'queued' || (run.status === 'running' && !run.total)) {
    run = await prepareAnalysis(runId);
  }
  if (run.status === 'ready') return run;
  if (run.status === 'error') return run;

  const csvText = await getRunCsv(runId);
  const rows = parseCsv(csvText).map(rowFromRecord).filter((row) => row.name || row.businessId);
  const index = run.cursor || 0;
  if (index >= rows.length) {
    run.status = 'ready';
    run.message = 'Analyysi valmis';
    run.pipeline = idlePipeline(run.total, 'Analyysi valmis');
    await saveRun(run);
    return run;
  }

  const current = rows[index];
  try {
    run.status = 'running';
    run.pipeline = {
      active: true,
      stage: 'analyze',
      phase: 'start',
      label: 'Aloitetaan yrityksen analyysi…',
      companyName: current.name || current.businessId || '',
      businessId: current.businessId || '',
      step: index + 1,
      total: rows.length,
      updatedAt: new Date().toISOString(),
    };
    run.message = `${current.name || current.businessId}: aloitetaan`;
    await saveRun(run);

    const result = await evaluateCompany(current, deps, {
      ...options,
      onProgress: async ({ phase, label, companyName }) => {
        const latest = await getRun(runId);
        latest.status = 'running';
        latest.pipeline = {
          active: true,
          stage: 'analyze',
          phase,
          label,
          companyName: companyName || current.name || current.businessId || '',
          businessId: current.businessId || '',
          step: index + 1,
          total: rows.length,
          updatedAt: new Date().toISOString(),
        };
        latest.message = `${latest.pipeline.companyName}: ${label}`;
        await saveRun(latest);
        Object.assign(run, latest);
      },
    });
    applyDeliveryState(result, settings);
    run.results = [...(run.results || []), result];
    run.cursor = index + 1;
    run.progress = index + 1;
    run.message = `${result.name || result.businessId}: ${result.decision}`;
    run.activity = [
      {
        at: new Date().toISOString(),
        companyName: result.name || result.businessId,
        businessId: result.businessId,
        decision: result.decision,
        detail: result.instagram
          ? `${result.decision} · ${result.instagram}`
          : result.decision,
      },
      ...(run.activity || []),
    ].slice(0, 40);
    if (run.cursor >= rows.length) {
      run.status = 'ready';
      run.message = 'Analyysi valmis';
      run.pipeline = idlePipeline(run.total, 'Analyysi valmis');
    } else {
      run.status = 'running';
      run.pipeline = {
        active: true,
        stage: 'analyze',
        phase: 'next',
        label: 'Siirrytään seuraavaan yritykseen…',
        companyName: rows[run.cursor]?.name || rows[run.cursor]?.businessId || '',
        businessId: rows[run.cursor]?.businessId || '',
        step: run.cursor + 1,
        total: rows.length,
        updatedAt: new Date().toISOString(),
      };
    }
    await saveRun(run);
    return run;
  } catch (error) {
    run.status = 'error';
    run.error = error.message || String(error);
    run.message = 'Analyysi epäonnistui';
    run.pipeline = {
      active: false,
      stage: 'error',
      phase: 'error',
      label: error.message || 'Analyysi epäonnistui',
      companyName: current.name || current.businessId || '',
      businessId: current.businessId || '',
      step: index + 1,
      total: rows.length,
      updatedAt: new Date().toISOString(),
    };
    await saveRun(run);
    throw error;
  }
}

function idlePipeline(total = 0, label = 'Valmis') {
  return {
    active: false,
    stage: 'idle',
    phase: 'done',
    label,
    companyName: '',
    businessId: '',
    step: total,
    total,
    updatedAt: new Date().toISOString(),
  };
}

export async function confirmInstagram(runId, { businessId, action }) {
  const settings = await readSettings();
  const run = await getRun(runId);
  const row = (run.results || []).find((item) => item.businessId === businessId);
  if (!row) {
    throw Object.assign(new Error('Yritystä ei löytynyt kampanjasta'), { status: 404 });
  }
  if (row.decision !== 'needs_review' && row.instagramConfidence !== 'needs_review') {
    throw Object.assign(new Error('Tällä rivillä ei ole vahvistettavaa Instagram-ehdokasta'), { status: 400 });
  }

  if (action === 'reject') {
    row.instagram = '';
    row.instagramConfidence = 'rejected';
    row.instagramScore = 0;
    row.decision = 'unknown';
    row.reasons = ['Instagram-ehdokas hylättiin manuaalisesti'];
    row.followers = '';
    row.medianLikes = '';
    row.medianComments = '';
    row.medianViews = '';
    row.pendingDecision = '';
    row.pendingReasons = [];
    row.previewSubject = '';
    row.previewText = '';
    row.delivery = 'ei lähetetä';
  } else if (action === 'confirm') {
    row.instagramConfidence = 'confirmed';
    row.decision = row.pendingDecision || 'weak';
    row.reasons = [
      'Instagram vahvistettu manuaalisesti',
      ...(row.pendingReasons || []),
    ];
    row.pendingDecision = '';
    row.pendingReasons = [];
    applyDeliveryState(row, settings);
  } else {
    throw Object.assign(new Error('action täytyy olla confirm tai reject'), { status: 400 });
  }

  await saveRun(run);
  return run;
}

export async function sendSelected(runId, businessIds) {
  const settings = await readSettings();
  if (!settings.fromName || !settings.postalAddress) {
    throw Object.assign(new Error('Täytä lähettäjän nimi ja postiosoite asetuksissa'), { status: 400 });
  }

  const accounts = resolveMailAccounts(settings);
  if (accounts.length === 0) {
    throw Object.assign(new Error('Lisää vähintään yksi lähettäjäosoite asetuksiin'), { status: 400 });
  }
  if (accounts.every((account) => !account.smtpPass)) {
    throw Object.assign(new Error('Lisää SMTP-salasana vähintään yhdelle lähettäjätilille'), { status: 400 });
  }

  const maxEmailsPerDay = Math.max(1, Number(settings.maxEmailsPerDay || settings.maxSendPerBatch) || 6);
  const maxEmailsPerDomain = Math.max(1, Number(settings.maxEmailsPerDomain) || 2);
  const mailers = new Map();
  for (const account of accounts) {
    mailers.set(account.id, await createAccountMailer({ ...account, fromName: account.fromName || settings.fromName }));
  }

  const suppressionText = await readSuppression();
  const suppressed = new Set(
    suppressionText
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#')),
  );

  let run = await getRun(runId);
  const wanted = new Set(businessIds);
  const daily = await readDailySendStats();
  const usageByDomain = { ...(daily.byDomain || {}) };
  let sentToday = Number(daily.total || 0);
  let sent = 0;
  let skippedLimit = 0;
  const processedIds = [];

  run.pipeline = {
    active: true,
    stage: 'send',
    phase: 'start',
    label: 'Aloitetaan sähköpostilähetys…',
    companyName: '',
    businessId: '',
    step: 0,
    total: businessIds.length,
    updatedAt: new Date().toISOString(),
  };
  await saveRun(run);

  for (const row of run.results) {
    if (!wanted.has(row.businessId)) continue;
    processedIds.push(row.businessId);

    if (row.decision === 'needs_review' || row.instagramConfidence === 'needs_review') {
      row.delivery = 'odottaa Instagram-vahvistusta';
      continue;
    }
    if (row.decision !== 'weak') continue;
    if (!row.email) {
      row.delivery = 'ei sähköpostia';
      continue;
    }
    if (suppressed.has(String(row.email).toLowerCase())) {
      row.delivery = 'estolistalla';
      continue;
    }
    if (row.sentAt || String(row.delivery || '').startsWith('lähetetty') || String(row.delivery || '').startsWith('testilähetys')) continue;

    if (sentToday >= maxEmailsPerDay) {
      row.delivery = `jonossa (päiväraja ${maxEmailsPerDay}/pv)`;
      skippedLimit += 1;
      continue;
    }

    const account = pickSenderAccount(accounts, usageByDomain, maxEmailsPerDomain);
    if (!account) {
      row.delivery = `jonossa (max ${maxEmailsPerDomain}/domain/pv)`;
      skippedLimit += 1;
      continue;
    }

    const fromEmail = account.fromEmail || account.smtpUser;
    const message = buildMessage({
      companyName: row.name,
      businessId: row.businessId,
      instagramUrl: row.instagram,
      reasons: row.reasons || [],
      fromName: account.fromName || settings.fromName,
      fromEmail,
      postalAddress: settings.postalAddress,
    });
    const target = resolveSendTarget({
      testMode: settings.testMode !== false,
      testInboxEmail: settings.testInboxEmail,
      fromEmail,
      companyEmail: row.email,
    });
    run.pipeline = {
      active: true,
      stage: 'send',
      phase: 'smtp',
      label: `Lähetetään viestiä: ${row.name || row.businessId}`,
      companyName: row.name || row.businessId || '',
      businessId: row.businessId || '',
      step: sent + 1,
      total: businessIds.length,
      updatedAt: new Date().toISOString(),
    };
    run.message = run.pipeline.label;
    await saveRun(run);

    const mailer = mailers.get(account.id);
    await mailer.send({
      to: target.to,
      subject: `${target.subjectPrefix}${message.subject}`,
      text: `${target.prefaceText}${message.text}`,
      html: `${target.prefaceHtml}${message.html}`,
      headers: {
        'List-Unsubscribe': `<mailto:${fromEmail}?subject=Ei%20kiitos>`,
        'X-UGC-Intended-Recipient': row.email,
        'X-UGC-Test-Mode': settings.testMode !== false ? '1' : '0',
        'X-UGC-Sender-Account': fromEmail,
      },
    });

    const domain = emailDomain(fromEmail);
    usageByDomain[domain] = (usageByDomain[domain] || 0) + 1;
    await recordDailySend({ domain, count: 1 });
    sentToday += 1;
    row.delivery = target.label;
    row.intendedEmail = row.email;
    row.sentTo = target.to;
    row.sentFrom = fromEmail;
    row.sentAt = new Date().toISOString();
    sent += 1;
    run.activity = [
      {
        at: new Date().toISOString(),
        companyName: row.name || row.businessId,
        businessId: row.businessId,
        decision: 'sent',
        detail: `lähetetty → ${target.to} (from ${fromEmail})`,
      },
      ...(run.activity || []),
    ].slice(0, 40);
    await saveRun(run);
  }

  const modeNote = settings.testMode !== false ? ' (testitila → sinulle)' : '';
  const limitNote = skippedLimit > 0 ? `, ${skippedLimit} jäi jonoon päivärajan takia` : '';
  run.message = `Lähetetty ${sent} viestiä${modeNote}${limitNote} · tänään ${sentToday}/${maxEmailsPerDay}`;
  run.pipeline = idlePipeline(run.total || businessIds.length, run.message);
  await saveRun(run);
  return {
    sent,
    skippedLimit,
    sentToday,
    remainingToday: Math.max(0, maxEmailsPerDay - sentToday),
    limitReached: skippedLimit > 0 || sentToday >= maxEmailsPerDay,
    maxEmailsPerDay,
    maxEmailsPerDomain,
    processedIds,
    run,
    testMode: settings.testMode !== false,
  };
}

function applyDeliveryState(result, settings) {
  if (result.decision === 'needs_review' || result.instagramConfidence === 'needs_review') {
    result.delivery = 'odottaa Instagram-vahvistusta';
    result.previewSubject = '';
    result.previewText = '';
    return result;
  }
  result.delivery = result.decision === 'weak' ? (result.email ? 'valmis lähetettäväksi' : 'ei sähköpostia') : 'ei lähetetä';
  if (result.decision === 'weak') {
    const message = buildMessage({
      companyName: result.name,
      businessId: result.businessId,
      instagramUrl: result.instagram,
      reasons: result.reasons,
      fromName: settings.fromName,
      fromEmail: settings.fromEmail,
      postalAddress: settings.postalAddress,
    });
    result.previewSubject = message.subject;
    result.previewText = message.text;
  } else {
    result.previewSubject = '';
    result.previewText = '';
  }
  return result;
}

// Keep local CLI helper available if needed.
export async function dumpRunJson(run, filePath) {
  await writeFile(filePath, JSON.stringify(run, null, 2), 'utf8');
}
