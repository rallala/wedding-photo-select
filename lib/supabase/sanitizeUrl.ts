// Supabase 대시보드에는 "Project URL"(https://xxx.supabase.co) 외에도 REST API 예시 문서에
// https://xxx.supabase.co/rest/v1/... 형태가 같이 나와서, 환경변수에 실수로 /rest/v1 같은 경로가
// 붙은 값을 넣기 쉽다. supabase-js는 이 URL을 base로 auth/rest 경로를 상대 결합하기 때문에,
// 경로가 붙어있으면 /rest/v1/auth/v1/authorize처럼 겹쳐져서 "No API key found in request" 같은
// 알기 어려운 에러로 이어진다. 그래서 항상 스킴+호스트만 남기고 나머지는 잘라낸다.
export function sanitizeSupabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}
