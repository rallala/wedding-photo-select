'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';
import { useAppStore, type Photo } from '@/store/useAppStore';
import { scanDirectoryPhotos, type ScanProgress } from '@/lib/thumbnails';
import { syncPhotosToStorage, downloadPhotosFromManifest, type UploadProgress, type DownloadProgress } from '@/lib/storageSync';
import {
  createRoomChannel,
  subscribeAndTrackPresence,
  persistProjectState as persistProjectStateFn,
  getOtherPresenceIds,
  broadcastHandoffRequest,
  type SignalPayload,
} from '@/lib/roomRealtime';
import { guestHandleIncomingOffer, routeAnswerOrIce, hostSendOriginalsToGuest, type HandoffFile } from '@/lib/finalHandoffP2P';
import { idbGetHandle, idbSetHandle } from '@/lib/idbCache';

export type ProgressState = { open: boolean; title: string; sub: string; pct: number };
const HIDDEN_PROGRESS: ProgressState = { open: false, title: '', sub: '', pct: 0 };

export type ReceivedOriginal = { id: string; name: string; blob: Blob };

// 호스트/게스트 룸 연결, 폴더 열기+Storage 동기화, 실시간 상태 구독, 최종 확정 시 P2P 핸드오프까지
// 전부 감싸는 컨트롤러 훅. (wedding-photo-select/index.html의 initRoomHost/initRoomGuest/runFinalConfirm 자리를 대체)
export function useRoomController() {
  const searchParams = useSearchParams();
  const mode = (searchParams.get('mode') as 'host' | 'guest' | null) ?? null;
  const projectIdParam = searchParams.get('project');
  const sb = getSupabaseBrowserClient();

  const store = useAppStore();
  const [progress, setProgress] = useState<ProgressState>(HIDDEN_PROGRESS);
  const [projectTitle, setProjectTitle] = useState<string>('');
  const [needsFolderPick, setNeedsFolderPick] = useState(mode === 'host');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [receivedOriginals, setReceivedOriginals] = useState<ReceivedOriginal[]>([]);
  // 이전에 열었던 폴더 핸들은 IndexedDB에 남아있지만, 브라우저가 재시작되면 대개 접근 권한이
  // 'granted'로 자동 복원되지 않고 'prompt'로 돌아간다 — queryPermission은 그 상태를 확인만 할 뿐
  // 사용자에게 권한을 다시 물어보진 않으므로(사용자 제스처 없이는 요청 자체가 안 됨), 버튼을 눌러야만
  // 열리는 requestPermission으로 넘어가기 전까지 이 핸들을 들고 있는다.
  const [pendingReopenHandle, setPendingReopenHandle] = useState<FileSystemDirectoryHandle | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const clientIdRef = useRef(Math.random().toString(36).slice(2, 10));

  const applyRow = useAppStore((s) => s.applyProjectStateRow);

  // ---------- 초기 연결(공통): 프로젝트 상태 로드 + Realtime 구독 ----------
  const setupChannel = useCallback(
    (projectId: string) => {
      if (!sb) return;
      const channel = createRoomChannel(sb, projectId, clientIdRef.current, {
        onStateUpdate: (row) => applyRow(row),
        onSignal: (payload: SignalPayload) => {
          if (mode === 'guest' && payload.kind === 'offer') {
            guestHandleIncomingOffer(
              channel,
              payload,
              clientIdRef.current,
              (file) => setReceivedOriginals((prev) => [...prev, file]),
              () => {},
            );
          } else {
            routeAnswerOrIce(payload);
          }
        },
        onPresenceCount: (count) => store.setRoom({ connectedGuests: Math.max(0, count - 1) }),
        onHandoffRequest:
          mode === 'host'
            ? (req) => {
                const files: HandoffFile[] = req.ids
                  .map((id) => store.byId.get(id))
                  .filter((p): p is Photo => !!p?.file)
                  .map((p) => ({ id: p.id, name: p.name, file: p.file! }));
                if (files.length) hostSendOriginalsToGuest(channel, req.from, clientIdRef.current, files);
              }
            : undefined,
      });
      channelRef.current = channel;
      subscribeAndTrackPresence(channel);
    },
    [sb, mode, applyRow, store],
  );

  async function loadOrInitProjectState(projectId: string) {
    if (!sb) return;
    const { data, error } = await sb.from('project_state').select('*').eq('project_id', projectId).maybeSingle();
    if (error) {
      console.error('프로젝트 상태 로드 실패:', error.message);
      return;
    }
    if (data) applyRow(data as any);
    else await sb.from('project_state').insert({ project_id: projectId, selections: {}, notes: {}, ratings: {}, users: store.users, photos: [] });
  }

  // ---------- 호스트 ----------
  async function bindProjectFolder(projectId: string, folderName: string) {
    if (!sb) return null;
    const { data: project, error } = await sb.from('projects').select('*').eq('id', projectId).single();
    if (error || !project) {
      alert('프로젝트 정보를 찾을 수 없습니다. 처음 화면에서 다시 시작해 주세요.');
      return null;
    }
    if (!project.folder_name) {
      const { data: updated, error: updErr } = await sb.from('projects').update({ folder_name: folderName }).eq('id', projectId).select().single();
      if (updErr) {
        alert('폴더 등록에 실패했습니다: ' + updErr.message);
        return null;
      }
      return updated;
    }
    if (project.folder_name !== folderName) {
      alert(`이 프로젝트("${project.title}")는 "${project.folder_name}" 폴더로 시작됐어요.\n선택하신 "${folderName}" 폴더와 일치하지 않아 열 수 없습니다. 같은 폴더를 다시 선택해 주세요.`);
      return null;
    }
    return project;
  }

  const runHostSetup = useCallback(
    async (dirHandle: FileSystemDirectoryHandle) => {
      if (!projectIdParam || !sb) return;
      store.setDirHandle(dirHandle);

      setProgress({ open: true, title: `📸 사진을 준비하는 중입니다...`, sub: '', pct: 0 });
      const photos = await scanDirectoryPhotos(dirHandle, (p: ScanProgress) => {
        const pct = Math.round((p.done / p.total) * 100);
        setProgress({ open: true, title: `📸 사진 ${p.total}장을 준비하는 중입니다...`, sub: `캐시 재사용 ${p.cacheHits}장`, pct });
      });
      if (photos.length === 0) {
        setProgress(HIDDEN_PROGRESS);
        alert('이 폴더에서 이미지 파일(.jpg 등)을 찾지 못했습니다.');
        return;
      }
      store.setPhotos(photos);
      setNeedsFolderPick(false);

      const project = await bindProjectFolder(projectIdParam, dirHandle.name);
      if (!project) {
        setProgress(HIDDEN_PROGRESS);
        return;
      }
      setProjectTitle(project.title);
      store.setRoom({ roomMode: 'host', projectId: project.id, roomCode: project.room_code });
      idbSetHandle(projectIdParam, dirHandle);

      await loadOrInitProjectState(project.id);

      setProgress({ open: true, title: '☁️ 썸네일을 업로드하는 중입니다...', sub: '', pct: 0 });
      await syncPhotosToStorage(sb, project.id, photos, (p: UploadProgress) => {
        setProgress({ open: true, title: `☁️ 썸네일 업로드 중... (${p.done}/${p.total})`, sub: '', pct: Math.round((p.done / p.total) * 100) });
      });
      setProgress(HIDDEN_PROGRESS);

      setupChannel(project.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectIdParam, sb],
  );

  const openFolderPicker = useCallback(async () => {
    try {
      if (!('showDirectoryPicker' in window)) {
        alert('크롬(Chrome), 엣지(Edge), 네이버 웨일 브라우저를 이용해 주세요.');
        return;
      }
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await runHostSetup(dirHandle);
    } catch {
      /* 사용자가 취소한 경우 등 — 조용히 무시 */
    }
  }, [runHostSetup]);

  const tryAutoResumeFolder = useCallback(async () => {
    if (!projectIdParam) return;
    const handle = await idbGetHandle(projectIdParam);
    if (!handle) return;
    try {
      const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') await runHostSetup(handle);
      else setPendingReopenHandle(handle); // 버튼을 눌러 재요청해야 함 — TopBar가 이 상태를 보고 버튼 문구를 바꿈
    } catch {
      /* 무시 — 수동 선택으로 폴백 */
    }
  }, [projectIdParam, runHostSetup]);

  // "🔓 이전 폴더 접근 허용하고 열기" 버튼 클릭 시 실행 — requestPermission은 사용자 제스처(클릭) 안에서
  // 호출해야 브라우저가 실제로 허용 팝업을 띄운다(queryPermission과 달리 이게 핵심 차이).
  const regrantFolderAccess = useCallback(async () => {
    if (!pendingReopenHandle) return;
    try {
      const granted = await (pendingReopenHandle as any).requestPermission({ mode: 'readwrite' });
      if (granted === 'granted') {
        setPendingReopenHandle(null);
        await runHostSetup(pendingReopenHandle);
        return;
      }
    } catch {}
    // 거부됐으면 새로 폴더를 고르는 기존 방식으로 폴백
    setPendingReopenHandle(null);
    await openFolderPicker();
  }, [pendingReopenHandle, runHostSetup, openFolderPicker]);

  // ---------- 게스트 ----------
  const runGuestSetup = useCallback(async () => {
    if (!projectIdParam || !sb) return;
    store.setRoom({ roomMode: 'guest', projectId: projectIdParam });
    setProgress({ open: true, title: '📡 셀렉룸에 연결하는 중입니다...', sub: '호스트가 사진 폴더를 여는 즉시 자동으로 전송이 시작돼요.', pct: 0 });

    const { data: project } = await sb.from('projects').select('title').eq('id', projectIdParam).single();
    if (project) setProjectTitle(project.title);

    await loadOrInitProjectState(projectIdParam);

    const { data: stateRow } = await sb.from('project_state').select('photos').eq('project_id', projectIdParam).maybeSingle();
    const manifest = (stateRow?.photos as any[]) || [];

    if (manifest.length === 0) {
      setProgress(HIDDEN_PROGRESS);
    } else {
      const photos = await downloadPhotosFromManifest(sb, projectIdParam, manifest as any, (p: DownloadProgress) => {
        setProgress({
          open: true,
          title: `📸 사진 ${p.total}장을 받는 중입니다... (캐시 재사용 ${p.cacheHits}장)`,
          sub: '',
          pct: Math.round((p.done / p.total) * 100),
        });
      });
      store.setPhotos(photos);
      setProgress(HIDDEN_PROGRESS);
    }

    setupChannel(projectIdParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdParam, sb]);

  // ---------- 진입 시 분기 ----------
  useEffect(() => {
    if (!projectIdParam) return;
    if (mode === 'guest') runGuestSetup();
    else if (mode === 'host') tryAutoResumeFolder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdParam, mode]);

  useEffect(() => {
    return () => {
      channelRef.current?.unsubscribe();
    };
  }, []);

  // ---------- 선택 상태 저장(디바운스) ----------
  const persistState = useCallback(() => {
    if (!sb || !store.projectId) return;
    persistProjectStateFn(sb, store.projectId, { sel: store.sel, notes: store.notes, ratings: store.ratings, users: store.users });
  }, [sb, store.projectId, store.sel, store.notes, store.ratings, store.users]);

  // ---------- 최종 확정 시 원본 P2P 요청/전송 ----------
  // 게스트: "내 최종 확정본 원본도 줘"를 호스트에게 요청(호스트가 접속 중이어야 성사됨)
  const requestOriginalsFromHost = useCallback(
    (ids: string[]) => {
      if (!channelRef.current) return;
      setReceivedOriginals([]);
      broadcastHandoffRequest(channelRef.current, clientIdRef.current, ids);
    },
    [],
  );

  // 호스트: 지금 접속 중인 모든 게스트에게 선제적으로 원본 전송
  const pushOriginalsToAllGuests = useCallback((ids: string[]) => {
    if (!channelRef.current) return;
    const files: HandoffFile[] = ids
      .map((id) => store.byId.get(id))
      .filter((p): p is Photo => !!p?.file)
      .map((p) => ({ id: p.id, name: p.name, file: p.file! }));
    if (!files.length) return;
    const guestIds = getOtherPresenceIds(channelRef.current, clientIdRef.current);
    guestIds.forEach((gid) => hostSendOriginalsToGuest(channelRef.current!, gid, clientIdRef.current, files));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    mode,
    progress,
    projectTitle,
    needsFolderPick,
    needsFolderRegrant: !!pendingReopenHandle,
    connectError,
    receivedOriginals,
    openFolderPicker,
    regrantFolderAccess,
    persistState,
    requestOriginalsFromHost,
    pushOriginalsToAllGuests,
    clientId: clientIdRef.current,
  };
}
