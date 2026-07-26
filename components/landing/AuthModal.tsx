'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';

// 로그인/회원가입 모달 — (wedding-photo-select/landing.html:547-615, 1047-1229 포팅)
export default function AuthModal({
  open,
  initialTab,
  onClose,
  onOpenResetPassword,
}: {
  open: boolean;
  initialTab: 'login' | 'signup';
  onClose: () => void;
  onOpenResetPassword: () => void;
}) {
  const [tab, setTab] = useState<'login' | 'signup'>(initialTab);
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [birthYear, setBirthYear] = useState(1995);
  const [birthday, setBirthday] = useState('');

  if (!open) return null;
  const sb = getSupabaseBrowserClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) {
      alert('Supabase 연동 정보가 설정되지 않았습니다. 환경변수를 확인해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
      if (error) {
        alert('로그인 실패: ' + (error.message || '이메일 또는 비밀번호가 올바르지 않습니다.'));
        return;
      }
      onClose();
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) {
      alert('Supabase 연동 정보가 설정되지 않았습니다. 환경변수를 확인해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await sb.auth.signUp({
        email: signupEmail,
        password: signupPassword,
        options: { data: { name: signupName, gender, birth_year: birthYear, birthday, provider: 'email' } },
      });
      if (error) {
        alert(error.message || '회원가입 중 오류가 발생했습니다.');
        return;
      }
      alert(data.session ? '회원가입이 완료되었습니다!' : '가입 확인 메일을 보내드렸습니다. 메일함을 확인해 이메일 인증을 완료해 주세요.');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  function handleSocialAuth(provider: 'kakao' | 'naver' | 'google') {
    if (provider === 'google') {
      if (!sb) {
        alert('Supabase 연동 정보가 설정되지 않았습니다.');
        return;
      }
      // prompt: 'select_account'가 없으면 이미 로그인된 구글 세션이 하나뿐일 때 계정 선택 화면
      // 없이 곧장 로그인돼버려서 "누른 순간 바로 로그인됨"처럼 느껴짐 — 매번 선택 화면을 띄운다.
      sb.auth
        .signInWithOAuth({ provider, options: { redirectTo: location.origin, queryParams: { prompt: 'select_account' } } })
        .catch((err) => alert('구글 로그인 오류: ' + (err.message || err)));
    } else {
      window.location.href = `/api/auth/${provider}`;
    }
  }

  const yearOptions = Array.from({ length: 2010 - 1950 + 1 }, (_, i) => 2010 - i);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-[440px] overflow-y-auto rounded-2xl bg-panel p-9 shadow-2xl">
        <button className="absolute right-4 top-4 text-xl text-text-muted" onClick={onClose}>
          ✕
        </button>

        <div className="mb-6 flex border-b border-border">
          <button
            className={`flex-1 border-b-2 p-3 text-[15px] font-semibold ${tab === 'login' ? 'border-brand-primary text-brand-primary' : 'border-transparent text-text-muted'}`}
            onClick={() => setTab('login')}
          >
            로그인
          </button>
          <button
            className={`flex-1 border-b-2 p-3 text-[15px] font-semibold ${tab === 'signup' ? 'border-brand-primary text-brand-primary' : 'border-transparent text-text-muted'}`}
            onClick={() => setTab('signup')}
          >
            회원가입
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-2.5">
          <button className="rounded-md bg-[#FEE500] p-3 text-sm font-semibold text-[#191919]" onClick={() => handleSocialAuth('kakao')}>
            🟡 카카오로 1초 시작하기
          </button>
          <button className="rounded-md bg-[#03C75A] p-3 text-sm font-semibold text-white" onClick={() => handleSocialAuth('naver')}>
            🟢 네이버로 1초 시작하기
          </button>
          <button className="rounded-md border border-border bg-white p-3 text-sm font-semibold text-gray-700" onClick={() => handleSocialAuth('google')}>
            🔴 Google로 시작하기
          </button>
        </div>
        <div className="relative my-4 text-center text-xs text-text-muted">또는 이메일로 시작</div>

        {tab === 'login' ? (
          <form className="flex flex-col gap-3 text-left" onSubmit={handleLogin}>
            <Field label="이메일 주소">
              <input type="email" required placeholder="example@email.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="input" />
            </Field>
            <Field label="비밀번호">
              <input type="password" required placeholder="비밀번호 입력" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="input" />
            </Field>
            <div className="-mt-1 text-right">
              <button type="button" className="text-xs font-semibold text-brand-primary underline" onClick={onOpenResetPassword}>
                비밀번호를 잊으셨나요?
              </button>
            </div>
            <button type="submit" disabled={loading} className="tbtn primary mt-2 justify-center py-3 text-[15px]">
              로그인하기
            </button>
          </form>
        ) : (
          <form className="flex flex-col gap-3 text-left" onSubmit={handleSignup}>
            <Field label="이메일 주소 *">
              <input type="email" required placeholder="example@email.com" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} className="input" />
            </Field>
            <Field label="비밀번호 * (8자 이상, 영문+숫자+특수문자 포함)">
              <input
                type="password"
                required
                minLength={8}
                pattern="^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&^])[A-Za-z\d@$!%*#?&^]{8,}$"
                title="8자 이상, 영문자, 숫자, 특수문자를 모두 포함해야 합니다."
                placeholder="8자 이상, 영문/숫자/특수문자(!@#$%^&*) 포함"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="이름 / 닉네임 *">
              <input type="text" required placeholder="예: 김민준 또는 홍길동" value={signupName} onChange={(e) => setSignupName(e.target.value)} className="input" />
            </Field>
            <Field label="성별 선택 *">
              <div className="flex gap-2.5">
                <GenderButton active={gender === 'male'} label="💙 남성" onClick={() => setGender('male')} />
                <GenderButton active={gender === 'female'} label="🩷 여성" onClick={() => setGender('female')} />
              </div>
            </Field>
            <Field label="출생년도 및 생일 *">
              <div className="flex gap-2.5">
                <select required value={birthYear} onChange={(e) => setBirthYear(Number(e.target.value))} className="input flex-1">
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}년
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  maxLength={5}
                  pattern="[0-1][0-9]-[0-3][0-9]"
                  placeholder="생일 (예: 05-20)"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  className="input flex-1"
                />
              </div>
            </Field>
            <button type="submit" disabled={loading} className="tbtn primary mt-2 justify-center py-3 text-[15px]">
              회원가입 완료
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-text-muted">{label}</label>
      {children}
    </div>
  );
}

function GenderButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border p-2.5 text-center text-[13px] font-semibold ${
        active ? 'border-brand-primary bg-brand-light text-brand-primary' : 'border-border bg-gray-50 text-text-muted'
      }`}
    >
      {label}
    </button>
  );
}
