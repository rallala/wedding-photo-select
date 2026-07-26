'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';
import type { CurrentUser } from '@/lib/authHelpers';

// 마이페이지: 계정 상태, 닉네임 변경, 비밀번호 변경, 회원 탈퇴 (wedding-photo-select/landing.html:694-748, 968-1044 포팅)
export default function MyPageModal({
  open,
  user,
  onClose,
  onOpenChangePassword,
}: {
  open: boolean;
  user: CurrentUser | null;
  onClose: () => void;
  onOpenChangePassword: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  if (!open || !user) return null;
  const sb = getSupabaseBrowserClient();

  const provMap: Record<string, string> = { email: '✉️ 자체 이메일', kakao: '🟡 카카오', naver: '🟢 네이버', google: '🔴 구글' };
  const dob = user.birthYear ? `${user.birthYear}년${user.birthday ? ' ' + user.birthday : ''}` : '미설정 (1초 등록 권장)';

  async function saveNickname() {
    if (!sb || !nameInput.trim()) {
      alert('닉네임을 입력해 주세요.');
      return;
    }
    const { error } = await sb.auth.updateUser({ data: { name: nameInput.trim() } });
    if (error) {
      alert('닉네임 변경에 실패했습니다: ' + error.message);
      return;
    }
    setEditingName(false);
    alert('닉네임이 변경되었습니다!');
  }

  async function handleLogout() {
    await sb?.auth.signOut();
    onClose();
  }

  async function handleDeleteAccount() {
    if (!confirm('정말로 회원 탈퇴 및 계정을 삭제하시겠습니까?\n삭제된 계정 정보 및 셀렉 내역은 복구되지 않습니다.')) return;
    const {
      data: { session },
    } = (await sb?.auth.getSession()) || { data: { session: null } };
    if (!session) return;

    try {
      const r = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await r.json();
      if (!data.ok) {
        alert(data.error || '탈퇴 처리 중 오류가 발생했습니다.');
        return;
      }
    } catch {
      alert('탈퇴 처리 중 오류가 발생했습니다.');
      return;
    }

    alert('회원 탈퇴 및 계정 삭제가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.');
    onClose();
    await sb?.auth.signOut();
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="relative w-full max-w-[440px] rounded-2xl bg-panel p-9 text-left shadow-2xl">
        <button className="absolute right-4 top-4 text-xl text-text-muted" onClick={onClose}>
          ✕
        </button>
        <h2 className="mb-1 text-center text-xl font-bold">👤 마이페이지</h2>
        <p className="mb-5 text-center text-[13px] text-text-muted">회원님의 계정 정보 및 가입 상태입니다.</p>

        <div className="mb-5 rounded-md border border-border bg-gray-50 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
            <span className="text-xs font-semibold text-text-muted">가입 방식</span>
            <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand-primary">{provMap[user.provider] || `${user.provider} 회원`}</span>
          </div>

          <div className="mb-2.5">
            <div className="text-[11px] font-semibold text-text-muted">이메일 주소</div>
            <div className="text-sm font-semibold">{user.contactEmail || user.email || '미등록 이메일'}</div>
          </div>

          <div className="mb-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-text-muted">닉네임</div>
              {!editingName && (
                <button
                  className="text-[11px] font-semibold text-brand-primary underline"
                  onClick={() => {
                    setNameInput(user.name);
                    setEditingName(true);
                  }}
                >
                  ✏️ 변경
                </button>
              )}
            </div>
            {editingName ? (
              <div className="mt-1.5 flex gap-2">
                <input value={nameInput} maxLength={20} onChange={(e) => setNameInput(e.target.value)} className="input flex-1 bg-white" />
                <button onClick={saveNickname} className="tbtn primary flex-shrink-0 px-3.5 py-2 text-xs">
                  저장
                </button>
              </div>
            ) : (
              <div className="text-sm font-semibold">{user.name}</div>
            )}
          </div>

          <div className="mb-2.5 flex gap-4">
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-text-muted">성별</div>
              <div className="text-[13px] font-semibold">{user.gender === 'female' ? '🩷 여성' : '💙 남성'}</div>
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-text-muted">생년월일</div>
              <div className="text-[13px] font-semibold">{dob}</div>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-text-muted">계정 유지 상태</div>
            <div className="text-[13px] font-semibold text-green-500">🟢 인증 완료 (안전한 세션 보장 중)</div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {user.provider === 'email' && (
            <button onClick={onOpenChangePassword} className="tbtn primary justify-center py-3 text-sm">
              🔐 비밀번호 변경하기
            </button>
          )}
          <button onClick={handleLogout} className="rounded-md border border-border py-2.5 text-[13px]">
            로그아웃
          </button>
          <button onClick={handleDeleteAccount} className="mt-1.5 text-center text-xs text-red-500 underline">
            ⚠️ 회원 탈퇴 및 계정 삭제
          </button>
        </div>
      </div>
    </div>
  );
}
