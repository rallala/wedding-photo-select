'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';

// 상단바: 폴더 열기(호스트), 스마트 분석, 토너먼트, 프로필 변경, 룸 코드 공유, 선택 현황 토글
// (wedding-photo-select/index.html:249-261 포팅)
export default function TopBar({
  mode,
  needsFolderPick,
  needsFolderRegrant,
  projectTitle,
  roomCode,
  connectedGuests,
  smartAnalyzing,
  onOpenFolder,
  onRegrantFolder,
  onRunSmartAnalysis,
  onOpenTournament,
  onOpenWho,
  onShareRoomCode,
  onToggleSidebar,
  sideBadgeCount,
}: {
  mode: 'host' | 'guest' | null;
  needsFolderPick: boolean;
  needsFolderRegrant: boolean;
  projectTitle: string;
  roomCode: string | null;
  connectedGuests: number;
  smartAnalyzing: boolean;
  onOpenFolder: () => void;
  onRegrantFolder: () => void;
  onRunSmartAnalysis: () => void;
  onOpenTournament: () => void;
  onOpenWho: () => void;
  onShareRoomCode: () => void;
  onToggleSidebar: () => void;
  sideBadgeCount: number;
}) {
  const { who, userName, users, sel } = useAppStore();

  const unionCount = useMemo(() => {
    const union = new Set<string>();
    users.forEach((u) => (sel[u.id] || new Set()).forEach((id) => union.add(id)));
    return union;
  }, [users, sel]);
  const commonCount = useMemo(() => {
    let c = 0;
    unionCount.forEach((id) => {
      if (users.filter((u) => sel[u.id]?.has(id)).length >= 2) c++;
    });
    return c;
  }, [unionCount, users, sel]);

  return (
    <header className="flex flex-wrap items-center gap-2.5 border-b border-border bg-panel px-6 py-3">
      <a href="/" className="flex items-center gap-2 text-xl font-bold">
        Pic<span className="text-brand-primary">Selec</span>
      </a>
      {projectTitle && (
        <span className="inline-flex max-w-[220px] items-center gap-1.5 truncate rounded-md border border-border bg-panel2 px-3 py-1.5 text-[13px] font-bold">
          📌 {projectTitle}
        </span>
      )}

      {mode === 'host' && needsFolderRegrant && (
        <button className="tbtn primary" onClick={onRegrantFolder} title="브라우저를 새로 열면 폴더 접근 권한이 초기화돼서, 사진을 다시 보려면 한 번 더 눌러서 허용해야 해요">
          🔓 이전 폴더 접근 허용하고 열기
        </button>
      )}
      {mode === 'host' && !needsFolderRegrant && (
        <button className="tbtn primary" onClick={onOpenFolder}>
          {needsFolderPick ? '📁 사진 폴더 선택 → 셀렉룸 시작' : '📁 사진 폴더 선택/변경'}
        </button>
      )}
      <button className="tbtn" onClick={onRunSmartAnalysis} disabled={smartAnalyzing}>
        ✨ 스마트 분석 (유사 컷 / 눈감음)
      </button>
      <button className="tbtn" onClick={onOpenTournament}>
        🏆 1:1 토너먼트 (유사 컷)
      </button>
      <button className="tbtn" onClick={onOpenWho}>
        👤 {userName(who)} (프로필/역할 변경)
      </button>
      {mode === 'host' && (
        <button className="tbtn" onClick={onShareRoomCode}>
          📱 룸 코드: <b>{roomCode ? `${roomCode} (${connectedGuests}명 접속)` : 'wps-ready'}</b>
        </button>
      )}
      <button className="tbtn" onClick={onToggleSidebar}>
        📋 선택 현황 (<b>{sideBadgeCount}</b>)
      </button>

      <div className="ml-auto flex flex-wrap items-center gap-3.5 text-[13px] text-text-muted">
        {users.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: u.color }} />
            {u.name} <b className="text-text-main">{(sel[u.id] || new Set()).size}</b>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-common" />
          중복 <b className="text-text-main">{commonCount}</b>
        </span>
        <span>
          합집합 <b className="text-text-main">{unionCount.size}</b>
        </span>
      </div>
    </header>
  );
}
