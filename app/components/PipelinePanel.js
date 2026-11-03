'use client';

const PHASES = [
  { id: 'prh', label: 'YTJ / yritystiedot' },
  { id: 'website', label: 'Verkkosivu' },
  { id: 'instagram', label: 'Instagram-haku' },
  { id: 'score', label: 'Somearvio' },
  { id: 'smtp', label: 'Sähköpostilähetys' },
];

export default function PipelinePanel({ campaign, sending = false }) {
  const pipeline = campaign?.pipeline || null;
  const active = Boolean(pipeline?.active) || campaign?.status === 'queued' || campaign?.status === 'running' || sending;
  const percent = pipeline?.total
    ? Math.min(100, Math.round(((pipeline.step || campaign?.progress || 0) / pipeline.total) * 100))
    : (campaign?.total ? Math.min(100, Math.round(((campaign.progress || 0) / campaign.total) * 100)) : 0);
  const currentPhase = pipeline?.phase || (sending ? 'smtp' : '');
  const activity = campaign?.activity || [];

  return (
    <section className={`pipeline-panel ${active ? 'is-live' : ''}`}>
      <div className="pipeline-head">
        <div>
          <div className="pipeline-kicker">{active ? 'Pipeline käynnissä' : 'Pipeline'}</div>
          <h2 style={{ margin: '4px 0 0' }}>
            {active
              ? (pipeline?.label || campaign?.message || 'Työskennellään…')
              : (pipeline?.label || campaign?.message || 'Ei käynnissä olevaa ajoa')}
          </h2>
          {pipeline?.companyName ? (
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Nyt käsitellään: <strong>{pipeline.companyName}</strong>
              {pipeline.businessId ? ` · ${pipeline.businessId}` : ''}
            </p>
          ) : null}
        </div>
        <div className="pipeline-meter">
          <strong>{pipeline?.step || campaign?.progress || 0}/{pipeline?.total || campaign?.total || '–'}</strong>
          <span className="muted">{percent}%</span>
        </div>
      </div>

      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="pipeline-phases">
        {PHASES.map((phase) => {
          const state = phaseState(phase.id, currentPhase, active, pipeline?.stage);
          return (
            <div key={phase.id} className={`pipeline-phase ${state}`}>
              <span className="phase-dot" />
              <span>{phase.label}</span>
            </div>
          );
        })}
      </div>

      {activity.length > 0 && (
        <div className="pipeline-log">
          <div className="muted" style={{ marginBottom: 8 }}>Viimeisimmät tapahtumat</div>
          <ul>
            {activity.slice(0, 8).map((item, index) => (
              <li key={`${item.at}-${item.businessId}-${index}`}>
                <strong>{item.companyName || item.businessId}</strong>
                <span className="muted"> — {item.detail || item.decision}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function phaseState(phaseId, currentPhase, active, stage) {
  if (!active) return 'idle';
  if (stage === 'send') {
    if (phaseId === 'smtp') return 'current';
    return 'done';
  }
  const order = ['prh', 'website', 'instagram', 'score', 'smtp'];
  const currentIndex = order.indexOf(currentPhase);
  const phaseIndex = order.indexOf(phaseId);
  if (phaseId === 'smtp') return 'idle';
  if (currentIndex < 0) return phaseId === 'prh' ? 'current' : 'idle';
  if (phaseIndex < currentIndex) return 'done';
  if (phaseIndex === currentIndex) return 'current';
  return 'idle';
}
