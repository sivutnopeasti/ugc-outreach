'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Shell from '../../components/Shell';
import PipelinePanel from '../../components/PipelinePanel';
import { readJson } from '../../lib/api';

const PAGE_SIZE = 50;

export default function CampaignPage() {
  const { id } = useParams();
  const router = useRouter();
  const [campaign, setCampaign] = useState(null);
  const [results, setResults] = useState([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [resultOffset, setResultOffset] = useState(0);
  const [counts, setCounts] = useState({ weak: 0, review: 0, strong: 0, unknown: 0, sent: 0 });
  const [selected, setSelected] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [pipelineLive, setPipelineLive] = useState(false);
  const [settings, setSettings] = useState({
    testMode: true,
    testInboxEmail: '',
    fromEmail: '',
    maxEmailsPerDay: 6,
    maxEmailsPerDomain: 2,
  });
  const [daily, setDaily] = useState({ total: 0, remainingToday: 6, maxEmailsPerDay: 6 });
  const initialized = useRef(false);
  const stepping = useRef(false);
  const pollRef = useRef(null);
  const resultsRef = useRef([]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  function applyCampaignPayload(bodyCampaign, { appendLast = false } = {}) {
    if (!bodyCampaign) return;
    setCampaign((current) => ({ ...(current || {}), ...bodyCampaign, results: undefined }));
    if (bodyCampaign.counts) setCounts(bodyCampaign.counts);
    if (typeof bodyCampaign.resultTotal === 'number') setResultTotal(bodyCampaign.resultTotal);

    if (Array.isArray(bodyCampaign.results)) {
      setResults(bodyCampaign.results);
      setResultOffset(bodyCampaign.resultOffset || 0);
    } else if (appendLast && bodyCampaign.lastResult) {
      setResults((current) => {
        const without = current.filter((row) => row.businessId !== bodyCampaign.lastResult.businessId);
        return [...without, bodyCampaign.lastResult];
      });
      if (typeof bodyCampaign.resultTotal === 'number') setResultTotal(bodyCampaign.resultTotal);
    }
  }

  async function load(offset = resultOffset) {
    const res = await fetch(`/api/campaigns/${id}?resultOffset=${offset}&resultLimit=${PAGE_SIZE}`);
    if (res.status === 401) {
      router.push('/login');
      return null;
    }
    const body = await readJson(res);
    if (!res.ok) throw new Error(body.error || 'Kampanjaa ei löytynyt');
    applyCampaignPayload(body.campaign);
    if (body.campaign.status === 'ready' && !initialized.current) {
      const defaults = (body.campaign.results || [])
        .filter((row) => row.decision === 'weak' && row.email && !alreadySent(row))
        .map((row) => row.businessId);
      setSelected(defaults);
      initialized.current = true;
    }
    return body.campaign;
  }

  async function loadSettings() {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const body = await readJson(res);
    if (body.settings) setSettings(body.settings);
    if (body.daily) setDaily(body.daily);
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(() => {
      load(resultOffset).catch(() => {});
    }, 1200);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function stepUntilDone() {
    if (stepping.current) return;
    stepping.current = true;
    setPipelineLive(true);
    setError('');
    startPolling();
    try {
      let current = await load(0);
      while (current && (current.status === 'queued' || current.status === 'running')) {
        const res = await fetch(`/api/campaigns/${id}/step`, { method: 'POST' });
        const body = await readJson(res);
        if (!res.ok) throw new Error(body.error || 'Analyysi epäonnistui');
        current = body.campaign;
        applyCampaignPayload(body.campaign, { appendLast: true });
        if (current.status === 'ready' && !initialized.current) {
          initialized.current = true;
        }
      }
      await load(0);
      if (!initialized.current) {
        const weakIds = resultsRef.current
          .filter((row) => row.decision === 'weak' && row.email && !alreadySent(row))
          .map((row) => row.businessId);
        setSelected(weakIds);
        initialized.current = true;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      stopPolling();
      stepping.current = false;
      setPipelineLive(false);
      await load(0).catch(() => {});
    }
  }

  useEffect(() => {
    loadSettings().catch(() => {});
    load(0)
      .then((current) => {
        if (current && (current.status === 'queued' || current.status === 'running')) {
          return stepUntilDone();
        }
        return null;
      })
      .catch((err) => setError(err.message));
    return () => stopPolling();
  }, [id]);

  const testInbox = settings.testInboxEmail || settings.fromEmail || 'lähettäjän osoitteeseen';
  const testMode = settings.testMode !== false;
  const isRunning = pipelineLive
    || sending
    || campaign?.status === 'queued'
    || campaign?.status === 'running'
    || Boolean(campaign?.pipeline?.active);

  const nextOffset = Number(campaign?.batchMeta?.nextOffset || 0);
  const sourceTotal = Number(campaign?.batchMeta?.sourceTotalRows || 0);

  const stats = useMemo(() => ({
    weak: counts.weak || 0,
    review: counts.review || 0,
    strong: (counts.strong || 0) + (counts.unknown || 0),
    sent: counts.sent || 0,
  }), [counts]);

  function toggle(idValue) {
    setSelected((current) => (
      current.includes(idValue)
        ? current.filter((item) => item !== idValue)
        : [...current, idValue]
    ));
  }

  function toggleAllWeak() {
    const ids = results
      .filter((row) => row.decision === 'weak' && row.email && !alreadySent(row))
      .map((row) => row.businessId);
    setSelected(ids);
  }

  async function confirmIg(businessId, action) {
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/campaigns/${id}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId, action }),
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body.error || 'Vahvistus epäonnistui');
      applyCampaignPayload(body.campaign?.results ? body.campaign : null);
      await load(resultOffset);
      if (action === 'confirm') {
        setSelected((current) => (current.includes(businessId) ? current : [...current, businessId]));
        setMessage('Instagram vahvistettu.');
      } else {
        setSelected((current) => current.filter((item) => item !== businessId));
        setMessage('Instagram-ehdokas hylätty.');
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function send() {
    const dayLimit = Number(settings.maxEmailsPerDay || daily.maxEmailsPerDay) || 6;
    const remainingToday = daily.remainingToday ?? dayLimit;
    const willSend = Math.min(selected.length, Math.max(0, remainingToday));
    const confirmText = testMode
      ? `TESTITILA: lähetetään enintään ${willSend}/${selected.length} viestiä osoitteeseen ${testInbox} (päiväraja ${dayLimit}, jäljellä ${remainingToday}). Jatketaanko?`
      : `Lähetetäänkö enintään ${willSend}/${selected.length} viestiä (päiväraja ${dayLimit}, jäljellä ${remainingToday})?`;
    if (!confirm(confirmText)) return;
    setSending(true);
    setPipelineLive(true);
    setError('');
    setMessage('');
    startPolling();
    try {
      const res = await fetch(`/api/campaigns/${id}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessIds: selected }),
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body.error || 'Lähetys epäonnistui');
      if (body.run) applyCampaignPayload({ ...body.run, results: body.run.results }, { appendLast: false });
      await load(resultOffset);
      if (typeof body.sentToday === 'number') {
        setDaily((current) => ({
          ...current,
          total: body.sentToday,
          remainingToday: body.remainingToday,
          maxEmailsPerDay: body.maxEmailsPerDay || current.maxEmailsPerDay,
        }));
      }
      const totalSent = body.sent || 0;
      const skipped = body.skippedLimit || 0;
      setMessage(
        `${testMode ? 'Testilähetys' : 'Lähetys'}: ${totalSent} viestiä`
        + (testMode ? ` → ${testInbox}` : '')
        + ` · tänään ${body.sentToday ?? '?'}/${body.maxEmailsPerDay || dayLimit}`
        + (skipped ? ` · ${skipped} jäi jonoon päivärajan takia` : ''),
      );
      setSelected([]);
    } catch (err) {
      setError(err.message);
    } finally {
      stopPolling();
      setSending(false);
      setPipelineLive(false);
      await load(resultOffset).catch(() => {});
    }
  }

  if (!campaign) {
    return <Shell><div className="panel">{error || 'Ladataan kampanjaa…'}</div></Shell>;
  }

  const pageStart = resultOffset + 1;
  const pageEnd = Math.min(resultTotal, resultOffset + results.length);

  return (
    <Shell>
      <div className="hero">
        <div>
          <h1>{campaign.name}</h1>
          <p>
            Tila: <strong>{statusLabel(campaign.status)}</strong>
            {campaign.total ? ` · ${campaign.progress}/${campaign.total}` : ''}
            {isRunning ? ' · pipeline käynnissä' : ''}
          </p>
        </div>
        <div className="actions">
          {(campaign.status === 'queued' || campaign.status === 'running') && (
            <button type="button" className="btn secondary" onClick={stepUntilDone} disabled={pipelineLive}>
              {pipelineLive ? 'Analysoi…' : 'Jatka analyysiä'}
            </button>
          )}
          <button type="button" className="btn secondary" onClick={toggleAllWeak} disabled={isRunning}>Valitse näkyvät heikot</button>
          <button type="button" className="btn accent" disabled={sending || selected.length === 0 || pipelineLive} onClick={send}>
            {sending
              ? 'Lähetetään…'
              : testMode
                ? `Lähetä testi minulle (${selected.length})`
                : `Lähetä valitut (${selected.length})`}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <PipelinePanel campaign={campaign} sending={sending} />
      </div>

      {sourceTotal > 0 && (
        <div className="banner-test" style={{ marginBottom: 16 }}>
          Tämä on erä isosta listasta
          {campaign.batchMeta
            ? ` (rivit ${(campaign.batchMeta.offset || 0) + 1}–${(campaign.batchMeta.offset || 0) + (campaign.batchMeta.batchSize || campaign.total || 0)} / ${sourceTotal.toLocaleString('fi-FI')})`
            : ` (${sourceTotal.toLocaleString('fi-FI')} riviä lähdetiedostossa)`}.
          {nextOffset < sourceTotal && (
            <>
              {' '}
              <Link href="/">Palaa etusivulle ja aja seuraava erä alkaen rivistä {nextOffset + 1}</Link>
              {' '}(aseta “Aloita rivistä” = {nextOffset}).
            </>
          )}
        </div>
      )}

      {testMode && (
        <div className="banner-test" style={{ marginBottom: 16 }}>
          Testitila päällä — max {settings.maxEmailsPerDay || 6} viestiä / päivä
          ({daily.total || 0} käytetty, {daily.remainingToday ?? settings.maxEmailsPerDay ?? 6} jäljellä).
        </div>
      )}

      {stats.review > 0 && (
        <div className="banner-test" style={{ marginBottom: 16 }}>
          {stats.review} Instagram-ehdokasta odottaa vahvistusta.
        </div>
      )}

      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="stat"><span className="muted">Heikko some</span><strong>{stats.weak}</strong></div>
        <div className="stat"><span className="muted">Vahvista Instagram</span><strong>{stats.review}</strong></div>
        <div className="stat"><span className="muted">Vahva / ohitettu / lähetetty</span><strong>{stats.strong + stats.sent}</strong></div>
      </div>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
      {message && <div className="success" style={{ marginBottom: 16 }}>{message}</div>}
      {campaign.error && <div className="error" style={{ marginBottom: 16 }}>{campaign.error}</div>}

      <div className="panel">
        <div className="hero" style={{ marginBottom: 12 }}>
          <div className="muted">
            Tulokset {resultTotal ? `${pageStart}–${pageEnd} / ${resultTotal}` : '—'}
          </div>
          <div className="actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn secondary"
              disabled={resultOffset <= 0 || isRunning}
              onClick={() => load(Math.max(0, resultOffset - PAGE_SIZE))}
            >
              Edellinen
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={resultOffset + results.length >= resultTotal || isRunning}
              onClick={() => load(resultOffset + PAGE_SIZE)}
            >
              Seuraava
            </button>
          </div>
        </div>
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
              {results.map((row) => {
                const isCurrent = campaign.pipeline?.businessId
                  && row.businessId === campaign.pipeline.businessId
                  && isRunning;
                return (
                  <tr key={row.businessId || row.name} className={isCurrent ? 'row-live' : ''}>
                    <td>
                      {row.decision === 'weak' && row.email && !alreadySent(row) ? (
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
                        {row.instagramScore ? ` · osuma ${row.instagramScore} p` : ''}
                      </div>
                    </td>
                    <td><span className={`badge ${row.decision}`}>{decisionLabel(row.decision)}</span></td>
                    <td>{row.email || '–'}</td>
                    <td>{row.delivery}</td>
                    <td>
                      <div className="actions" style={{ marginTop: 0 }}>
                        {row.decision === 'needs_review' ? (
                          <>
                            <button type="button" className="btn accent" onClick={() => confirmIg(row.businessId, 'confirm')}>Vahvista</button>
                            <button type="button" className="btn secondary" onClick={() => confirmIg(row.businessId, 'reject')}>Hylkää</button>
                          </>
                        ) : null}
                        {row.previewText ? (
                          <button type="button" className="btn secondary" onClick={() => setPreview(row)}>Esikatselu</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
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

function decisionLabel(decision) {
  return ({
    weak: 'heikko',
    strong: 'vahva',
    unknown: 'ei tietoa',
    skip: 'ohitettu',
    needs_review: 'vahvista IG',
  })[decision] || decision;
}

function alreadySent(row) {
  return Boolean(row.sentAt)
    || String(row.delivery || '').startsWith('lähetetty')
    || String(row.delivery || '').startsWith('testilähetys');
}
