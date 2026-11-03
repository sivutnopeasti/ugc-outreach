import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aiConfig } from './ai.mjs';
import { createMailer, resolveSmtpConfig } from './mail.mjs';
import { DEFAULT_THRESHOLDS } from './score.mjs';
import { defaultDeps, processFile } from './run.mjs';

export function readOptions(argv, env = process.env) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args.set(key, 'true');
    else {
      args.set(key, next);
      i += 1;
    }
  }
  if (args.get('mail-provider')) env = { ...env, MAIL_PROVIDER: args.get('mail-provider') };
  const outDir = path.resolve(args.get('out') || 'out');
  return {
    csvPath: args.get('csv') || '',
    outDir,
    send: args.has('send'),
    limit: Number(args.get('limit') || 0),
    delayMs: Number(args.get('delay-ms') || 1500),
    suppressionPath: path.resolve(args.get('suppression') || 'suppression.txt'),
    sentPath: path.join(outDir, 'lahetetyt.jsonl'),
    fromName: env.OUTREACH_FROM_NAME || '',
    fromEmail: env.OUTREACH_FROM_EMAIL || '',
    postalAddress: env.OUTREACH_POSTAL_ADDRESS || '',
    ai: aiConfig(env),
    smtp: resolveSmtpConfig(env),
    env,
    thresholds: {
      minFollowers: numberEnv(env.MIN_FOLLOWERS, DEFAULT_THRESHOLDS.minFollowers),
      minMedianLikes: numberEnv(env.MIN_MEDIAN_LIKES, DEFAULT_THRESHOLDS.minMedianLikes),
      minMedianComments: numberEnv(env.MIN_MEDIAN_COMMENTS, DEFAULT_THRESHOLDS.minMedianComments),
      minMedianViews: numberEnv(env.MIN_MEDIAN_VIEWS, DEFAULT_THRESHOLDS.minMedianViews),
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = readOptions(argv, env);
  if (!options.csvPath) {
    console.error('Anna CSV: node src/cli.mjs --csv yritykset.csv');
    process.exitCode = 1;
    return;
  }
  if (options.send && !options.smtp.host) {
    console.error('SMTP puuttuu. Aseta MAIL_PROVIDER=gmail (tai brevo) tai SMTP_HOST.');
    process.exitCode = 1;
    return;
  }
  const deliver = options.send ? await createMailer(options.env) : async () => {};
  const results = await processFile({
    csvPath: options.csvPath,
    outDir: options.outDir,
    options,
    deps: defaultDeps(options.env),
    deliver,
  });
  const weak = results.filter((row) => row.decision === 'weak').length;
  console.log(`Valmis. ${results.length} yritystä, heikko some ${weak}. Tulos: ${path.join(options.outDir, 'tulokset.csv')}`);
  if (!options.send) {
    console.log('Viestejä ei lähetetty. Ilmainen lähetys: MAIL_PROVIDER=gmail ja --send.');
  }
  if (options.ai.enabled) console.log(`AI käytössä (${options.ai.model} @ ${options.ai.baseUrl}).`);
  else console.log('AI pois päältä. Lisää AI_API_KEY vain jos haluat kahvaehdotuksia tai viestin hiontaa.');
}

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
