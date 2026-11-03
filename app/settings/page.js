'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '../components/Shell';

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
  appPassword: '',
};

export default function SettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({ smtpPassSet: false, aiKeySet: false, metaTokenSet: false });
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
        setForm((current) => ({ ...current, ...body.settings, smtpPass: '', aiApiKey: '', metaAccessToken: '', appPassword: '' }));
        setMeta({
          smtpPassSet: body.settings.smtpPassSet,
          aiKeySet: body.settings.aiKeySet,
          metaTokenSet: body.settings.metaTokenSet,
        });
      })
      .catch((err) => setError(err.message));
  }, [router]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Tallennus epäonnistui');
      setMessage('Asetukset tallennettu.');
      setForm((current) => ({ ...current, smtpPass: '', aiApiKey: '', metaAccessToken: '', appPassword: '' }));
      setMeta({
        smtpPassSet: body.settings.smtpPassSet,
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
          <label>Sähköposti<input type="email" value={form.fromEmail} onChange={(e) => update('fromEmail', e.target.value)} required /></label>
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

        <h2 style={{ marginBottom: 0 }}>Ilmainen sähköpostilähetys</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Suositus: Gmail-sovellussalasana. Vaihtoehto: Brevo-ilmaistili.
        </p>
        <div className="grid two">
          <label>
            Palvelu
            <select value={form.mailProvider} onChange={(e) => update('mailProvider', e.target.value)}>
              <option value="gmail">Gmail (ilmainen)</option>
              <option value="brevo">Brevo (ilmainen)</option>
              <option value="custom">Oma SMTP</option>
            </select>
          </label>
          <label>SMTP-käyttäjä<input value={form.smtpUser} onChange={(e) => update('smtpUser', e.target.value)} placeholder="oma@gmail.com" /></label>
        </div>
        <label>
          SMTP-salasana {meta.smtpPassSet ? '(tallennettu — jätä tyhjäksi jos ei vaihdeta)' : ''}
          <input type="password" value={form.smtpPass} onChange={(e) => update('smtpPass', e.target.value)} placeholder="Gmail-sovellussalasana" />
        </label>
        {form.mailProvider === 'custom' && (
          <div className="grid two">
            <label>SMTP-palvelin<input value={form.smtpHost} onChange={(e) => update('smtpHost', e.target.value)} /></label>
            <label>Portti<input type="number" value={form.smtpPort} onChange={(e) => update('smtpPort', e.target.value)} /></label>
          </div>
        )}

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
