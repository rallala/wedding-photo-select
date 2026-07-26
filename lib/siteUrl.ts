// 카카오/네이버 OAuth의 redirect_uri는 authorize 요청과 토큰 교환 요청에서 정확히 똑같은 값이어야
// 통과된다. 요청이 들어온 호스트(req.nextUrl.origin)를 그대로 쓰면 www.picselec.com으로 들어온
// 사용자와 picselec.com으로 들어온 사용자가 서로 다른 redirect_uri를 보내게 되어, 개발자 콘솔에
// 등록된 도메인과 다르면 토큰 교환이 실패한다(token_exchange_failed). 그래서 항상 고정된 하나의
// 값(NEXT_PUBLIC_SITE_URL)을 쓴다 — 이 값이 카카오/네이버 개발자 콘솔에 등록된 redirect_uri와
// 정확히 일치해야 한다. 설정 안 돼있으면 요청 origin으로 폴백(로컬 개발 시 편의용).
export function getSiteUrl(fallbackOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  return configured ? configured.replace(/\/$/, '') : fallbackOrigin;
}
