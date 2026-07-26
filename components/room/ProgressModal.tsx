'use client';

import type { ProgressState } from '@/hooks/useRoomController';

// (wedding-photo-select/index.html:297-307 포팅)
export default function ProgressModal({ progress }: { progress: ProgressState }) {
  if (!progress.open) return null;
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="w-full max-w-[440px] rounded-[20px] border border-border bg-panel p-8 text-center shadow-2xl">
        <h3 className="mb-1.5 text-lg font-bold">{progress.title}</h3>
        {progress.sub && <p className="text-[13px] text-text-muted">{progress.sub}</p>}
        <div className="my-5 h-3 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-brand-primary transition-all" style={{ width: `${progress.pct}%` }} />
        </div>
        <div className="text-[13px] font-bold text-brand-primary">{progress.pct}%</div>
      </div>
    </div>
  );
}
