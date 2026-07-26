import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/serverClient';

// 회원 탈퇴/계정 삭제 — 반드시 "본인의" Supabase 세션으로만 본인 계정을 삭제.
// (wedding-photo-select/server.js:566-581 포팅, 로직 동일)
export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: '서버에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });

  // 클라이언트가 보낸 email은 절대 신뢰하지 않고, 토큰으로부터 검증된 본인 계정만 사용
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: '세션이 유효하지 않습니다.' }, { status: 401 });
  }

  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, message: '회원 탈퇴 및 계정 삭제가 완료되었습니다.' });
}
