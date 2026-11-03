import { NextResponse } from 'next/server';
import { requireSession } from '../../../../src/auth.mjs';
import { summarizeCampaign } from '../../../../src/campaignView.mjs';
import { deleteRun, getRun } from '../../../../src/store.mjs';

export async function GET(request, { params }) {
  try {
    await requireSession();
    const { id } = await params;
    const run = await getRun(id);
    const url = new URL(request.url);
    const resultOffset = Number(url.searchParams.get('resultOffset') || 0);
    const resultLimit = Number(url.searchParams.get('resultLimit') || 50);
    return NextResponse.json({
      campaign: summarizeCampaign(run, { resultOffset, resultLimit }),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 404 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    await requireSession();
    const { id } = await params;
    await deleteRun(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
