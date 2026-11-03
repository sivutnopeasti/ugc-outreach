import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../src/auth.mjs';
import { sendSelected } from '../../../../../src/campaign.mjs';
import { readDailySendStats, readSettings } from '../../../../../src/store.mjs';

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
    const maxEmailsPerDay = Math.max(1, Number(settings.maxEmailsPerDay || settings.maxSendPerBatch) || 6);
    const daily = await readDailySendStats();
    const remainingToday = Math.max(0, maxEmailsPerDay - Number(daily.total || 0));
    if (remainingToday <= 0) {
      return NextResponse.json({
        error: `Päiväraja täynnä (${daily.total}/${maxEmailsPerDay}). Yritä huomenna tai nosta rajaa Asetuksista.`,
        sent: 0,
        skippedLimit: businessIds.length,
        sentToday: daily.total,
        remainingToday: 0,
        limitReached: true,
        maxEmailsPerDay,
      }, { status: 429 });
    }
    const limited = businessIds.slice(0, remainingToday);
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
