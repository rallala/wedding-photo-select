'use client';

import { useAppStore } from '@/store/useAppStore';

const SENS_NAMES = ['', '매우 엄격 (1단계)', '엄격 (2단계)', '보통 (3단계)', '유연 (4단계)', '매우 유연 (5단계)'];

// 검색/폴더/유사컷 감도/뷰 필터 + 최종 확정 버튼 (wedding-photo-select/index.html:263-280, 994-1010 포팅)
export default function ControlsBar({ onOpenFinal }: { onOpenFinal: () => void }) {
  const { filter, setFilter, sensLevel, setSensLevel, folders, users, who } = useAppStore();

  const otherUsers = users.filter((u) => u.id !== who);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-gray-50 px-6 py-2.5">
      <input
        type="text"
        value={filter.q}
        onChange={(e) => setFilter({ q: e.target.value })}
        placeholder="파일명 검색"
        className="input w-[180px]"
      />

      <select value={filter.folder} onChange={(e) => setFilter({ folder: e.target.value })} className="input max-w-[220px]">
        <option value="">📁 전체 폴더 보기</option>
        {folders.map((f) => (
          <option key={f} value={f}>
            📂 {f}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-1 text-xs font-medium">
        <span>🎚️ 유사 컷 감도:</span>
        <input type="range" min={1} max={5} step={1} value={sensLevel} onChange={(e) => setSensLevel(Number(e.target.value))} className="w-20 accent-brand-primary" />
        <b className="text-brand-primary">{SENS_NAMES[sensLevel]}</b>
      </div>

      <div className="flex gap-1 rounded-md bg-gray-200 p-[3px]">
        <ViewButton view="all" label="전체" />
        <ViewButton view="mine" label="내 선택" />
        {otherUsers.map((u) => (
          <ViewButton key={u.id} view={`user:${u.id}`} label={`${u.name} 선택`} />
        ))}
        <ViewButton view="common" label="중복만" />
        <ViewButton view="similar" label="📦 유사 컷만" />
        <ViewButton view="eye" label="👁️ 눈감음 의심" />
      </div>

      <button onClick={onOpenFinal} className="ml-auto rounded-md bg-text-main px-4.5 py-2 text-[13px] font-semibold text-white">
        최종 확정 &amp; 보정요청서
      </button>
    </div>
  );
}

function ViewButton({ view, label }: { view: string; label: string }) {
  const { filter, setFilter } = useAppStore();
  const active = filter.view === view;
  return (
    <button
      onClick={() => setFilter({ view })}
      className={`rounded-md px-3 py-1.5 text-xs font-medium ${active ? 'bg-panel font-bold text-text-main shadow-sm' : 'text-text-muted'}`}
    >
      {label}
    </button>
  );
}
