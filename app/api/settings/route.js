import { NextResponse } from 'next/server';
import { requireSession } from '../../../src/auth.mjs';
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
    const next = {
      fromName: body.fromName ?? current.fromName,
      fromEmail: body.fromEmail ?? current.fromEmail,
      postalAddress: body.postalAddress ?? current.postalAddress,
      mailProvider: body.mailProvider ?? current.mailProvider,
      smtpHost: body.smtpHost ?? current.smtpHost,
      smtpPort: Number(body.smtpPort || current.smtpPort || 587),
      smtpUser: body.smtpUser ?? current.smtpUser,
      smtpPass: body.smtpPass ? body.smtpPass : current.smtpPass,
      metaAccessToken: body.metaAccessToken ? body.metaAccessToken : current.metaAccessToken,
      aiApiKey: body.aiApiKey ? body.aiApiKey : current.aiApiKey,
      aiBaseUrl: body.aiBaseUrl ?? current.aiBaseUrl,
      aiModel: body.aiModel ?? current.aiModel,
      minFollowers: Number(body.minFollowers || current.minFollowers || 3000),
      minMedianLikes: Number(body.minMedianLikes || current.minMedianLikes || 30),
      minMedianComments: Number(body.minMedianComments || current.minMedianComments || 3),
      minMedianViews: Number(body.minMedianViews || current.minMedianViews || 1000),
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
