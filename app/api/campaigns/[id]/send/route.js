import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../src/auth.mjs';
import { sendSelected } from '../../../../../src/campaign.mjs';
import { readSettings } from '../../../../../src/store.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = await request.json();
    const businessIds = Array.isArray(body.businessIds) ? body.businessIds : [];
    if (businessIds.length === 0) {
      return NextResponse.json({ error: 'Valitse vähintään yksi yritys' }, { status: 400 });
    }
    const settings = await readSettings();
    const maxSendPerBatch = Math.max(1, Number(settings.maxSendPerBatch) || 6);
    // Serverless-turvaraja: älä ota käsittelyyn enempää kuin batch-raja + pieni puskuri.
    const limited = businessIds.slice(0, maxSendPerBatch);
    const result = await sendSelected(id, limited);
    return NextResponse.json({
      ...result,
      remaining: Math.max(0, businessIds.length - limited.length),
      processedIds: result.processedIds || limited,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
