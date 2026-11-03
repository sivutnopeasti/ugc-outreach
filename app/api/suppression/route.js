import { NextResponse } from 'next/server';
import { requireSession } from '../../../src/auth.mjs';
import { readSuppression, writeSuppression } from '../../../src/store.mjs';

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ text: await readSuppression() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function POST(request) {
  try {
    await requireSession();
    const body = await request.json();
    await writeSuppression(body.text || '');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
