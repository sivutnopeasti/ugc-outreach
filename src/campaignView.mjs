/** Rajaa kampanjavastauksen kokoa (isoja result-listoja ei holata kerralla). */

export const MAX_BATCH_ROWS = 300;
export const DEFAULT_BATCH_ROWS = 100;
export const DEFAULT_RESULT_PAGE = 50;

export function summarizeCampaign(run, { resultOffset = 0, resultLimit = DEFAULT_RESULT_PAGE } = {}) {
  const results = Array.isArray(run.results) ? run.results : [];
  const offset = Math.max(0, Number(resultOffset) || 0);
  const limit = Math.min(200, Math.max(1, Number(resultLimit) || DEFAULT_RESULT_PAGE));
  return {
    id: run.id,
    name: run.name,
    createdAt: run.createdAt,
    status: run.status,
    progress: run.progress,
    total: run.total,
    cursor: run.cursor,
    message: run.message,
    error: run.error || '',
    pipeline: run.pipeline || null,
    activity: (run.activity || []).slice(0, 20),
    batchMeta: run.batchMeta || null,
    resultTotal: results.length,
    resultOffset: offset,
    resultLimit: limit,
    results: results.slice(offset, offset + limit),
    counts: {
      weak: results.filter((row) => row.decision === 'weak').length,
      strong: results.filter((row) => row.decision === 'strong').length,
      review: results.filter((row) => row.decision === 'needs_review').length,
      unknown: results.filter((row) => row.decision === 'unknown' || row.decision === 'skip').length,
      sent: results.filter((row) => row.sentAt || String(row.delivery || '').startsWith('lähetetty') || String(row.delivery || '').startsWith('testilähetys')).length,
    },
  };
}

export function slimStepCampaign(run) {
  const results = Array.isArray(run.results) ? run.results : [];
  const last = results[results.length - 1] || null;
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    progress: run.progress,
    total: run.total,
    cursor: run.cursor,
    message: run.message,
    error: run.error || '',
    pipeline: run.pipeline || null,
    activity: (run.activity || []).slice(0, 12),
    batchMeta: run.batchMeta || null,
    resultTotal: results.length,
    lastResult: last,
    counts: {
      weak: results.filter((row) => row.decision === 'weak').length,
      review: results.filter((row) => row.decision === 'needs_review').length,
      sent: results.filter((row) => row.sentAt || String(row.delivery || '').startsWith('lähetetty') || String(row.delivery || '').startsWith('testilähetys')).length,
    },
  };
}
