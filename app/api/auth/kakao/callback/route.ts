import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/serverClient';

// 카카오 로그인 콜백 — Supabase Auth의 Kakao 프로바이더는 이메일 동의항목(account_email)을 요구하는데,
// 비즈니스 인증이 안 된 카카오 앱은 그 동의항목 자체를 설정할 수 없어 KOE205로 막힌다. 그래서 자체
// OAuth 교환 후 Supabase 유저로 연동(federate)한다. (wedding-photo-select/server.js:592-733 포팅, 로직 동일)
export async function GET(req: NextRequest) {
  const baseUrl = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get('code');
  const provider = 'kakao';

  // userEmail은 반드시 실제 프로필 조회에 성공했을 때만 채워진다 — 절대 공용 기본값을 쓰지 않는다.
  // (토큰 교환이 실패했는데 공용 더미 이메일로 매직링크를 발급하면, 실패한 사람 전원이 그 계정
  //  하나로 몰려 로그인되는 심각한 버그가 됨)
  let userName: string | null = null;
  let userEmail: string | null = null;
  let needEmail = true;

  try {
    if (code && process.env.KAKAO_CLIENT_ID) {
      const bodyParams = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KAKAO_CLIENT_ID,
        redirect_uri: `${baseUrl}/api/auth/kakao/callback`,
        code,
      });
      if (process.env.KAKAO_CLIENT_SECRET) bodyParams.append('client_secret', process.env.KAKAO_CLIENT_SECRET);

      const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: bodyParams,
      });
      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        const profileRes = await fetch('https://kapi.kakao.com/v2/user/me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profileData = await profileRes.json();
        const kakaoAcc = profileData.kakao_account || {};
        const prof = kakaoAcc.profile || profileData.properties || {};
        const rawNickname = prof.nickname || profileData.properties?.nickname || kakaoAcc.name;
        const idSuffix = profileData.id ? String(profileData.id).slice(-4) : String(Date.now()).slice(-4);
        userName = rawNickname || `카카오#${idSuffix}`;
        if (kakaoAcc.email) {
          userEmail = kakaoAcc.email;
          needEmail = false;
        } else {
          userEmail = `kakao_${profileData.id || Date.now()}@picselec.com`;
        }
      }
    }
  } catch (err: any) {
    console.error('카카오 OAuth profile fetch error:', err.message);
  }

  if (!userEmail) {
    console.error('kakao OAuth: 토큰 교환 또는 프로필 조회 실패로 사용자를 특정할 수 없음');
    return NextResponse.redirect(`${baseUrl}/?social_auth=error&provider=${provider}`);
  }
  if (!userName) userName = '카카오 회원';

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.redirect(`${baseUrl}/?social_auth=need_key&provider=${provider}&reason=no_supabase`);
  }

  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: userEmail,
    options: {
      data: {
        name: userName,
        gender: 'male',
        birth_year: null,
        birthday: null,
        provider,
        need_email: needEmail,
      },
    },
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error('Supabase generateLink error:', linkErr?.message);
    return NextResponse.redirect(`${baseUrl}/?social_auth=error&provider=${provider}`);
  }

  // 이미 가입된 유저인 경우에도 metadata name을 최신 카카오 프로필 닉네임으로 최신화
  if (linkData?.user?.id) {
    try {
      const existingMeta = linkData.user.user_metadata || {};
      const currentName = existingMeta.name;
      const isGenericName = !currentName || currentName.includes('사용자') || currentName.startsWith('kakao_') || currentName.startsWith('naver_');

      await supabaseAdmin.auth.admin.updateUserById(linkData.user.id, {
        user_metadata: {
          ...existingMeta,
          name: isGenericName ? userName : currentName,
          provider,
          need_email: needEmail && existingMeta.need_email !== false,
        },
      });
    } catch (updErr: any) {
      console.error('Failed updating user_metadata on OAuth login:', updErr.message);
    }
  }

  const redirectParams = new URLSearchParams({
    social_verify: '1',
    provider,
    email: userEmail,
    token_hash: linkData.properties.hashed_token,
  });

  return NextResponse.redirect(`${baseUrl}/?${redirectParams.toString()}`);
}
