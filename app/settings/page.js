'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '../components/Shell';

const EMPTY_ACCOUNT = {
  id: '',
  fromName: '',
  fromEmail: '',
  mailProvider: 'gmail',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPass: '',
  enabled: true,
  smtpPassSet: false,
};

const EMPTY = {
  fromName: '',
  fromEmail: '',
  postalAddress: '',
  mailProvider: 'gmail',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPass: '',
  metaAccessToken: '',
  aiApiKey: '',
  aiBaseUrl: '',
  aiModel: 'gpt-4o-mini',
  minFollowers: 3000,
  minMedianLikes: 30,
  minMedianComments: 3,
  minMedianViews: 1000,
  testMode: true,
  testInboxEmail: '',
  maxEmailsPerDay: 6,
  maxEmailsPerDomain: 2,
  mailAccounts: [],
  appPassword: '',
};

export default function SettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({ aiKeySet: false, metaTokenSet: false });
  const [daily, setDaily] = useState({ total: 0, remainingToday: 6, maxEmailsPerDay: 6 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(async (res) => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        return res.json();
      })
      .then((body) => {
        if (!body?.settings) return;
        const accounts = (body.settings.mailAccounts || []).map((account) => ({
          ...EMPTY_ACCOUNT,
          ...account,
          smtpPass: '',
        }));
        if (accounts.length === 0 && body.settings.fromEmail) {
          accounts.push({
            ...EMPTY_ACCOUNT,
            id: 'account-1',
            fromName: body.settings.fromName || '',
            fromEmail: body.settings.fromEmail || '',
            mailProvider: body.settings.mailProvider || 'gmail',
            smtpHost: body.settings.smtpHost || '',
            smtpPort: body.settings.smtpPort || 587,
            smtpUser: body.settings.smtpUser || body.settings.fromEmail || '',
            smtpPassSet: Boolean(body.settings.smtpPassSet),
            enabled: true,
          });
        }
        setForm((current) => ({
          ...current,
          ...body.settings,
          maxEmailsPerDay: body.settings.maxEmailsPerDay || body.settings.maxSendPerBatch || 6,
          smtpPass: '',
          aiApiKey: '',
          metaAccessToken: '',
          appPassword: '',
          mailAccounts: accounts,
        }));
        if (body.daily) setDaily(body.daily);
        setMeta({
          aiKeySet: body.settings.aiKeySet,
          metaTokenSet: body.settings.metaTokenSet,
        });
      })
      .catch((err) => setError(err.message));
  }, [router]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateAccount(index, key, value) {
    setForm((current) => {
      const mailAccounts = current.mailAccounts.map((account, i) => (
        i === index ? { ...account, [key]: value } : account
      ));
      return { ...current, mailAccounts };
    });
  }

  function addAccount() {
    setForm((current) => ({
      ...current,
      mailAccounts: [
        ...current.mailAccounts,
        {
          ...EMPTY_ACCOUNT,
          id: `account-${Date.now()}`,
          fromName: current.fromName || '',
        },
      ],
    }));
  }

  function removeAccount(index) {
    setForm((current) => ({
      ...current,
      mailAccounts: current.mailAccounts.filter((_, i) => i !== index),
    }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const primary = form.mailAccounts.find((item) => item.enabled !== false) || form.mailAccounts[0];
      const payload = {
        ...form,
        fromEmail: primary?.fromEmail || form.fromEmail,
        smtpUser: primary?.smtpUser || form.smtpUser,
        mailProvider: primary?.mailProvider || form.mailProvider,
      };
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Tallennus epäonnistui');
      setMessage('Asetukset tallennettu.');
      const accounts = (body.settings.mailAccounts || []).map((account) => ({
        ...EMPTY_ACCOUNT,
        ...account,
        smtpPass: '',
      }));
      setForm((current) => ({
        ...current,
        ...body.settings,
        smtpPass: '',
        aiApiKey: '',
        metaAccessToken: '',
        appPassword: '',
        mailAccounts: accounts,
      }));
      setMeta({
        aiKeySet: body.settings.aiKeySet,
        metaTokenSet: body.settings.metaTokenSet,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <div className="hero">
        <div>
          <h1>Asetukset</h1>
          <p>Täytä nämä kerran. Tämän jälkeen kampanjat hoituvat etusivulta kuten Mailchimpissä.</p>
        </div>
      </div>
      <form className="panel grid" onSubmit={onSubmit}>
        <h2 style={{ margin: 0 }}>Lähettäjä</h2>
        <div className="grid two">
          <label>Nimi<input value={form.fromName} onChange={(e) => update('fromName', e.target.value)} required /></label>
          <label>Oletussähköposti<input type="email" value={form.fromEmail} onChange={(e) => update('fromEmail', e.target.value)} required /></label>
        </div>
        <label>Postiosoite<textarea value={form.postalAddress} onChange={(e) => update('postalAddress', e.target.value)} required /></label>

        <h2 style={{ marginBottom: 0 }}>Testitila</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          CSV ja Instagram analysoidaan normaalisti, mutta viestit eivät mene yrityksille — ne tulevat sinulle.
        </p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.testMode !== false}
            onChange={(e) => update('testMode', e.target.checked)}
          />
          Testitila päällä (suositus kunnes olet valmis oikeaan lähetykseen)
        </label>
        <label>
          Testiosoite (mihin viestit menevät)
          <input
            type="email"
            value={form.testInboxEmail}
            onChange={(e) => update('testInboxEmail', e.target.value)}
            placeholder={form.fromEmail || 'sama kuin lähettäjän sähköposti'}
          />
        </label>

        <h2 style={{ marginBottom: 0 }}>Lähetysrajat (per päivä)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Oletus testissä: 6 sähköpostia / päivä (Suomen aika). Tänään käytetty: <strong>{daily.total || 0}</strong> / {form.maxEmailsPerDay}.
        </p>
        <label>
          Max sähköposteja per päivä: <strong>{form.maxEmailsPerDay}</strong>
          <input
            className="range"
            type="range"
            min="1"
            max="50"
            step="1"
            value={form.maxEmailsPerDay}
            onChange={(e) => update('maxEmailsPerDay', Number(e.target.value))}
          />
          <div className="range-scale muted"><span>1</span><span>25</span><span>50</span></div>
        </label>
        <label>
          Max viestejä per lähettäjädomain / päivä
          <input
            type="number"
            min="1"
            max="50"
            value={form.maxEmailsPerDomain}
            onChange={(e) => update('maxEmailsPerDomain', e.target.value)}
          />
        </label>

        <h2 style={{ marginBottom: 0 }}>Lähettäjätilit (voit käyttää useita yhtä aikaa)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Automaatio kierrättää tilejä. Lisää useampi Gmail/Brevo, jos haluat jakaa lähetyksen.
        </p>
        {(form.mailAccounts || []).map((account, index) => (
          <div key={account.id || index} className="account-card grid">
            <div className="hero" style={{ marginBottom: 0 }}>
              <strong>Tili {index + 1}</strong>
              <button type="button" className="btn secondary" onClick={() => removeAccount(index)}>Poista</button>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={account.enabled !== false}
                onChange={(e) => updateAccount(index, 'enabled', e.target.checked)}
              />
              Käytä tätä tiliä lähetyksissä
            </label>
            <div className="grid two">
              <label>Lähettäjän sähköposti<input type="email" value={account.fromEmail} onChange={(e) => updateAccount(index, 'fromEmail', e.target.value)} required={index === 0} /></label>
              <label>
                Palvelu
                <select value={account.mailProvider || 'gmail'} onChange={(e) => updateAccount(index, 'mailProvider', e.target.value)}>
                  <option value="gmail">Gmail</option>
                  <option value="brevo">Brevo</option>
                  <option value="custom">Oma SMTP</option>
                </select>
              </label>
            </div>
            <div className="grid two">
              <label>SMTP-käyttäjä<input value={account.smtpUser} onChange={(e) => updateAccount(index, 'smtpUser', e.target.value)} placeholder={account.fromEmail || 'oma@gmail.com'} /></label>
              <label>
                SMTP-salasana {account.smtpPassSet ? '(tallennettu)' : ''}
                <input type="password" value={account.smtpPass} onChange={(e) => updateAccount(index, 'smtpPass', e.target.value)} placeholder="Gmail-sovellussalasana" />
              </label>
            </div>
            {account.mailProvider === 'custom' && (
              <div className="grid two">
                <label>SMTP-palvelin<input value={account.smtpHost} onChange={(e) => updateAccount(index, 'smtpHost', e.target.value)} /></label>
                <label>Portti<input type="number" value={account.smtpPort} onChange={(e) => updateAccount(index, 'smtpPort', e.target.value)} /></label>
              </div>
            )}
          </div>
        ))}
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn secondary" onClick={addAccount}>Lisää lähettäjätili</button>
        </div>

        <h2 style={{ marginBottom: 0 }}>Arvion rajat</h2>
        <div className="grid two">
          <label>Min. seuraajat<input type="number" value={form.minFollowers} onChange={(e) => update('minFollowers', e.target.value)} /></label>
          <label>Min. tykkäykset (mediaani)<input type="number" value={form.minMedianLikes} onChange={(e) => update('minMedianLikes', e.target.value)} /></label>
          <label>Min. kommentit (mediaani)<input type="number" value={form.minMedianComments} onChange={(e) => update('minMedianComments', e.target.value)} /></label>
          <label>Min. katselut (mediaani)<input type="number" value={form.minMedianViews} onChange={(e) => update('minMedianViews', e.target.value)} /></label>
        </div>

        <h2 style={{ marginBottom: 0 }}>Valinnainen tekoäly</h2>
        <p className="muted" style={{ marginTop: 0 }}>Voit jättää tyhjäksi. Tarvitaan vain, jos haluat AI-kahvaehdotuksia tai viestin hiontaa.</p>
        <label>AI API -avain {meta.aiKeySet ? '(tallennettu)' : ''}<input type="password" value={form.aiApiKey} onChange={(e) => update('aiApiKey', e.target.value)} /></label>
        <div className="grid two">
          <label>AI Base URL<input value={form.aiBaseUrl} onChange={(e) => update('aiBaseUrl', e.target.value)} placeholder="https://api.openai.com/v1" /></label>
          <label>Malli<input value={form.aiModel} onChange={(e) => update('aiModel', e.target.value)} /></label>
        </div>

        <h2 style={{ marginBottom: 0 }}>Turva</h2>
        <label>
          Vaihda sovelluksen salasana
          <input type="password" value={form.appPassword} onChange={(e) => update('appPassword', e.target.value)} placeholder="Jätä tyhjäksi jos ei vaihdeta" />
        </label>

        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <div className="actions">
          <button className="btn accent" disabled={loading}>{loading ? 'Tallennetaan…' : 'Tallenna asetukset'}</button>
        </div>
      </form>
    </Shell>
  );
}
