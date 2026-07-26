import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'PicSelec (픽셀렉) - 링크 하나로 끝내는 모두의 사진 셀렉',
  description:
    '프로그램 설치 0초! 내 브라우저에서 안전하게 구동되는 실시간 동시 사진 셀렉 플랫폼. 여행·모임·행사·웨딩 등 누구와 함께든 1:1 토너먼트, 별점, 보정 요청서 엑셀 다운로드 지원.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <Script src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
