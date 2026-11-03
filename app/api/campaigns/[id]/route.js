import { NextResponse } from 'next/server';
import { requireSession } from '../../../../src/auth.mjs';
import { deleteRun, getRun } from '../../../../src/store.mjs';

export async function GET(_request, { params }) {
  try {
    await requireSession();
    const { id } = await params;
    const run = await getRun(id);
    return NextResponse.json({ campaign: run });
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
