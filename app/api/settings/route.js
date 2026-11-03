import { NextResponse } from 'next/server';
import { requireSession } from '../../../src/auth.mjs';
import { mergeMailAccounts } from '../../../src/mail.mjs';
import { publicSettings, readDailySendStats, readSettings, writeSettings } from '../../../src/store.mjs';

export async function GET() {
  try {
    await requireSession();
    const settings = await readSettings();
    const daily = await readDailySendStats();
    const maxEmailsPerDay = Number(settings.maxEmailsPerDay || settings.maxSendPerBatch || 6);
    return NextResponse.json({
      settings: publicSettings(settings),
      daily: {
        ...daily,
        maxEmailsPerDay,
        remainingToday: Math.max(0, maxEmailsPerDay - Number(daily.total || 0)),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function POST(request) {
  try {
    await requireSession();
    const body = await request.json();
    const current = await readSettings();
    const mailAccounts = body.mailAccounts !== undefined
      ? mergeMailAccounts(body.mailAccounts, current.mailAccounts || [])
      : (current.mailAccounts || []);
    const primary = mailAccounts.find((item) => item.enabled !== false) || mailAccounts[0];

    const next = {
      fromName: body.fromName ?? current.fromName,
      fromEmail: body.fromEmail ?? primary?.fromEmail ?? current.fromEmail,
      postalAddress: body.postalAddress ?? current.postalAddress,
      mailProvider: body.mailProvider ?? primary?.mailProvider ?? current.mailProvider,
      smtpHost: body.smtpHost ?? primary?.smtpHost ?? current.smtpHost,
      smtpPort: Number(body.smtpPort || primary?.smtpPort || current.smtpPort || 587),
      smtpUser: body.smtpUser ?? primary?.smtpUser ?? current.smtpUser,
      smtpPass: body.smtpPass ? body.smtpPass : (primary?.smtpPass || current.smtpPass),
      metaAccessToken: body.metaAccessToken ? body.metaAccessToken : current.metaAccessToken,
      aiApiKey: body.aiApiKey ? body.aiApiKey : current.aiApiKey,
      aiBaseUrl: body.aiBaseUrl ?? current.aiBaseUrl,
      aiModel: body.aiModel ?? current.aiModel,
      minFollowers: Number(body.minFollowers || current.minFollowers || 3000),
      minMedianLikes: Number(body.minMedianLikes || current.minMedianLikes || 30),
      minMedianComments: Number(body.minMedianComments || current.minMedianComments || 3),
      minMedianViews: Number(body.minMedianViews || current.minMedianViews || 1000),
      testMode: body.testMode === undefined ? current.testMode !== false : Boolean(body.testMode),
      testInboxEmail: body.testInboxEmail !== undefined ? String(body.testInboxEmail || '').trim() : (current.testInboxEmail || ''),
      maxEmailsPerDay: Math.max(1, Math.min(200, Number(
        body.maxEmailsPerDay
        ?? body.maxSendPerBatch
        ?? current.maxEmailsPerDay
        ?? current.maxSendPerBatch
        ?? 6,
      ))),
      maxEmailsPerDomain: Math.max(1, Math.min(200, Number(body.maxEmailsPerDomain ?? current.maxEmailsPerDomain ?? 2))),
      mailAccounts,
      instagramSessionId: body.instagramSessionId
        ? String(body.instagramSessionId).trim()
        : current.instagramSessionId || '',
    };
    if (body.appPassword) next.appPassword = body.appPassword;
    if (body.clearSmtpPass) next.smtpPass = '';
    if (body.clearAiKey) next.aiApiKey = '';
    if (body.clearMetaToken) next.metaAccessToken = '';
    if (body.clearInstagramSession) next.instagramSessionId = '';
    const settings = await writeSettings(next);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
