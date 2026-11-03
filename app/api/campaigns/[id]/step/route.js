import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../src/auth.mjs';
import { analyzeNext } from '../../../../../src/campaign.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_request, { params }) {
  try {
    await requireSession();
    const { id } = await params;
    const campaign = await analyzeNext(id);
    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
