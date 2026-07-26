'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { ReceivedOriginal } from '@/hooks/useRoomController';
import {
  computeFinalScopeIds,
  buildCorrectionCSV,
  downloadTextFile,
  buildFilenameList,
  copyTextToClipboard,
  copySelectedFilesToFolder,
  downloadBlob,
  type FinalScope,
} from '@/lib/exportUtils';

// 최종 확정 & 보정요청서 + 최종 셀렉본 원본 P2P 핸드오프
// (wedding-photo-select/index.html:1782-1919 runFinalConfirm 포팅 + 신규 원본 핸드오프/파일명 내보내기)
export default function FinalConfirmModal({
  open,
  onClose,
  mode,
  requestOriginalsFromHost,
  pushOriginalsToAllGuests,
  receivedOriginals,
}: {
  open: boolean;
  onClose: () => void;
  mode: 'host' | 'guest' | null;
  requestOriginalsFromHost: (ids: string[]) => void;
  pushOriginalsToAllGuests: (ids: string[]) => void;
  receivedOriginals: ReceivedOriginal[];
}) {
  const { users, sel, byId, ratings, notes, dirHandle } = useAppStore();
  const [scope, setScope] = useState<FinalScope>('union');
  const [handoffStatus, setHandoffStatus] = useState<string>('');
  const processedCountRef = useRef(0);

  const allIds = Array.from(byId.keys());
  const ids = computeFinalScopeIds(scope, users, sel, allIds);

  // 게스트: 호스트가 P2P로 원본을 보내주는 대로 즉시 다운로드
  useEffect(() => {
    if (receivedOriginals.length <= processedCountRef.current) return;
    const newOnes = receivedOriginals.slice(processedCountRef.current);
    newOnes.forEach((f) => downloadBlob(f.name, f.blob));
    processedCountRef.current = receivedOriginals.length;
    setHandoffStatus(`원본 ${receivedOriginals.length}장 수신 및 다운로드 완료`);
  }, [receivedOriginals]);

  if (!open) return null;

  async function handleConfirm() {
    if (ids.length === 0) {
      alert('확정할 사진이 없어요. 먼저 사진을 선택해 주세요.');
      return;
    }
    onClose();

    // 1) 보정요청서(CSV)는 항상 즉시 다운로드
    downloadTextFile(`보정요청서_${new Date().toISOString().slice(0, 10)}.csv`, buildCorrectionCSV(ids, byId, users, sel, ratings, notes));

    // 2) 원본 전달: 호스트는 폴더에 복사 + 접속 중인 게스트에게 P2P 선제 전송 / 게스트는 호스트에 요청
    if (mode === 'host' && dirHandle) {
      const r = await copySelectedFilesToFolder(dirHandle, ids, byId);
      if (r.ok) alert(`✅ 최종 확정 완료!\n- 사진 ${r.count}/${r.total}장이 "${r.destName}" 폴더로 복사되었습니다.\n- 보정요청서(CSV)도 함께 다운로드되었습니다.`);
      else alert('보정요청서는 다운로드되었지만, 사진 폴더 쓰기 권한이 없어 원본 복사는 건너뛰었습니다.');
      pushOriginalsToAllGuests(ids);
    } else if (mode === 'guest') {
      processedCountRef.current = 0;
      requestOriginalsFromHost(ids);
      alert('보정요청서(CSV)가 다운로드되었습니다.\n호스트가 접속 중이면 원본 사진도 곧 자동으로 전송/다운로드됩니다(호스트가 오프라인이면 전송되지 않을 수 있어요).');
    } else {
      alert('보정요청서(CSV)가 다운로드되었습니다.');
    }
  }

  function handleCopyFilenames() {
    copyTextToClipboard(buildFilenameList(ids, byId)).then((ok) => {
      alert(ok ? '파일명 목록이 클립보드에 복사되었습니다.' : '클립보드 복사에 실패했습니다.');
    });
  }

  function handleDownloadFilenameTxt() {
    downloadTextFile(`파일명목록_${new Date().toISOString().slice(0, 10)}.txt`, buildFilenameList(ids, byId), 'text/plain;charset=utf-8');
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
      <div className="w-full max-w-[480px] rounded-[20px] border border-border bg-panel p-8 text-left shadow-2xl">
        <h3 className="mb-1.5 text-center text-lg font-bold">🎉 최종 확정 &amp; 보정요청서</h3>
        <p className="mb-4.5 text-center text-[13px] text-text-muted">확정할 사진 범위를 선택해 주세요.</p>

        <div className="mb-4 flex flex-col gap-2">
          <ScopeRadio value="union" current={scope} onChange={setScope} label="합집합 (누구든 고른 전체)" />
          <ScopeRadio value="common" current={scope} onChange={setScope} label="중복만 (2명 이상이 고른 사진)" />
          {users.map((u) => (
            <ScopeRadio key={u.id} value={`user:${u.id}` as FinalScope} current={scope} onChange={setScope} label={`${u.name} 선택만`} />
          ))}
        </div>

        <div className="mb-4 rounded-md border border-border bg-gray-50 px-3.5 py-2.5 text-[13px]">{ids.length}장이 확정 예정입니다.</div>

        <div className="mb-5 flex gap-2">
          <button onClick={handleCopyFilenames} className="tbtn flex-1 justify-center text-xs">
            📋 파일명 복사
          </button>
          <button onClick={handleDownloadFilenameTxt} className="tbtn flex-1 justify-center text-xs">
            📄 파일명 txt (라이트룸용)
          </button>
        </div>

        {handoffStatus && <div className="mb-3 text-center text-xs text-brand-primary">{handoffStatus}</div>}

        <div className="flex gap-2.5">
          <button onClick={onClose} className="tbtn flex-1 justify-center">
            취소
          </button>
          <button onClick={handleConfirm} className="tbtn primary flex-1 justify-center">
            확정하고 내보내기
          </button>
        </div>
      </div>
    </div>
  );
}

function ScopeRadio({ value, current, onChange, label }: { value: FinalScope; current: FinalScope; onChange: (v: FinalScope) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="radio" checked={current === value} onChange={() => onChange(value)} />
      {label}
    </label>
  );
}
