import { NextResponse } from 'next/server';
import { requireSession } from '../../../src/auth.mjs';
import { createRun, listRuns } from '../../../src/store.mjs';

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
    const body = await request.json();
    const csvText = String(body.csvText || '').trim();
    if (!csvText || csvText.split('\n').filter(Boolean).length < 2) {
      return NextResponse.json({ error: 'CSV:ssä tarvitaan otsikkorivi ja vähintään yksi yritys' }, { status: 400 });
    }
    const run = await createRun({ name: body.name || '', csvText });
    return NextResponse.json({ campaign: run });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
