import { NextRequest, NextResponse } from 'next/server';
import { getSiteUrl } from '@/lib/siteUrl';

// 카카오 OAuth 시작 — (wedding-photo-select/server.js:735-745 포팅)
export async function GET(req: NextRequest) {
  const clientId = process.env.KAKAO_CLIENT_ID;
  const baseUrl = getSiteUrl(req.nextUrl.origin);

  if (!clientId) {
    return NextResponse.redirect(`${baseUrl}/?social_auth=need_key&provider=kakao`);
  }

  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(baseUrl + '/api/auth/kakao/callback')}&response_type=code`;

  return NextResponse.redirect(kakaoAuthUrl);
}
