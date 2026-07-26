import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/serverClient';

// 네이버 로그인 콜백 (wedding-photo-select/server.js:592-733 포팅, 로직 동일)
export async function GET(req: NextRequest) {
  const baseUrl = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get('code');
  const provider = 'naver';

  let userName: string | null = null;
  let userEmail: string | null = null;
  let userGender: string | null = null;
  let userBirthYear: string | null = null;
  let userBirthday: string | null = null;
  let needEmail = true;
  let failReason = '';

  if (!code) failReason = 'no_code';
  else if (!process.env.NAVER_CLIENT_ID) failReason = 'no_client_id';

  try {
    if (code && process.env.NAVER_CLIENT_ID) {
      const clientSecret = process.env.NAVER_CLIENT_SECRET || '';
      const tokenRes = await fetch(
        `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${encodeURIComponent(
          process.env.NAVER_CLIENT_ID,
        )}&client_secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}&state=picselec_state`,
      );
      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profileData = await profileRes.json();
        const nResp = profileData.response || {};
        const rawName = nResp.name || nResp.nickname;
        const nIdSuffix = nResp.id ? String(nResp.id).slice(-4) : String(Date.now()).slice(-4);
        userName = rawName || `네이버#${nIdSuffix}`;
        if (nResp.email) {
          userEmail = nResp.email;
          needEmail = false;
        } else {
          userEmail = `naver_${String(nResp.id || Date.now()).slice(-4)}@picselec.com`;
        }
        if (nResp.gender) userGender = nResp.gender === 'F' || nResp.gender === 'female' ? 'female' : 'male';
        if (nResp.birthyear) userBirthYear = nResp.birthyear;
        if (nResp.birthday) userBirthday = nResp.birthday;
      } else {
        failReason = 'token_exchange_failed';
        console.error('네이버 토큰 교환 실패:', JSON.stringify(tokenData));
      }
    }
  } catch (err: any) {
    failReason = 'profile_fetch_threw';
    console.error('네이버 OAuth profile fetch error:', err.message);
  }

  if (!userEmail) {
    console.error('naver OAuth: 토큰 교환 또는 프로필 조회 실패로 사용자를 특정할 수 없음, reason=', failReason);
    return NextResponse.redirect(`${baseUrl}/?social_auth=error&provider=${provider}&reason=${failReason || 'unknown'}`);
  }
  if (!userName) userName = '네이버 회원';

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
        gender: userGender || 'male',
        birth_year: userBirthYear || null,
        birthday: userBirthday || null,
        provider,
        need_email: needEmail,
      },
    },
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error('Supabase generateLink error:', linkErr?.message);
    return NextResponse.redirect(`${baseUrl}/?social_auth=error&provider=${provider}&reason=generate_link_failed`);
  }

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
