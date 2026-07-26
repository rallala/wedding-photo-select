'use client';

import { Suspense, useState } from 'react';
import { useRoomController } from '@/hooks/useRoomController';
import { useAppStore } from '@/store/useAppStore';
import { runSmartAnalysis, computeSimilarGroups } from '@/lib/similarity';
import TopBar from '@/components/room/TopBar';
import ControlsBar from '@/components/room/ControlsBar';
import PhotoGrid from '@/components/room/PhotoGrid';
import Sidebar from '@/components/room/Sidebar';
import Lightbox from '@/components/room/Lightbox';
import ProgressModal from '@/components/room/ProgressModal';
import WhoModal from '@/components/room/WhoModal';
import TournamentModal from '@/components/room/TournamentModal';
import FinalConfirmModal from '@/components/room/FinalConfirmModal';
import SyncStatusBar from '@/components/room/SyncStatusBar';

// 셀렉 앱 본체 — (wedding-photo-select/index.html 전체 조립)
export default function RoomPage() {
  return (
    <Suspense fallback={null}>
      <RoomPageInner />
    </Suspense>
  );
}

function RoomPageInner() {
  const controller = useRoomController();
  const { photos, sensLevel, setHashesCache, setSimilarGroups, setEyeClosedSet, openLightbox, users, sel, roomCode, connectedGuests } = useAppStore();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const unionCount = new Set<string>();
  users.forEach((u) => (sel[u.id] || new Set()).forEach((id) => unionCount.add(id)));

  async function handleRunSmartAnalysis() {
    if (photos.length === 0) return;
    setAnalyzing(true);
    try {
      const result = await runSmartAnalysis(photos);
      if (result) {
        setHashesCache(result.hashes);
        setEyeClosedSet(result.eyeClosedIds);
        setSimilarGroups(computeSimilarGroups(result.hashes, sensLevel));
      }
    } finally {
      setAnalyzing(false);
    }
  }

  function shareRoomCode() {
    if (controller.mode !== 'host' || !roomCode) {
      alert('먼저 사진 폴더를 선택해 룸을 시작해 주세요.');
      return;
    }
    const joinUrl = location.origin + '/?join=' + encodeURIComponent(roomCode);
    const text = `💒 PicSelec 셀렉룸에 초대합니다!\n접속 코드: ${roomCode}\n${joinUrl}`;

    const kakao = (window as any).Kakao;
    if (kakao?.isInitialized?.()) {
      kakao.Share.sendDefault({ objectType: 'text', text, link: { mobileWebUrl: joinUrl, webUrl: joinUrl } });
    } else if (navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => alert('접속 코드와 링크가 복사되었습니다. 카카오톡에 붙여넣어 보내주세요!'))
        .catch(() => alert(text));
    } else {
      alert(text);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-main">
      <TopBar
        mode={controller.mode}
        needsFolderPick={controller.needsFolderPick}
        needsFolderRegrant={controller.needsFolderRegrant}
        projectTitle={controller.projectTitle}
        roomCode={roomCode}
        connectedGuests={connectedGuests}
        smartAnalyzing={analyzing}
        onOpenFolder={controller.openFolderPicker}
        onRegrantFolder={controller.regrantFolderAccess}
        onRunSmartAnalysis={handleRunSmartAnalysis}
        onOpenTournament={() => setTourOpen(true)}
        onOpenWho={() => setWhoOpen(true)}
        onShareRoomCode={shareRoomCode}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        sideBadgeCount={unionCount.size}
      />
      <SyncStatusBar status={controller.syncStatus} />
      <ControlsBar onOpenFinal={() => setFinalOpen(true)} />

      <div className="relative flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <PhotoGrid onOpenPhoto={openLightbox} persistState={controller.persistState} />
        </main>
        <Sidebar collapsed={sidebarCollapsed} onClose={() => setSidebarCollapsed(true)} onOpenPhoto={openLightbox} />
      </div>

      <ProgressModal progress={controller.progress} />
      <WhoModal open={whoOpen} onClose={() => setWhoOpen(false)} persistState={controller.persistState} />
      <TournamentModal open={tourOpen} onClose={() => setTourOpen(false)} persistState={controller.persistState} />
      <FinalConfirmModal
        open={finalOpen}
        onClose={() => setFinalOpen(false)}
        mode={controller.mode}
        requestOriginalsFromHost={controller.requestOriginalsFromHost}
        pushOriginalsToAllGuests={controller.pushOriginalsToAllGuests}
        receivedOriginals={controller.receivedOriginals}
        persistState={controller.persistState}
      />
      <Lightbox persistState={controller.persistState} />
    </div>
  );
}
