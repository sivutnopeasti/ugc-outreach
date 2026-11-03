import { NextResponse } from 'next/server';
import { loginWithPassword, SESSION_COOKIE } from '../../../src/auth.mjs';

export async function POST(request) {
  try {
    const body = await request.json();
    const token = await loginWithPassword(body.password || '');
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
