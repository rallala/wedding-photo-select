import { NextRequest, NextResponse } from 'next/server';

// 네이버 OAuth 시작 — (wedding-photo-select/server.js:747-755 포팅)
export async function GET(req: NextRequest) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const baseUrl = req.nextUrl.origin;

  if (!clientId) {
    return NextResponse.redirect(`${baseUrl}/?social_auth=need_key&provider=naver`);
  }

  const naverAuthUrl = `https://nid.naver.com/oauth2.0/authorize?client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(baseUrl + '/api/auth/naver/callback')}&response_type=code&state=picselec_state`;

  return NextResponse.redirect(naverAuthUrl);
}
