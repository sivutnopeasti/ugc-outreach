import { NextResponse } from 'next/server';
import { requireSession } from '../../../src/auth.mjs';
import { mergeMailAccounts } from '../../../src/mail.mjs';
import { publicSettings, readSettings, writeSettings } from '../../../src/store.mjs';

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ settings: publicSettings(await readSettings()) });
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
      maxSendPerBatch: Math.max(1, Number(body.maxSendPerBatch ?? current.maxSendPerBatch ?? 6)),
      maxEmailsPerDomain: Math.max(1, Number(body.maxEmailsPerDomain ?? current.maxEmailsPerDomain ?? 2)),
      mailAccounts,
    };
    if (body.appPassword) next.appPassword = body.appPassword;
    if (body.clearSmtpPass) next.smtpPass = '';
    if (body.clearAiKey) next.aiApiKey = '';
    if (body.clearMetaToken) next.metaAccessToken = '';
    const settings = await writeSettings(next);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
