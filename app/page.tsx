'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';
import { userFromSession, type CurrentUser } from '@/lib/authHelpers';
import AuthModal from '@/components/landing/AuthModal';
import SocialExtraModal from '@/components/landing/SocialExtraModal';
import ResetPasswordModal from '@/components/landing/ResetPasswordModal';
import MyPageModal from '@/components/landing/MyPageModal';
import ProjectList from '@/components/landing/ProjectList';
import JoinRoomForm from '@/components/landing/JoinRoomForm';

// 랜딩 페이지 — (wedding-photo-select/landing.html 전체 포팅)
// useSearchParams()는 App Router에서 Suspense 경계가 필요해 바깥쪽에서 한 번 감싼다.
export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingPageInner />
    </Suspense>
  );
}

function LandingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sb = getSupabaseBrowserClient();

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authModal, setAuthModal] = useState<{ open: boolean; tab: 'login' | 'signup' }>({ open: false, tab: 'login' });
  const [socialExtraOpen, setSocialExtraOpen] = useState(false);
  const [resetModal, setResetModal] = useState<{ open: boolean; mode: 'request' | 'change' }>({ open: false, mode: 'request' });
  const [myPageOpen, setMyPageOpen] = useState(false);
  const [joinPrefill, setJoinPrefill] = useState('');

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data: { session } }) => setCurrentUser(userFromSession(session)));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      setCurrentUser(userFromSession(session));
      if (event === 'PASSWORD_RECOVERY') setResetModal({ open: true, mode: 'change' });
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 카카오/네이버 로그인은 서버가 OAuth 교환을 마친 뒤 매직링크 토큰과 함께 돌아온다.
  useEffect(() => {
    if (!sb) return;
    const socialVerify = searchParams.get('social_verify');
    const tokenHash = searchParams.get('token_hash');
    const provider = searchParams.get('provider') || '';
    const socialAuth = searchParams.get('social_auth');
    const reason = searchParams.get('reason');
    const join = searchParams.get('join');

    if (socialVerify === '1' && tokenHash) {
      sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' }).then(({ error }) => {
        if (error) alert('로그인에 실패했습니다: ' + error.message);
        else setTimeout(() => alert(`🎉 ${provider.toUpperCase()} 계정으로 로그인되었습니다!`), 100);
      });
      router.replace('/');
    }
    if (socialAuth === 'need_key') {
      alert(`[${provider.toUpperCase()}] 로그인 연동 키(Client ID)를 환경변수에 입력해 주시면 실제 ${provider} 공식 로그인 화면으로 연결됩니다!`);
      router.replace('/');
    }
    if (socialAuth === 'error') {
      alert(`소셜 로그인 처리 중 오류가 발생했습니다. 다시 시도해 주세요.\n(진단 코드: ${reason || 'unknown'})`);
      router.replace('/');
    }
    if (join) {
      setJoinPrefill(join);
      router.replace('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentUser?.needSocialExtra) setSocialExtraOpen(true);
  }, [currentUser?.needSocialExtra]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-[100] flex items-center justify-between border-b border-border bg-panel px-12 py-5">
        <a href="/" className="flex items-center gap-2 text-[22px] font-bold">
          Pic<span className="text-brand-primary">Selec</span>
        </a>
        <div className="flex items-center gap-4">
          {currentUser ? (
            <div className="flex items-center gap-3 text-sm font-medium">
              <span>
                <strong>{currentUser.name}</strong>님
              </span>
              <button className="font-semibold text-brand-primary underline" onClick={() => setMyPageOpen(true)}>
                👤 마이페이지
              </button>
              <button className="text-text-muted" onClick={() => sb?.auth.signOut()}>
                로그아웃
              </button>
            </div>
          ) : (
            <button className="rounded-full bg-text-main px-5 py-2.5 text-sm font-medium text-white" onClick={() => setAuthModal({ open: true, tab: 'login' })}>
              로그인 / 회원가입
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] flex-1 px-6 pb-16 pt-20 text-center">
        <div className="mb-6 inline-block rounded-full border border-brand-primary/25 bg-brand-light px-4 py-1.5 text-[13px] font-semibold text-brand-primary">
          무설치 · 무료 사진 공동 셀렉 솔루션
        </div>
        <h1 className="mb-[18px] text-[42px] font-bold leading-tight tracking-tight">
          링크 하나로 끝내는
          <br />
          모두의 사진 셀렉, PicSelec
        </h1>
        <p className="mx-auto mb-14 max-w-[620px] text-[17px] text-text-muted">
          여행, 모임, 행사, 웨딩까지—별도의 프로그램 설치나 무거운 사진 업로드 없이,
          <br />
          내 컴퓨터의 사진을 회원가입한 상대와 안전하고 자유롭게 함께 골라보세요.
        </p>

        <div className="mx-auto grid max-w-[840px] grid-cols-1 gap-7 sm:grid-cols-2">
          <ProjectList user={currentUser} onNeedLogin={() => setAuthModal({ open: true, tab: 'login' })} />
          <JoinRoomForm user={currentUser} onNeedLogin={() => setAuthModal({ open: true, tab: 'login' })} initialCode={joinPrefill} />
        </div>

        <div className="mx-auto mt-20 grid max-w-[840px] grid-cols-1 gap-5 text-left sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem title="실시간 동시 셀렉" desc="참여자들의 기기가 실시간으로 연동되어 함께 고를 수 있습니다." />
          <InfoItem title="1:1 비교 토너먼트" desc="비슷한 컷들을 양쪽에 배치하여 최고의 베스트 사진을 가려냅니다." />
          <InfoItem title="별점 및 의견 메모" desc="사진마다 점수를 부여하고 요청사항을 자유롭게 남길 수 있습니다." />
          <InfoItem title="보정 요청서 가공" desc="작가 전달용 보정요청사항이 엑셀 서식으로 1초 만에 생성됩니다." />
        </div>

        {/* 애드센스 슬롯(placeholder) — 실제 스크립트는 퍼블리셔 ID 확보 후 삽입 */}
        <div className="mx-auto mt-16 flex h-24 max-w-[840px] items-center justify-center rounded-md border border-dashed border-border text-xs text-text-muted">
          광고 영역(AdSense) — placeholder
        </div>
      </main>

      <footer className="border-t border-border bg-panel px-6 py-8 text-center text-[13px] text-text-muted">
        <p>© 2026 PicSelec. All rights reserved. | 모두의 사진 공동 셀렉</p>
        <p className="mt-2 flex justify-center gap-4">
          <a href="/privacy" className="underline">
            개인정보처리방침
          </a>
          <a href="/terms" className="underline">
            이용약관
          </a>
          <a href="/guide" className="underline">
            서비스 이용 가이드
          </a>
        </p>
      </footer>

      <AuthModal
        open={authModal.open}
        initialTab={authModal.tab}
        onClose={() => setAuthModal({ ...authModal, open: false })}
        onOpenResetPassword={() => {
          setAuthModal({ ...authModal, open: false });
          setResetModal({ open: true, mode: 'request' });
        }}
      />
      <SocialExtraModal open={socialExtraOpen} user={currentUser} onClose={() => setSocialExtraOpen(false)} />
      <ResetPasswordModal open={resetModal.open} mode={resetModal.mode} onClose={() => setResetModal({ ...resetModal, open: false })} />
      <MyPageModal
        open={myPageOpen}
        user={currentUser}
        onClose={() => setMyPageOpen(false)}
        onOpenChangePassword={() => {
          setMyPageOpen(false);
          setResetModal({ open: true, mode: 'change' });
        }}
      />
    </div>
  );
}

function InfoItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-md border border-border bg-panel p-5">
      <h4 className="mb-1.5 text-[15px] font-bold">{title}</h4>
      <p className="text-[13px] text-text-muted">{desc}</p>
    </div>
  );
}
