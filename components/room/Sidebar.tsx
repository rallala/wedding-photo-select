'use client';

import { useAppStore } from '@/store/useAppStore';

// 우측 실시간 선택 현황 사이드바 (wedding-photo-select/index.html:1701-1746 포팅)
export default function Sidebar({ collapsed, onClose, onOpenPhoto }: { collapsed: boolean; onClose: () => void; onOpenPhoto: (id: string) => void }) {
  const { users, sel, sideTab, setSideTab, byId, userName } = useAppStore();

  let list: string[];
  if (sideTab === 'common') {
    list = Array.from(byId.keys()).filter((id) => users.filter((u) => sel[u.id]?.has(id)).length >= 2);
  } else {
    list = Array.from(sel[sideTab] || []);
  }
  // Set은 삽입 순서라, 촬영 타임스탬프 순으로 다시 정렬
  list = [...list].sort((a, b) => (byId.get(a)?.mtime || 0) - (byId.get(b)?.mtime || 0));
  const badgeLabel = sideTab === 'common' ? '중복' : userName(sideTab);

  return (
    <aside className={`z-20 flex w-80 flex-shrink-0 flex-col border-l border-border bg-panel transition-[margin] ${collapsed ? '-mr-80' : ''}`}>
      <div className="flex items-center justify-between border-b border-border bg-gray-50 px-4.5 py-3.5">
        <h3 className="m-0 text-[15px] font-bold">📋 실시간 선택 현황</h3>
        <button onClick={onClose} className="text-lg text-text-muted">
          ✕
        </button>
      </div>
      <div className="flex gap-1 border-b border-border bg-panel2 px-3 py-2">
        {users.map((u) => (
          <button
            key={u.id}
            onClick={() => setSideTab(u.id)}
            className={`flex-1 rounded-md border px-0.5 py-1.5 text-[11px] font-semibold ${sideTab === u.id ? 'border-brand-primary bg-brand-primary text-white' : 'border-border bg-panel text-text-muted'}`}
          >
            {u.name}
          </button>
        ))}
        <button
          onClick={() => setSideTab('common')}
          className={`flex-1 rounded-md border px-0.5 py-1.5 text-[11px] font-semibold ${sideTab === 'common' ? 'border-brand-primary bg-brand-primary text-white' : 'border-border bg-panel text-text-muted'}`}
        >
          중복
        </button>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-2.5 overflow-y-auto p-3 content-start">
        {list.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <div key={id} onClick={() => onOpenPhoto(id)} className="relative h-[120px] cursor-pointer overflow-hidden rounded-md border border-border bg-panel2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{badgeLabel}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
