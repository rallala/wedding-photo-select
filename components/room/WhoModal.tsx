'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

// 프로필(참여자) 선택/추가/삭제 모달 (wedding-photo-select/index.html:309-323, 931-992 포팅)
export default function WhoModal({ open, onClose, persistState }: { open: boolean; onClose: () => void; persistState: () => void }) {
  const { users, who, setActiveRole, addProfile, removeProfile } = useAppStore();
  const [newName, setNewName] = useState('');

  if (!open) return null;

  function selectRole(id: string) {
    setActiveRole(id);
    onClose();
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) {
      alert('이름을 입력해 주세요.');
      return;
    }
    addProfile(name);
    setNewName('');
    persistState();
  }

  function handleDelete(id: string) {
    if (users.length <= 1) return;
    if (!confirm('이 프로필을 삭제하시겠습니까?\n이 프로필로 이미 남긴 선택/별점/메모는 그대로 남고, 프로필 목록에서만 없어집니다.')) return;
    removeProfile(id);
    persistState();
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="w-full max-w-[480px] rounded-[20px] border border-border bg-panel p-8 text-center shadow-2xl">
        <h3 className="mb-2 text-xl font-bold">👤 누구의 역할로 선택하시나요?</h3>
        <p className="mb-5 text-[13px] text-text-muted">
          선택하신 프로필로 사진 선택 하트(♥)가 기록됩니다. 참여자를 자유롭게 추가할 수 있어요.
        </p>

        <div className="mb-4 flex flex-col gap-2.5">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              <button
                onClick={() => selectRole(u.id)}
                className="flex-1 justify-center rounded-md p-3.5 text-[15px] font-semibold text-white"
                style={{ background: u.color }}
              >
                {u.id === who ? '✓ ' : ''}
                {u.name}으로 셀렉하기
              </button>
              {users.length > 1 && (
                <button onClick={() => handleDelete(u.id)} title="프로필 삭제" className="flex-shrink-0 p-1.5 text-base text-red-500">
                  🗑️
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mb-4 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={10}
            placeholder="새 참여자 이름"
            className="input flex-1"
          />
          <button onClick={handleAdd} className="tbtn primary flex-shrink-0">
            + 추가
          </button>
        </div>

        <button onClick={onClose} className="tbtn w-full justify-center py-2.5">
          닫기
        </button>
      </div>
    </div>
  );
}
