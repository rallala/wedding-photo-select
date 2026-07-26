'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';
import type { CurrentUser } from '@/lib/authHelpers';

// 소셜 가입자 전용 1초 추가 프로필 완료 모달(성별/생년월일/닉네임/연락 이메일)
// (wedding-photo-select/landing.html:617-656, 1190-1210 포팅)
export default function SocialExtraModal({
  open,
  user,
  onClose,
}: {
  open: boolean;
  user: CurrentUser | null;
  onClose: () => void;
}) {
  const [nickname, setNickname] = useState(user?.name || '');
  const [gender, setGender] = useState<'male' | 'female'>(user?.gender || 'male');
  const [birthYear, setBirthYear] = useState(1995);
  const [birthday, setBirthday] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  if (!open || !user) return null;
  const sb = getSupabaseBrowserClient();
  const yearOptions = Array.from({ length: 2010 - 1950 + 1 }, (_, i) => 2010 - i);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sb || !user) return;
    // contact_email은 로그인용 Supabase Auth 이메일과 별개인 "연락처"일 뿐이라 별도 메타데이터로 저장한다.
    const data: Record<string, unknown> = { gender, birth_year: birthYear, birthday, name: nickname };
    if (user.needEmail && contactEmail) {
      data.contact_email = contactEmail;
      data.need_email = false;
    }
    const { error } = await sb.auth.updateUser({ data });
    if (error) {
      alert(error.message || '저장 중 오류가 발생했습니다.');
      return;
    }
    alert('프로필 설정이 완료되었습니다!');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="relative w-full max-w-[440px] rounded-2xl bg-panel p-9 shadow-2xl">
        <button className="absolute right-4 top-4 text-xl text-text-muted" onClick={onClose}>
          ✕
        </button>
        <h2 className="mb-1.5 text-xl font-bold">👋 환영합니다!</h2>
        <p className="mb-5 text-[13px] text-text-muted">원활한 서비스 이용을 위해 성별과 생년월일을 선택해 주세요 (1초 완료)</p>

        <form className="flex flex-col gap-3 text-left" onSubmit={handleSubmit}>
          {user.needEmail && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-text-muted">연락 가능한 이메일 *</label>
              <input type="email" required placeholder="example@email.com" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="input" />
              <p className="mt-1 text-[11px] text-text-muted">가입하신 계정이 이메일 제공에 동의하지 않아, 안내 발송을 위해 별도로 받고 있어요.</p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-text-muted">닉네임 *</label>
            <input type="text" required maxLength={20} placeholder="화면에 표시될 닉네임" value={nickname} onChange={(e) => setNickname(e.target.value)} className="input" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-text-muted">성별 선택 *</label>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setGender('male')} className={`flex-1 rounded-md border p-2.5 text-[13px] font-semibold ${gender === 'male' ? 'border-brand-primary bg-brand-light text-brand-primary' : 'border-border bg-gray-50 text-text-muted'}`}>
                💙 남성
              </button>
              <button type="button" onClick={() => setGender('female')} className={`flex-1 rounded-md border p-2.5 text-[13px] font-semibold ${gender === 'female' ? 'border-brand-primary bg-brand-light text-brand-primary' : 'border-border bg-gray-50 text-text-muted'}`}>
                🩷 여성
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-text-muted">출생년도 및 생일 *</label>
            <div className="flex gap-2.5">
              <select required value={birthYear} onChange={(e) => setBirthYear(Number(e.target.value))} className="input flex-1">
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
              <input type="text" required maxLength={5} pattern="[0-1][0-9]-[0-3][0-9]" placeholder="생일 (예: 05-20)" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="input flex-1" />
            </div>
          </div>

          <button type="submit" className="tbtn primary mt-2 justify-center py-3 text-[15px]">
            설정 완료하고 시작하기
          </button>
        </form>
      </div>
    </div>
  );
}
