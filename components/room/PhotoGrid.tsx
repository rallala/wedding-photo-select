'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, type Photo } from '@/store/useAppStore';

// 사진이 왼쪽→오른쪽, 위→아래(=시간순)로 읽히도록 열을 직접 만들어 라운드로빈으로 배치.
// CSS columns는 한 열을 끝까지 채운 뒤 다음 열로 넘어가 시간순으로 안 읽히기 때문에 JS로 배분한다.
// (wedding-photo-select/index.html:1568-1645 renderGrid 포팅)
export default function PhotoGrid({ onOpenPhoto, persistState }: { onOpenPhoto: (id: string) => void; persistState: () => void }) {
  const { photos, filter, who, sel, users, similarGroups, eyeClosedSet, toggleSelect, userColor, ratings, notes } = useAppStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [numCols, setNumCols] = useState(4);

  useEffect(() => {
    function recompute() {
      const width = containerRef.current?.clientWidth || 1000;
      const colWidth = 200,
        gap = 18;
      setNumCols(Math.max(1, Math.floor((width + gap) / (colWidth + gap))));
    }
    recompute();
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.q.toLowerCase();
    return photos.filter((p) => {
      if (filter.folder && p.folder !== filter.folder) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (filter.view === 'mine' && !sel[who]?.has(p.id)) return false;
      if (filter.view.startsWith('user:') && !sel[filter.view.slice(5)]?.has(p.id)) return false;
      if (filter.view === 'common') {
        const pickedCount = users.filter((u) => sel[u.id]?.has(p.id)).length;
        if (pickedCount < 2) return false;
      }
      if (filter.view === 'similar' && !similarGroups.has(p.id)) return false;
      if (filter.view === 'eye' && !eyeClosedSet.has(p.id)) return false;
      return true;
    });
  }, [photos, filter, who, sel, users, similarGroups, eyeClosedSet]);

  const columns = useMemo(() => {
    const cols: Photo[][] = Array.from({ length: numCols }, () => []);
    filtered.forEach((p, idx) => cols[idx % numCols].push(p));
    return cols;
  }, [filtered, numCols]);

  function handleHeartClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    toggleSelect(id);
    persistState();
  }

  return (
    <div ref={containerRef} className="flex items-start gap-[18px] p-5 px-6">
      {columns.map((col, ci) => (
        <div key={ci} className="flex min-w-0 flex-1 flex-col gap-[18px]">
          {col.map((p) => {
            const mine = sel[who]?.has(p.id);
            const mineColor = userColor(who);
            const simGroup = similarGroups.get(p.id);
            const isEye = eyeClosedSet.has(p.id);
            const rating = ratings[p.id] || {};
            const photoNotes = notes[p.id] || [];

            return (
              <div
                key={p.id}
                onClick={() => onOpenPhoto(p.id)}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border-[3px] bg-panel shadow-sm transition-transform hover:-translate-y-0.5"
                style={{ borderColor: mine ? mineColor : 'transparent' }}
              >
                <div className="relative flex min-h-[140px] w-full items-center justify-center overflow-hidden bg-panel2">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.name} loading="lazy" decoding="async" className="block w-full" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 py-10 text-xs text-text-muted">
                      <span>⚠️ 못 받은 사진</span>
                    </div>
                  )}
                  <div className="absolute inset-0 hidden items-center justify-center bg-gray-900/40 text-sm font-semibold text-white group-hover:flex">🔍 크게 보기</div>
                  {simGroup && <div className="absolute left-2 top-2 z-[4] rounded-md bg-blue-500 px-1.5 py-1 text-[10px] font-bold text-white">📦 {simGroup}</div>}
                  {isEye && <div className="absolute bottom-2 left-2 z-[4] rounded-md bg-red-500 px-1.5 py-1 text-[10px] font-bold text-white">👁️ 눈감음 의심</div>}
                  {(Object.keys(rating).length > 0 || photoNotes.length > 0) && (
                    <div className="absolute inset-x-0 bottom-0 z-[4] flex flex-col gap-0.5 bg-gradient-to-t from-gray-900/80 via-gray-900/40 to-transparent px-2 pb-1.5 pt-5">
                      {users.map((u) =>
                        rating[u.id] ? (
                          <div key={u.id} className="flex gap-2 text-[10px] font-bold" style={{ color: u.color }}>
                            {u.name} {rating[u.id]}★
                          </div>
                        ) : null,
                      )}
                    </div>
                  )}
                  <button
                    onClick={(e) => handleHeartClick(e, p.id)}
                    className="absolute bottom-2 right-2 z-[5] flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-base shadow"
                    style={mine ? { background: mineColor, color: '#fff' } : {}}
                  >
                    {mine ? '♥' : '♡'}
                  </button>
                </div>
                <div className="border-t border-border bg-panel px-2.5 py-2 text-[11px]">
                  <div className="truncate text-xs font-semibold">{p.name}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
