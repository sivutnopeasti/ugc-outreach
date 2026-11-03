'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Shell from '../../components/Shell';

export default function CampaignPage() {
  const { id } = useParams();
  const router = useRouter();
  const [campaign, setCampaign] = useState(null);
  const [selected, setSelected] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const initialized = useRef(false);
  const stepping = useRef(false);

  async function load() {
    const res = await fetch(`/api/campaigns/${id}`);
    if (res.status === 401) {
      router.push('/login');
      return null;
    }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Kampanjaa ei löytynyt');
    setCampaign(body.campaign);
    if (body.campaign.status === 'ready' && !initialized.current) {
      const defaults = (body.campaign.results || [])
        .filter((row) => row.decision === 'weak' && row.email && row.delivery !== 'lähetetty')
        .map((row) => row.businessId);
      setSelected(defaults);
      initialized.current = true;
    }
    return body.campaign;
  }

  async function stepUntilDone() {
    if (stepping.current) return;
    stepping.current = true;
    try {
      let current = await load();
      while (current && (current.status === 'queued' || current.status === 'running')) {
        const res = await fetch(`/api/campaigns/${id}/step`, { method: 'POST' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Analyysi epäonnistui');
        current = body.campaign;
        setCampaign(current);
        if (current.status === 'ready' && !initialized.current) {
          const defaults = (current.results || [])
            .filter((row) => row.decision === 'weak' && row.email && row.delivery !== 'lähetetty')
            .map((row) => row.businessId);
          setSelected(defaults);
          initialized.current = true;
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      stepping.current = false;
    }
  }

  useEffect(() => {
    load()
      .then((current) => {
        if (current && (current.status === 'queued' || current.status === 'running')) {
          return stepUntilDone();
        }
        return null;
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const stats = useMemo(() => {
    const rows = campaign?.results || [];
    return {
      weak: rows.filter((row) => row.decision === 'weak').length,
      strong: rows.filter((row) => row.decision === 'strong').length,
      unknown: rows.filter((row) => row.decision === 'unknown' || row.decision === 'skip').length,
      sent: rows.filter((row) => row.delivery === 'lähetetty').length,
    };
  }, [campaign]);

  function toggle(idValue) {
    setSelected((current) => (
      current.includes(idValue)
        ? current.filter((item) => item !== idValue)
        : [...current, idValue]
    ));
  }

  function toggleAllWeak() {
    if (!campaign) return;
    const ids = campaign.results
      .filter((row) => row.decision === 'weak' && row.email && row.delivery !== 'lähetetty')
      .map((row) => row.businessId);
    setSelected(ids);
  }

  async function send() {
    if (!confirm(`Lähetetäänkö viesti ${selected.length} yritykselle?`)) return;
    setSending(true);
    setError('');
    setMessage('');
    try {
      let remaining = [...selected];
      let totalSent = 0;
      while (remaining.length > 0) {
        const res = await fetch(`/api/campaigns/${id}/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ businessIds: remaining }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Lähetys epäonnistui');
        setCampaign(body.run);
        totalSent += body.sent || 0;
        const processed = new Set(body.processedIds || []);
        remaining = remaining.filter((item) => !processed.has(item));
        if ((body.remaining || 0) <= 0) break;
      }
      setMessage(`Lähetetty ${totalSent} viestiä.`);
      setSelected([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (!campaign) {
    return <Shell><div className="panel">{error || 'Ladataan kampanjaa…'}</div></Shell>;
  }

  return (
    <Shell>
      <div className="hero">
        <div>
          <h1>{campaign.name}</h1>
          <p>
            Tila: <strong>{statusLabel(campaign.status)}</strong>
            {campaign.total ? ` · ${campaign.progress}/${campaign.total}` : ''}
            {campaign.message ? ` · ${campaign.message}` : ''}
          </p>
        </div>
        <div className="actions">
          {(campaign.status === 'queued' || campaign.status === 'running') && (
            <button type="button" className="btn secondary" onClick={stepUntilDone}>Jatka analyysiä</button>
          )}
          <button type="button" className="btn secondary" onClick={toggleAllWeak}>Valitse kaikki heikot</button>
          <button type="button" className="btn accent" disabled={sending || selected.length === 0} onClick={send}>
            {sending ? 'Lähetetään…' : `Lähetä valitut (${selected.length})`}
          </button>
        </div>
      </div>

      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="stat"><span className="muted">Heikko some</span><strong>{stats.weak}</strong></div>
        <div className="stat"><span className="muted">Vahva / ohitettu</span><strong>{stats.strong + stats.unknown}</strong></div>
        <div className="stat"><span className="muted">Lähetetty</span><strong>{stats.sent}</strong></div>
      </div>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
      {message && <div className="success" style={{ marginBottom: 16 }}>{message}</div>}
      {campaign.error && <div className="error" style={{ marginBottom: 16 }}>{campaign.error}</div>}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Yritys</th>
                <th>Instagram</th>
                <th>Arvio</th>
                <th>Sähköposti</th>
                <th>Lähetys</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(campaign.results || []).map((row) => (
                <tr key={row.businessId || row.name}>
                  <td>
                    {row.decision === 'weak' && row.email && row.delivery !== 'lähetetty' ? (
                      <input
                        type="checkbox"
                        checked={selected.includes(row.businessId)}
                        onChange={() => toggle(row.businessId)}
                      />
                    ) : null}
                  </td>
                  <td>
                    <strong>{row.name}</strong>
                    <div className="muted">{row.businessId}</div>
                    <div className="muted">{(row.reasons || []).join(' · ')}</div>
                  </td>
                  <td>
                    {row.instagram ? <a href={row.instagram} target="_blank" rel="noreferrer">{row.instagram.replace('https://www.instagram.com/', '@').replace(/\/$/, '')}</a> : '–'}
                    <div className="muted">
                      {row.followers !== '' && row.followers != null ? `${row.followers} seuraajaa` : ''}
                    </div>
                  </td>
                  <td><span className={`badge ${row.decision}`}>{row.decision}</span></td>
                  <td>{row.email || '–'}</td>
                  <td>{row.delivery}</td>
                  <td>
                    {row.previewText ? (
                      <button type="button" className="btn secondary" onClick={() => setPreview(row)}>Esikatselu</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <div className="panel" style={{ marginTop: 24 }}>
          <div className="hero" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>{preview.previewSubject}</h2>
              <p className="muted">Esikatselu: {preview.name}</p>
            </div>
            <button type="button" className="btn secondary" onClick={() => setPreview(null)}>Sulje</button>
          </div>
          <div className="preview">{preview.previewText}</div>
        </div>
      )}
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
