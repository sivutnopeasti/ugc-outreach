import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../src/auth.mjs';
import { sendSelected } from '../../../../../src/campaign.mjs';

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
    // Send one-by-one from client in future if needed; for now send selected in this request.
    // Limit burst size for serverless.
    const limited = businessIds.slice(0, 5);
    const result = await sendSelected(id, limited);
    return NextResponse.json({
      ...result,
      remaining: businessIds.length - limited.length,
      processedIds: limited,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
