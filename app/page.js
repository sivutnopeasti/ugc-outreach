'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from './components/Shell';
import { readJson } from './lib/api';
import { analyzeCsvFileText, buildCsvBatch } from './lib/csvBatch';

const MAX_BATCH = 300;

export default function HomePage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState([]);
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const [totalRows, setTotalRows] = useState(0);
  const [offset, setOffset] = useState(0);
  const [batchSize, setBatchSize] = useState(100);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [testInbox, setTestInbox] = useState('');

  const batchPreview = useMemo(() => {
    if (!fileText || totalRows < 1) return null;
    try {
      return buildCsvBatch(fileText, offset, batchSize);
    } catch {
      return null;
    }
  }, [fileText, offset, batchSize, totalRows]);

  async function load() {
    const res = await fetch('/api/campaigns');
    if (res.status === 401) {
      router.push('/login');
      return;
    }
    const body = await readJson(res);
    setCampaigns(body.campaigns || []);
  }

  async function loadSettings() {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const body = await readJson(res);
    if (!body.settings) return;
    setTestMode(body.settings.testMode !== false);
    setTestInbox(body.settings.testInboxEmail || body.settings.fromEmail || '');
  }

  useEffect(() => {
    loadSettings().catch(() => {});
    load().catch((err) => setError(err.message));
    try {
      const saved = JSON.parse(sessionStorage.getItem('ugc-csv-batch') || 'null');
      if (saved?.fileText) {
        const info = analyzeCsvFileText(saved.fileText);
        setFileText(saved.fileText);
        setFileName(saved.fileName || '');
        setTotalRows(info.totalRows);
        setOffset(Number(saved.nextOffset || 0));
        setBatchSize(100);
        setWarning(`Jatka erää: seuraavat rivit alkaen ${Number(saved.nextOffset || 0) + 1} / ${info.totalRows}.`);
      }
    } catch {
      /* ignore */
    }
    const timer = setInterval(() => {
      load().catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  async function onFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setWarning('');
    const text = await file.text();
    const info = analyzeCsvFileText(text);
    setFileText(text);
    setFileName(file.name);
    setTotalRows(info.totalRows);
    setOffset(0);
    if (!name) setName(file.name.replace(/\.(csv|txt)$/i, ''));
    if (info.totalRows > MAX_BATCH) {
      setBatchSize(100);
      setWarning(
        `Tiedostossa on ${info.totalRows.toLocaleString('fi-FI')} riviä. `
        + 'Koko listaa ei ladata kerralla (Vercel-raja). Analysoi erissä, esim. 100 riviä kerrallaan.',
      );
    } else {
      setBatchSize(Math.min(MAX_BATCH, Math.max(1, info.totalRows)));
    }
  }

  async function createCampaign(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (!fileText) throw new Error('Valitse ensin CSV-tiedosto');
      const batch = buildCsvBatch(fileText, offset, batchSize);
      const form = new FormData();
      form.set('name', name || `Erä ${batch.offset + 1}–${batch.offset + batch.batchSize}`);
      form.set('offset', '0');
      form.set('sourceOffset', String(batch.offset));
      form.set('batchSize', String(batch.batchSize));
      form.set('sourceTotalRows', String(batch.totalRows));
      // Upload ONLY the sliced batch — never the full 35k file.
      form.set('file', new Blob([batch.csvText], { type: 'text/csv' }), fileName || 'era.csv');

      try {
        sessionStorage.setItem('ugc-csv-batch', JSON.stringify({
          fileName,
          nextOffset: batch.nextOffset,
          sourceTotal: batch.totalRows,
          // Keep file text only if reasonably small for next-batch UX (< ~8MB).
          fileText: fileText.length < 8_000_000 ? fileText : '',
        }));
      } catch {
        /* private mode / quota */
      }

      const res = await fetch('/api/campaigns', {
        method: 'POST',
        body: form,
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body.error || 'Kampanjan luonti epäonnistui');
      if (body.warning) setWarning(body.warning);
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
            Suuret listat (kuten 35&nbsp;000 riviä) ajetaan erissä.
          </p>
        </div>
      </div>

      {testMode && (
        <div className="banner-test" style={{ marginBottom: 16 }}>
          Testitila on päällä: CSV tutkitaan ja Instagram analysoidaan, mutta sähköpostit menevät sinulle
          {testInbox ? ` (${testInbox})` : ''}, ei yrityksille. Vaihda Asetuksista kun olet valmis.
        </div>
      )}

      {campaigns.filter((item) => item.status === 'queued' || item.status === 'running' || item.pipeline?.active).map((item) => (
        <Link key={`live-${item.id}`} href={`/campaigns/${item.id}`} className="pipeline-panel is-live" style={{ display: 'block', marginBottom: 16, textDecoration: 'none' }}>
          <div className="pipeline-kicker">Pipeline käynnissä</div>
          <h2 style={{ margin: '4px 0 8px' }}>{item.name}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {item.pipeline?.label || item.message || 'Analysoidaan…'}
            {item.total ? ` · ${item.progress}/${item.total}` : ''}
          </p>
        </Link>
      ))}

      <div className="grid" style={{ gap: 24 }}>
        <form className="panel grid" onSubmit={createCampaign}>
          <h2 style={{ margin: 0 }}>Uusi kampanja / erä</h2>
          <label>
            Kampanjan nimi
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maaliskuun lista — erä 1" />
          </label>
          <label>
            CSV-tiedosto
            <input type="file" accept=".csv,text/csv,.txt" onChange={onFile} />
          </label>

          {totalRows > 0 && (
            <div className="account-card grid">
              <div>
                <strong>{fileName || 'CSV'}</strong>
                <div className="muted">{totalRows.toLocaleString('fi-FI')} riviä tiedostossa</div>
              </div>
              <label>
                Eräkoko (max {MAX_BATCH}): <strong>{batchSize}</strong>
                <input
                  className="range"
                  type="range"
                  min="10"
                  max={Math.min(MAX_BATCH, Math.max(10, totalRows))}
                  step="10"
                  value={Math.min(batchSize, totalRows)}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                />
              </label>
              <label>
                Aloita rivistä (0 = alusta): <strong>{offset}</strong>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max={Math.max(0, totalRows - 1)}
                  step="1"
                  value={Math.min(offset, Math.max(0, totalRows - 1))}
                  onChange={(e) => setOffset(Number(e.target.value))}
                />
              </label>
              {batchPreview && (
                <p className="muted" style={{ margin: 0 }}>
                  Tähän kampanjaan menee rivit <strong>{batchPreview.offset + 1}–{batchPreview.offset + batchPreview.batchSize}</strong>
                  {' '}({batchPreview.batchSize} kpl).
                  {batchPreview.hasMore
                    ? ` Seuraava erä voisi alkaa rivistä ${batchPreview.nextOffset + 1}.`
                    : ' Tämä on listan loppu.'}
                </p>
              )}
            </div>
          )}

          <p className="muted" style={{ margin: 0 }}>
            Tarvitaan sarakkeet <code>nimi</code> ja <code>y_tunnus</code>. Isoa 35k-tiedostoa ei lähetetä kokonaan palvelimelle — vain valittu erä.
          </p>
          {warning && <div className="banner-test">{warning}</div>}
          {error && <div className="error">{error}</div>}
          <div className="actions">
            <button className="btn accent" disabled={loading || !fileText}>
              {loading ? 'Käynnistetään…' : 'Analysoi tämä erä'}
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
