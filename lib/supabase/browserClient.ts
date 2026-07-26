import { createBrowserClient } from '@supabase/ssr';

// 레거시 vanilla 버전의 `sb` 전역과 동일한 역할 — 키가 비어있으면(로컬에서 .env 미설정) null을 돌려줘서
// 그 경우를 부르는 쪽이 안전하게 처리하게 한다.
let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createBrowserClient(url, key);
  return client;
}
