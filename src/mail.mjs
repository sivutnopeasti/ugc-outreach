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
  return createAccountMailer({
    fromName: env.OUTREACH_FROM_NAME || '',
    fromEmail: env.OUTREACH_FROM_EMAIL || '',
    mailProvider: config.provider,
    smtpHost: config.host,
    smtpPort: config.port,
    smtpUser: config.user,
    smtpPass: config.pass,
  });
}

export async function createAccountMailer(account) {
  const provider = String(account.mailProvider || 'gmail').toLowerCase();
  const preset = SMTP_PRESETS[provider] || null;
  const host = account.smtpHost || preset?.host || '';
  const port = Number(account.smtpPort || preset?.port || 587);
  const secure = port === 465 || Boolean(preset?.secure);
  if (!host) {
    throw new Error(`SMTP-palvelin puuttuu tililtä ${account.fromEmail || account.smtpUser || ''}`);
  }
  if (!account.smtpPass && account.smtpUser) {
    throw new Error(`SMTP-salasana puuttuu tililtä ${account.fromEmail || account.smtpUser}`);
  }
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: account.smtpUser ? { user: account.smtpUser, pass: account.smtpPass } : undefined,
  });
  const fromEmail = account.fromEmail || account.smtpUser || '';
  const fromName = account.fromName || '';
  return {
    account,
    send: (message) => transporter.sendMail({
      from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      to: message.to,
      replyTo: fromEmail,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    }),
  };
}

/** Yhdistää vanhan yksittäisen SMTP:n ja uudet mailAccounts-rivit. */
export function resolveMailAccounts(settings = {}) {
  const sharedName = settings.fromName || '';
  const raw = Array.isArray(settings.mailAccounts) ? settings.mailAccounts : [];
  const accounts = raw
    .map((item, index) => normalizeAccount(item, index, sharedName))
    .filter((item) => item.enabled !== false && (item.fromEmail || item.smtpUser));

  if (accounts.length > 0) return accounts;

  if (settings.fromEmail || settings.smtpUser) {
    return [normalizeAccount({
      id: 'legacy',
      fromName: sharedName,
      fromEmail: settings.fromEmail || settings.smtpUser || '',
      mailProvider: settings.mailProvider || 'gmail',
      smtpHost: settings.smtpHost || '',
      smtpPort: settings.smtpPort || 587,
      smtpUser: settings.smtpUser || settings.fromEmail || '',
      smtpPass: settings.smtpPass || '',
      enabled: true,
    }, 0, sharedName)];
  }
  return [];
}

export function emailDomain(value) {
  const email = String(value || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return email.slice(at + 1);
}

/**
 * Valitsee seuraavan lähettäjätilin rotaatiolla.
 * maxEmailsPerDomain rajoittaa saman lähettäjädomainin (esim. gmail.com) käyttöä.
 */
export function pickSenderAccount(accounts, usageByDomain, maxEmailsPerDomain) {
  const limit = Math.max(1, Number(maxEmailsPerDomain) || 1);
  const eligible = accounts.filter((account) => {
    const domain = emailDomain(account.fromEmail || account.smtpUser);
    return (usageByDomain[domain] || 0) < limit;
  });
  if (eligible.length === 0) return null;

  let best = eligible[0];
  let bestCount = usageByDomain[emailDomain(best.fromEmail || best.smtpUser)] || 0;
  for (const account of eligible.slice(1)) {
    const domain = emailDomain(account.fromEmail || account.smtpUser);
    const count = usageByDomain[domain] || 0;
    if (count < bestCount) {
      best = account;
      bestCount = count;
    }
  }
  return best;
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

export function publicMailAccounts(accounts = []) {
  return (Array.isArray(accounts) ? accounts : []).map((item, index) => ({
    id: item.id || `account-${index + 1}`,
    fromName: item.fromName || '',
    fromEmail: item.fromEmail || '',
    mailProvider: item.mailProvider || 'gmail',
    smtpHost: item.smtpHost || '',
    smtpPort: item.smtpPort || 587,
    smtpUser: item.smtpUser || '',
    smtpPassSet: Boolean(item.smtpPass),
    enabled: item.enabled !== false,
  }));
}

export function mergeMailAccounts(incoming = [], current = []) {
  const previous = new Map((Array.isArray(current) ? current : []).map((item) => [item.id, item]));
  return (Array.isArray(incoming) ? incoming : [])
    .map((item, index) => {
      const id = item.id || `account-${index + 1}`;
      const old = previous.get(id) || {};
      return normalizeAccount({
        ...old,
        ...item,
        id,
        smtpPass: item.smtpPass ? item.smtpPass : (old.smtpPass || ''),
      }, index, item.fromName || old.fromName || '');
    })
    .filter((item) => item.fromEmail || item.smtpUser);
}

function normalizeAccount(item = {}, index = 0, sharedName = '') {
  return {
    id: item.id || `account-${index + 1}`,
    fromName: item.fromName || sharedName || '',
    fromEmail: String(item.fromEmail || '').trim().toLowerCase(),
    mailProvider: item.mailProvider || 'gmail',
    smtpHost: item.smtpHost || '',
    smtpPort: Number(item.smtpPort || 587),
    smtpUser: String(item.smtpUser || item.fromEmail || '').trim(),
    smtpPass: item.smtpPass || '',
    enabled: item.enabled !== false,
  };
}
