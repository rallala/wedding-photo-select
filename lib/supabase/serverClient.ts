import { createClient } from '@supabase/supabase-js';
import { sanitizeSupabaseUrl } from './sanitizeUrl';

// server.js의 supabaseAdmin(SERVICE_ROLE_KEY)과 동일한 역할 — 절대 브라우저에 노출되지 않음(Route Handler 전용).
// 계정 삭제, 카카오/네이버 로그인 연동(generateLink/updateUserById)에 사용.
let adminClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdminClient() {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  adminClient = createClient(sanitizeSupabaseUrl(url), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}
