import { writeFile } from 'node:fs/promises';
import { aiConfig } from './ai.mjs';
import { createMailer } from './mail.mjs';
import { defaultDeps, evaluateCompany } from './run.mjs';
import { parseCsv, rowFromRecord } from './csv.mjs';
import { buildMessage } from './template.mjs';
import { getRun, getRunCsv, saveRun, settingsToEnv, readSettings, readSuppression } from './store.mjs';

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
    await saveRun(run);
    return run;
  }

  try {
    const result = await evaluateCompany(rows[index], deps, options);
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
    }
    run.results = [...(run.results || []), result];
    run.cursor = index + 1;
    run.progress = index + 1;
    run.message = `${result.name || result.businessId}: ${result.decision}`;
    if (run.cursor >= rows.length) {
      run.status = 'ready';
      run.message = 'Analyysi valmis';
    } else {
      run.status = 'running';
    }
    await saveRun(run);
    return run;
  } catch (error) {
    run.status = 'error';
    run.error = error.message || String(error);
    run.message = 'Analyysi epäonnistui';
    await saveRun(run);
    throw error;
  }
}

export async function sendSelected(runId, businessIds) {
  const settings = await readSettings();
  if (!settings.fromName || !settings.fromEmail || !settings.postalAddress) {
    throw Object.assign(new Error('Täytä lähettäjän nimi, sähköposti ja postiosoite asetuksissa'), { status: 400 });
  }
  if (!settings.smtpPass && !(settings.smtpUser && settings.mailProvider)) {
    throw Object.assign(new Error('Lisää Gmail-sovellussalasana asetuksiin ennen lähetystä'), { status: 400 });
  }

  const env = settingsToEnv(settings);
  const deliver = await createMailer(env);
  const suppressionText = await readSuppression();
  const suppressed = new Set(
    suppressionText
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#')),
  );

  let run = await getRun(runId);
  const wanted = new Set(businessIds);
  let sent = 0;

  for (const row of run.results) {
    if (!wanted.has(row.businessId)) continue;
    if (row.decision !== 'weak') continue;
    if (!row.email) {
      row.delivery = 'ei sähköpostia';
      continue;
    }
    if (suppressed.has(String(row.email).toLowerCase())) {
      row.delivery = 'estolistalla';
      continue;
    }
    if (row.delivery === 'lähetetty') continue;

    const message = buildMessage({
      companyName: row.name,
      businessId: row.businessId,
      instagramUrl: row.instagram,
      reasons: row.reasons || [],
      fromName: settings.fromName,
      fromEmail: settings.fromEmail,
      postalAddress: settings.postalAddress,
    });
    await deliver({
      to: row.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: {
        'List-Unsubscribe': `<mailto:${settings.fromEmail}?subject=Ei%20kiitos>`,
      },
    });
    row.delivery = 'lähetetty';
    row.sentAt = new Date().toISOString();
    sent += 1;
    await saveRun(run);
  }

  run.message = `Lähetetty ${sent} viestiä`;
  await saveRun(run);
  return { sent, run };
}

// Keep local CLI helper available if needed.
export async function dumpRunJson(run, filePath) {
  await writeFile(filePath, JSON.stringify(run, null, 2), 'utf8');
}
