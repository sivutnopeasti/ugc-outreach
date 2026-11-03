import { NextResponse } from 'next/server';
import { bootstrapAdmin } from '../../../src/auth.mjs';
import { publicSettings, readSettings } from '../../../src/store.mjs';

export async function GET() {
  const settings = await readSettings();
  return NextResponse.json({
    needsSetup: !settings.appPasswordHash,
    settings: publicSettings(settings),
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const settings = await bootstrapAdmin(body);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
