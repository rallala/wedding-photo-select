// 카카오/네이버 OAuth의 redirect_uri는 authorize 요청과 토큰 교환 요청에서 정확히 똑같은 값이어야
// 통과된다. 요청이 들어온 호스트(req.nextUrl.origin)를 그대로 쓰면 www.picselec.com으로 들어온
// 사용자와 picselec.com으로 들어온 사용자가 서로 다른 redirect_uri를 보내게 되어, 개발자 콘솔에
// 등록된 도메인과 다르면 토큰 교환이 실패한다(token_exchange_failed). 그래서 항상 고정된 대표
// 도메인 하나만 쓴다 — 별도 환경변수 설정 없이 바로 동작하도록 기본값을 코드에 고정해뒀고,
// 나중에 다른 도메인으로 바꿔야 하면 이 상수만 고치면 된다(또는 NEXT_PUBLIC_SITE_URL로 오버라이드 가능).
const DEFAULT_SITE_URL = 'https://picselec.com';

export function getSiteUrl(fallbackOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, '');
  // 로컬 개발(localhost)에서는 고정 도메인을 쓰면 안 되니 요청 origin을 그대로 쓴다.
  if (fallbackOrigin.includes('localhost') || fallbackOrigin.includes('127.0.0.1')) return fallbackOrigin;
  return DEFAULT_SITE_URL;
}
