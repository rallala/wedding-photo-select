'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';

// 비밀번호 재설정/변경 모달 — 로그아웃 상태(잊어버림): 이메일로 링크 발송 / 로그인 상태(recovery 세션 or
// 마이페이지): 새 비밀번호 입력. (wedding-photo-select/landing.html:658-692, 1145-1188 포팅)
export default function ResetPasswordModal({
  open,
  mode,
  onClose,
}: {
  open: boolean;
  mode: 'request' | 'change';
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

  if (!open) return null;
  const sb = getSupabaseBrowserClient();

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    if (error) {
      alert(error.message || '요청 처리 중 오류가 발생했습니다.');
      return;
    }
    alert('비밀번호 재설정 링크를 이메일로 보내드렸습니다. 메일함을 확인해 주세요.');
    onClose();
  }

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    if (newPassword !== newPasswordConfirm) {
      alert('새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) {
      alert(error.message || '비밀번호 변경 중 오류가 발생했습니다.');
      return;
    }
    alert('비밀번호가 성공적으로 변경되었습니다!');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="relative w-full max-w-[440px] rounded-2xl bg-panel p-9 shadow-2xl">
        <button className="absolute right-4 top-4 text-xl text-text-muted" onClick={onClose}>
          ✕
        </button>
        <h2 className="mb-1.5 text-xl font-bold">🔐 비밀번호 재설정</h2>

        {mode === 'request' ? (
          <>
            <p className="mb-5 text-[13px] text-text-muted">가입하신 이메일 주소를 입력하시면 비밀번호 재설정 링크를 보내드립니다.</p>
            <form className="flex flex-col gap-3 text-left" onSubmit={handleRequest}>
              <input type="email" required placeholder="example@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
              <button type="submit" className="tbtn primary mt-2 justify-center py-3 text-[15px]">
                재설정 링크 받기
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mb-5 text-[13px] text-text-muted">새로 사용하실 비밀번호를 입력해 주세요.</p>
            <form className="flex flex-col gap-3 text-left" onSubmit={handleChange}>
              <input
                type="password"
                required
                minLength={8}
                pattern="^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&^])[A-Za-z\d@$!%*#?&^]{8,}$"
                placeholder="8자 이상, 영문/숫자/특수문자(!@#$%^&*) 포함"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input"
              />
              <input type="password" required minLength={8} placeholder="새 비밀번호 재입력" value={newPasswordConfirm} onChange={(e) => setNewPasswordConfirm(e.target.value)} className="input" />
              <button type="submit" className="tbtn primary mt-2 justify-center py-3 text-[15px]">
                비밀번호 변경하기
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
