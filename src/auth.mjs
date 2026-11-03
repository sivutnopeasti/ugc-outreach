import { cookies } from 'next/headers';
import { readSettings, sessionValid, secretsEqual, hashSecret, createSession, writeSettings } from './store.mjs';

export const SESSION_COOKIE = 'ugc_outreach_session';

export async function requireSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value || '';
  if (!(await sessionValid(token))) {
    const error = new Error('Kirjaudu sisään');
    error.status = 401;
    throw error;
  }
}

export async function loginWithPassword(password) {
  const settings = await readSettings();
  if (!settings.appPasswordHash) {
    const error = new Error('Aseta ensin sovelluksen salasana asetuksissa');
    error.status = 400;
    throw error;
  }
  if (!secretsEqual(settings.appPasswordHash, hashSecret(password))) {
    const error = new Error('Väärä salasana');
    error.status = 401;
    throw error;
  }
  return createSession();
}

export async function bootstrapAdmin({ password, fromName, fromEmail, postalAddress }) {
  const settings = await readSettings();
  if (settings.appPasswordHash) {
    const error = new Error('Sovellus on jo alustettu. Kirjaudu sisään.');
    error.status = 400;
    throw error;
  }
  if (!password || password.length < 8) {
    const error = new Error('Salasanan tulee olla vähintään 8 merkkiä');
    error.status = 400;
    throw error;
  }
  return writeSettings({
    appPassword: password,
    fromName: fromName || '',
    fromEmail: fromEmail || '',
    postalAddress: postalAddress || '',
    mailProvider: 'gmail',
  });
}
