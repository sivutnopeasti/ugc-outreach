/** Selaimessa: leikkaa isosta CSV:stä vain yksi erä ennen uploadia. */

export function analyzeCsvFileText(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim());
  if (lines.length <= 1) {
    return { header: '', totalRows: 0, lines: [] };
  }
  return {
    header: lines[0],
    totalRows: lines.length - 1,
    lines,
  };
}

export function buildCsvBatch(text, offset, batchSize) {
  const info = analyzeCsvFileText(text);
  if (!info.header || info.totalRows < 1) {
    throw new Error('CSV:ssä tarvitaan otsikko ja vähintään yksi datarivi');
  }
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.max(1, Number(batchSize) || 100);
  const slice = info.lines.slice(1).slice(start, start + size);
  if (slice.length === 0) {
    throw new Error(`Ei rivejä offsetilla ${start} (tiedostossa ${info.totalRows} riviä)`);
  }
  return {
    csvText: [info.header, ...slice].join('\n'),
    totalRows: info.totalRows,
    offset: start,
    batchSize: slice.length,
    nextOffset: start + slice.length,
    hasMore: start + slice.length < info.totalRows,
  };
}
