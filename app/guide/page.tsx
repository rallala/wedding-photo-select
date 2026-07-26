export const metadata = {
  title: '서비스 이용 가이드 - PicSelec',
  description: '여행, 모임, 행사, 웨딩 사진을 여러 명이 함께 실시간으로 고르는 방법 - PicSelec 사용 가이드.',
};

// 실제 기능을 기반으로 한 사용 가이드 콘텐츠(SEO/애드센스 목적). 법률 문구가 아니므로 직접 작성함.
export default function GuidePage() {
  return (
    <main className="mx-auto max-w-[720px] px-6 py-16 text-sm leading-7 text-text-main">
      <h1 className="mb-6 text-2xl font-bold">여러 명이 함께 사진 고르는 법 — PicSelec 사용 가이드</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">1. 프로젝트 만들기</h2>
        <p>
          로그인 후 &quot;내 PC 사진으로 셀렉하기&quot;에서 프로젝트 이름을 정하고 새 프로젝트를 만듭니다. 여행 사진, 모임
          사진, 행사 사진, 웨딩 스냅 등 어떤 사진이든 상관없습니다.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">2. 사진 폴더 열기</h2>
        <p>
          컴퓨터에 저장된 사진 폴더를 브라우저에서 직접 선택합니다. 사진 원본은 서버에 업로드되지 않고, 축소된 썸네일만
          안전하게 공유됩니다.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">3. 참여자 초대</h2>
        <p>상단의 룸 코드를 카카오톡이나 링크로 전달하면, 참여자는 회원가입 후 코드 입력만으로 같은 화면에서 실시간으로 함께 사진을 고를 수 있습니다.</p>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">4. 스마트 분석과 토너먼트로 빠르게 추리기</h2>
        <p>
          &quot;스마트 분석&quot;을 실행하면 비슷한 구도의 사진과 눈 감은 사진을 자동으로 찾아줍니다. 비슷한 사진이 많을 땐
          &quot;1:1 토너먼트&quot;로 두 장씩 비교하며 베스트 컷만 빠르게 골라낼 수 있습니다.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">5. 최종 확정 & 내보내기</h2>
        <p>
          선택이 끝나면 &quot;최종 확정 &amp; 보정요청서&quot;에서 범위(전체/중복/참여자별)를 정해 별점·메모가 담긴
          보정요청서(CSV), 파일명 목록(클립보드 복사·라이트룸 제출용 텍스트)을 바로 받을 수 있고, 최종 선택된 사진의
          원본도 참여자에게 직접 전달됩니다.
        </p>
      </section>
    </main>
  );
}
