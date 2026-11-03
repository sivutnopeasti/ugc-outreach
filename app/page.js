'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from './components/Shell';

export default function HomePage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState([]);
  const [name, setName] = useState('');
  const [csvText, setCsvText] = useState('nimi;y_tunnus;verkkosivu\n');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [testInbox, setTestInbox] = useState('');

  async function load() {
    const res = await fetch('/api/campaigns');
    if (res.status === 401) {
      router.push('/login');
      return;
    }
    const body = await res.json();
    setCampaigns(body.campaigns || []);
  }

  async function loadSettings() {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const body = await res.json();
    if (!body.settings) return;
    setTestMode(body.settings.testMode !== false);
    setTestInbox(body.settings.testInboxEmail || body.settings.fromEmail || '');
  }

  useEffect(() => {
    loadSettings().catch(() => {});
    load().catch((err) => setError(err.message));
    const timer = setInterval(() => {
      load().catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  async function onFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    if (!name) setName(file.name.replace(/\.csv$/i, ''));
  }

  async function createCampaign(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, csvText }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Kampanjan luonti epäonnistui');
      router.push(`/campaigns/${body.campaign.id}`);
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
          <h1>Kampanjat</h1>
          <p>
            Lataa yrityslista, anna sovelluksen arvioida Instagram ja lähetä viesti vain heikoille tileille.
            Toimii kuin Mailchimp: ei komentoriviä.
          </p>
        </div>
      </div>

      {testMode && (
        <div className="banner-test" style={{ marginBottom: 16 }}>
          Testitila on päällä: CSV tutkitaan ja Instagram analysoidaan, mutta sähköpostit menevät sinulle
          {testInbox ? ` (${testInbox})` : ''}, ei yrityksille. Vaihda Asetuksista kun olet valmis.
        </div>
      )}

      <div className="grid" style={{ gap: 24 }}>
        <form className="panel grid" onSubmit={createCampaign}>
          <h2 style={{ margin: 0 }}>Uusi kampanja</h2>
          <label>
            Kampanjan nimi
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maaliskuun lista" />
          </label>
          <label>
            CSV-tiedosto
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>
          <label>
            CSV-sisältö
            <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={8} />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            Tarvitaan sarakkeet <code>nimi</code> ja <code>y_tunnus</code>. Verkkosivu, sähköposti ja Instagram ovat vapaaehtoisia.
          </p>
          {error && <div className="error">{error}</div>}
          <div className="actions">
            <button className="btn accent" disabled={loading}>
              {loading ? 'Käynnistetään…' : 'Analysoi Instagram'}
            </button>
          </div>
        </form>

        <section className="panel">
          <h2 style={{ marginTop: 0 }}>Aiemmat kampanjat</h2>
          {campaigns.length === 0 ? (
            <p className="muted">Ei vielä kampanjoita.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nimi</th>
                    <th>Tila</th>
                    <th>Edistyminen</th>
                    <th>Heikko</th>
                    <th>Lähetetty</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>
                        <Link href={`/campaigns/${campaign.id}`}>{campaign.name}</Link>
                        <div className="muted">{new Date(campaign.createdAt).toLocaleString('fi-FI')}</div>
                      </td>
                      <td><span className={`badge ${campaign.status}`}>{statusLabel(campaign.status)}</span></td>
                      <td>{campaign.progress}/{campaign.total || '–'}</td>
                      <td>{campaign.weakCount}</td>
                      <td>{campaign.sentCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

function statusLabel(status) {
  return ({
    queued: 'Jonossa',
    running: 'Analysoi',
    ready: 'Valmis',
    error: 'Virhe',
  })[status] || status;
}
