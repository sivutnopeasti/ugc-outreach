/** Ilmaiset tai lähes ilmaiset SMTP-esiasetukset. */
export const SMTP_PRESETS = {
  gmail: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    note: 'Google-tili → 2-vaiheinen vahvistus → Sovellussalasana. Ilmainen, tyypillisesti ~100–500 viestiä/vrk.',
  },
  brevo: {
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    note: 'Brevo (ent. Sendinblue) ilmainen SMTP, tyypillisesti 300 viestiä/vrk.',
  },
};

export function resolveSmtpConfig(env = process.env) {
  const provider = String(env.MAIL_PROVIDER || '').trim().toLowerCase();
  const preset = SMTP_PRESETS[provider] || null;
  const host = env.SMTP_HOST || preset?.host || '';
  const port = Number(env.SMTP_PORT || preset?.port || 587);
  const secure = env.SMTP_SECURE === 'true' || port === 465 || Boolean(preset?.secure);
  return {
    provider: provider || 'custom',
    host,
    port,
    secure,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    presetNote: preset?.note || '',
  };
}

export async function createMailer(env = process.env) {
  const config = resolveSmtpConfig(env);
  if (!config.host) {
    throw new Error('SMTP_HOST tai MAIL_PROVIDER (gmail|brevo) puuttuu.');
  }
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
  return (message) => transporter.sendMail({
    from: `"${env.OUTREACH_FROM_NAME}" <${env.OUTREACH_FROM_EMAIL}>`,
    to: message.to,
    replyTo: env.OUTREACH_FROM_EMAIL,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: message.headers,
  });
}

/** Testitilassa viesti ohjataan käyttäjälle, ei yritykselle. */
export function resolveSendTarget({ testMode, testInboxEmail, fromEmail, companyEmail }) {
  const intended = String(companyEmail || '').trim();
  if (!testMode) {
    return { to: intended, subjectPrefix: '', prefaceText: '', prefaceHtml: '', label: 'lähetetty' };
  }
  const to = String(testInboxEmail || fromEmail || '').trim();
  if (!to) {
    throw Object.assign(new Error('Testitila on päällä, mutta testiosoitetta / lähettäjän sähköpostia ei ole asetettu'), { status: 400 });
  }
  return {
    to,
    subjectPrefix: '[TEST] ',
    prefaceText: `TESTITILA — tätä viestiä EI lähetetty yritykselle.\nAlkuperäinen vastaanottaja: ${intended}\n\n`,
    prefaceHtml: `<p><strong>TESTITILA</strong> — tätä viestiä EI lähetetty yritykselle.<br>Alkuperäinen vastaanottaja: ${intended}</p><hr>`,
    label: `testilähetys → ${to}`,
  };
}
