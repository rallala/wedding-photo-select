'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

type TourScope = 'similar' | 'common';
type Phase = 'setup' | 'battle';

// 1:1 비교 토너먼트 — 유사 컷 그룹끼리 맞대결시켜 베스트 컷을 가려냄
// (wedding-photo-select/index.html:2102-2194 포팅)
export default function TournamentModal({ open, onClose, persistState }: { open: boolean; onClose: () => void; persistState: () => void }) {
  const { similarGroups, users, sel, byId, forceSelect } = useAppStore();
  const [phase, setPhase] = useState<Phase>('setup');
  const [scope, setScope] = useState<TourScope>('similar');
  const [groups, setGroups] = useState<string[][]>([]);
  const [groupIdx, setGroupIdx] = useState(0);
  const [queue, setQueue] = useState<string[]>([]);
  const [pair, setPair] = useState<[string, string] | null>(null);

  if (!open) return null;

  function buildSimilarGroupLists(sc: TourScope): string[][] {
    const map = new Map<string, string[]>();
    for (const [id, label] of similarGroups.entries()) {
      if (sc === 'common' && users.filter((u) => sel[u.id]?.has(id)).length < 2) continue;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(id);
    }
    return Array.from(map.values()).filter((arr) => arr.length >= 2);
  }

  function start() {
    const gs = buildSimilarGroupLists(scope);
    if (gs.length === 0) {
      alert(
        scope === 'common'
          ? '중복 선택된 사진 중 유사 컷 그룹이 없어요. 먼저 "✨ 스마트 분석"을 실행하고, 2명 이상이 겹쳐서 고른 사진이 있는지 확인해 주세요.'
          : '비교할 유사 컷 그룹이 없어요. 먼저 "✨ 스마트 분석"을 실행해 유사 컷을 찾아주세요.',
      );
      return;
    }
    setGroups(gs);
    setGroupIdx(0);
    setPhase('battle');
    loadGroup(gs, 0);
  }

  function loadGroup(gs: string[][], idx: number) {
    if (idx >= gs.length) {
      onClose();
      setPhase('setup');
      alert(`🏆 토너먼트 완료! 총 ${gs.length}개 유사 컷 그룹에서 베스트 컷을 선택했습니다.`);
      return;
    }
    nextPair(gs, idx, [...gs[idx]]);
  }

  function nextPair(gs: string[][], idx: number, q: string[]) {
    if (q.length <= 1) {
      const winner = q[0];
      if (winner) {
        forceSelect(winner, true);
        persistState();
      }
      const nextIdx = idx + 1;
      setGroupIdx(nextIdx);
      loadGroup(gs, nextIdx);
      return;
    }
    const [a, b, ...rest] = q;
    setPair([a, b]);
    setQueue(rest);
  }

  function pickWinner(which: 'a' | 'b') {
    if (!pair) return;
    const winner = which === 'a' ? pair[0] : pair[1];
    const newQueue = [...queue, winner];
    setPair(null);
    nextPair(groups, groupIdx, newQueue);
  }

  function skipGroup() {
    const nextIdx = groupIdx + 1;
    setGroupIdx(nextIdx);
    loadGroup(groups, nextIdx);
  }

  const pa = pair ? byId.get(pair[0]) : null;
  const pb = pair ? byId.get(pair[1]) : null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="w-full max-w-[820px] rounded-[20px] border border-border bg-panel p-8 shadow-2xl">
        <h3 className="mb-1 text-lg font-bold">🏆 1:1 비교 토너먼트</h3>

        {phase === 'setup' ? (
          <>
            <p className="my-4 text-[13px] text-text-muted">어떤 사진들끼리 맞대결시킬까요?</p>
            <div className="mb-5 flex flex-col gap-2 text-left">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" checked={scope === 'similar'} onChange={() => setScope('similar')} /> 유사 컷 그룹끼리 (스마트 분석 기준 전체)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" checked={scope === 'common'} onChange={() => setScope('common')} /> 중복 선택된 사진끼리 (2명 이상이 고른 것 중 유사한 것들만)
              </label>
            </div>
            <div className="flex gap-2.5">
              <button onClick={onClose} className="tbtn flex-1 justify-center">
                닫기
              </button>
              <button onClick={start} className="tbtn primary flex-1 justify-center">
                토너먼트 시작
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-[13px] text-text-muted">
              그룹 {groupIdx + 1} / {groups.length} · 이 그룹 남은 비교 대상 {queue.length + 2}장
            </p>
            <div className="mb-4 flex gap-4">
              <div className="flex flex-1 flex-col">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pa?.url || ''} className="max-h-[360px] w-full rounded-xl bg-panel2 object-contain" alt="" />
                <button onClick={() => pickWinner('a')} className="tbtn primary mt-2 w-full justify-center">
                  ◀ 이 사진이 더 좋아요
                </button>
              </div>
              <div className="flex flex-1 flex-col">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pb?.url || ''} className="max-h-[360px] w-full rounded-xl bg-panel2 object-contain" alt="" />
                <button onClick={() => pickWinner('b')} className="tbtn primary mt-2 w-full justify-center">
                  이 사진이 더 좋아요 ▶
                </button>
              </div>
            </div>
            <div className="flex gap-2.5">
              <button onClick={skipGroup} className="tbtn flex-1 justify-center">
                이 그룹 건너뛰기
              </button>
              <button
                onClick={() => {
                  onClose();
                  setPhase('setup');
                }}
                className="tbtn flex-1 justify-center"
              >
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
