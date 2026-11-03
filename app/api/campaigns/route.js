import { NextResponse } from 'next/server';
import { requireSession } from '../../../src/auth.mjs';
import { DEFAULT_BATCH_ROWS, MAX_BATCH_ROWS, summarizeCampaign } from '../../../src/campaignView.mjs';
import { countCsvDataRows, sliceCsvText } from '../../../src/csv.mjs';
import { createRun, listRuns } from '../../../src/store.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ campaigns: await listRuns() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function POST(request) {
  try {
    await requireSession();
    const contentType = request.headers.get('content-type') || '';
    let name = '';
    let csvText = '';
    let offset = 0;
    let batchSize = DEFAULT_BATCH_ROWS;
    let sourceTotalRows = null;

    let sourceOffset = 0;
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      name = String(form.get('name') || '');
      offset = Math.max(0, Number(form.get('offset') || 0));
      sourceOffset = Math.max(0, Number(form.get('sourceOffset') || form.get('offset') || 0));
      batchSize = Math.min(MAX_BATCH_ROWS, Math.max(1, Number(form.get('batchSize') || DEFAULT_BATCH_ROWS)));
      sourceTotalRows = Number(form.get('sourceTotalRows') || 0) || null;
      const file = form.get('file');
      if (file && typeof file === 'object' && typeof file.text === 'function') {
        csvText = await file.text();
      } else {
        csvText = String(form.get('csvText') || '');
      }
    } else {
      const body = await request.json();
      name = body.name || '';
      csvText = String(body.csvText || '');
      offset = Math.max(0, Number(body.offset || 0));
      sourceOffset = Math.max(0, Number(body.sourceOffset || body.offset || 0));
      batchSize = Math.min(MAX_BATCH_ROWS, Math.max(1, Number(body.batchSize || DEFAULT_BATCH_ROWS)));
      sourceTotalRows = Number(body.sourceTotalRows || 0) || null;
    }

    csvText = String(csvText || '').trim();
    const uploadedRows = countCsvDataRows(csvText);
    if (!csvText || uploadedRows < 1) {
      return NextResponse.json({ error: 'CSV:ssä tarvitaan otsikkorivi ja vähintään yksi yritys' }, { status: 400 });
    }

    // Client should pre-slice large files. If a huge dump still arrives, force a safe batch.
    let finalCsv = csvText;
    let batchOffset = sourceOffset;
    let batchCount = uploadedRows;
    let warning = '';

    if (uploadedRows > MAX_BATCH_ROWS) {
      const forced = sliceCsvText(csvText, 0, DEFAULT_BATCH_ROWS);
      finalCsv = forced.csvText;
      batchOffset = sourceOffset;
      batchCount = forced.limit;
      sourceTotalRows = sourceTotalRows || uploadedRows;
      warning = `Ladattu CSV oli liian suuri (${uploadedRows} riviä). Otettiin turvallinen erä (${forced.limit} riviä).`;
    } else {
      // Uploaded payload is already one batch.
      const sliced = sliceCsvText(csvText, offset, batchSize);
      finalCsv = sliced.csvText;
      batchCount = sliced.limit;
      if (!sourceTotalRows) sourceTotalRows = uploadedRows;
    }

    if (!finalCsv || batchCount < 1) {
      return NextResponse.json({ error: 'Erä on tyhjä.' }, { status: 400 });
    }

    const total = sourceTotalRows || batchCount;
    const run = await createRun({
      name: name || `Erä ${batchOffset + 1}–${batchOffset + batchCount}`,
      csvText: finalCsv,
      batchMeta: {
        sourceTotalRows: total,
        offset: batchOffset,
        batchSize: batchCount,
        nextOffset: batchOffset + batchCount,
        hasMore: batchOffset + batchCount < total,
      },
    });

    return NextResponse.json({
      campaign: summarizeCampaign(run),
      batch: run.batchMeta,
      warning: warning || undefined,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
