# PicSelec

여러 명이 링크 하나로 함께 사진을 실시간으로 셀렉하는 웹앱입니다. Next.js/React로 재작성된 버전이며, 기존 vanilla JS + Node 서버 버전을 대체합니다.

## 아키텍처 요약

- **브라우징용 썸네일**: 호스트 브라우저에서 Canvas로 축소(WebP, 100KB 목표) → Supabase Storage(`project-photos` 버킷)에 업로드 → 게스트가 다운로드. NAT/TURN 문제 없음.
- **최종 확정된 원본**: 최종 확정 시점에만 WebRTC P2P(STUN-only, TURN 없음)로 그 순간 접속 중인 참여자에게 직접 전송. 실패해도 CSV/파일명 목록은 항상 받을 수 있음.
- **실시간 현황판**(선택/별점/메모): Supabase Realtime(postgres_changes + Presence).
- **인증**: Supabase Auth(이메일, 구글) + 카카오/네이버(자체 OAuth 코드 교환 후 Supabase에 연동).

## 실행

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

## Supabase 설정

1. Supabase 프로젝트 대시보드 → SQL Editor에서 `supabase/schema.sql`을 실행합니다(멱등하게 작성되어 다시 실행해도 안전).
2. Storage에 `project-photos` 버킷이 생성되고 정책이 걸렸는지 확인합니다.

| 환경변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용(계정 삭제, 카카오/네이버 연동). 절대 클라이언트에 노출 금지 |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET` | 카카오 로그인 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 로그인 |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 룸 코드 "카카오톡으로 보내기" 버튼용(로그인과 무관, 없으면 클립보드 복사로 대체) |

## 이번 재작성에서 빠진 것 (의도적)

- 로컬 PIN 서버 모드(`node server.js` 더블클릭 실행)는 포팅하지 않았습니다. 필요하면 기존 `wedding-photo-select/server.js`를 계속 사용하세요.
- 애드센스 실제 스크립트, `/privacy` `/terms`의 실제 법률 문구는 placeholder 상태입니다 — 게시 전에 반드시 채워 넣어야 합니다.
