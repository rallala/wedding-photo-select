'use client';

import type { SyncStatus } from '@/hooks/useRoomController';

// 팝업(alert) 대신 항상 떠 있는 얇은 상태 표시줄 — 문제가 있을 때만 눈에 띄게, 평소엔 조용히.
// 스크린샷 한 장으로 바로 진단할 수 있게 실제 에러 메시지를 그대로 보여준다.
export default function SyncStatusBar({ status }: { status: SyncStatus }) {
  const problems: string[] = [];
  if (status.memberError) problems.push(`참여자 등록 실패: ${status.memberError}`);
  if (status.stateReadError) problems.push(`상태 동기화 실패: ${status.stateReadError}`);
  if (status.persistError) problems.push(`선택 저장 실패: ${status.persistError}`);
  if (status.uploadFailedCount > 0) problems.push(`썸네일 업로드 실패 ${status.uploadFailedCount}장`);
  if (status.downloadFailedCount > 0) problems.push(`썸네일 다운로드 실패 ${status.downloadFailedCount}장`);

  if (problems.length === 0) return null;

  return (
    <div className="border-b border-red-200 bg-red-50 px-6 py-1.5 text-xs text-red-700">
      ⚠️ {problems.join(' · ')}
    </div>
  );
}
