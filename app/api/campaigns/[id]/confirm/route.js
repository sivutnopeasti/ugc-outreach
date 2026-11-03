import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../src/auth.mjs';
import { confirmInstagram } from '../../../../../src/campaign.mjs';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = await request.json();
    const businessId = String(body.businessId || '').trim();
    const action = String(body.action || '').trim();
    if (!businessId) {
      return NextResponse.json({ error: 'businessId puuttuu' }, { status: 400 });
    }
    const run = await confirmInstagram(id, { businessId, action });
    return NextResponse.json({ campaign: run });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
