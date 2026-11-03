const NAME_KEYS = ['nimi', 'yritys', 'yrityksen nimi', 'company', 'name', 'yrityksen_nimi'];
const ID_KEYS = ['y-tunnus', 'ytunnus', 'y_tunnus', 'y tunnus', 'business_id', 'businessid'];
const SITE_KEYS = ['verkkosivu', 'www', 'website', 'url', 'kotisivu', 'web'];
const EMAIL_KEYS = ['email', 'sähköposti', 'sahkoposti', 'e-mail'];
const IG_KEYS = ['instagram', 'ig', 'instagram_url'];

/** Laskee data-rivit (ilman otsikkoa) ilman täyttä kenttäparsimista. */
export function countCsvDataRows(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim());
  if (lines.length <= 1) return 0;
  return lines.length - 1;
}

/** Ottaa CSV:stä erän: otsikko + rivit [offset, offset+limit). */
export function sliceCsvText(text, offset = 0, limit = 100) {
  const cleaned = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n');
  const nonEmpty = [];
  for (const line of lines) {
    if (line.trim()) nonEmpty.push(line);
  }
  if (nonEmpty.length === 0) {
    return { csvText: '', totalRows: 0, offset: 0, limit: 0, header: '' };
  }
  const header = nonEmpty[0];
  const data = nonEmpty.slice(1);
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.max(1, Number(limit) || 100);
  const slice = data.slice(start, start + size);
  return {
    csvText: [header, ...slice].join('\n'),
    totalRows: data.length,
    offset: start,
    limit: slice.length,
    header,
  };
}

export function parseCsv(text) {
  const cleaned = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = cleaned.split('\n').find((line) => line.trim()) ?? '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const table = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      table.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    table.push(row);
  }

  const header = (table.shift() ?? []).map((value) => value.trim());
  return table
    .filter((cells) => cells.some((value) => String(value).trim()))
    .map((cells) => {
      const record = {};
      header.forEach((key, index) => {
        record[key] = (cells[index] ?? '').trim();
      });
      return record;
    });
}

function pick(record, keys) {
  const entries = Object.entries(record);
  for (const key of keys) {
    const found = entries.find(([name]) => name.trim().toLowerCase() === key);
    if (found && found[1]) return found[1].trim();
  }
  return '';
}

export function normalizeBusinessId(value) {
  const compact = String(value).trim().replace(/\s+/g, '');
  const match = compact.match(/^(\d{7})-?(\d)$/);
  return match ? `${match[1]}-${match[2]}` : '';
}

export function rowFromRecord(record) {
  return {
    name: pick(record, NAME_KEYS),
    businessId: normalizeBusinessId(pick(record, ID_KEYS)),
    website: pick(record, SITE_KEYS),
    email: pick(record, EMAIL_KEYS).toLowerCase(),
    instagram: pick(record, IG_KEYS),
  };
}

export function toCsv(rows) {
  const headers = [
    'nimi',
    'y_tunnus',
    'verkkosivu',
    'instagram',
    'seuraajat',
    'tykkaykset_mediaani',
    'kommentit_mediaani',
    'katselut_mediaani',
    'maksettu_mainonta',
    'paatos',
    'perustelut',
    'sahkoposti',
    'lahetys',
  ];
  const lines = [headers.join(';')];
  for (const row of rows) {
    const values = [
      row.name,
      row.businessId,
      row.website,
      row.instagram,
      row.followers,
      row.medianLikes,
      row.medianComments,
      row.medianViews,
      row.activeAds,
      row.decision,
      (row.reasons || []).join(' | '),
      row.email,
      row.delivery,
    ];
    lines.push(values.map(csvCell).join(';'));
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[;"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
