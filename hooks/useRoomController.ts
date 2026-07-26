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

// 팝업으로 매번 끊기게 알리는 대신, 화면 한쪽에 계속 떠 있는 작은 상태 표시줄에 반영한다 —
// 문제가 재발해도 스크린샷 한 장으로 바로 진단할 수 있게.
export type SyncStatus = {
  memberError: string | null; // project_members 등록 실패
  stateReadError: string | null; // project_state 조회/초기화 실패
  persistError: string | null; // 선택/별점/메모 저장 실패
  uploadFailedCount: number; // 호스트: 썸네일 업로드 실패 수
  downloadFailedCount: number; // 게스트: 썸네일 다운로드 실패 수
  photosTotal: number;
};
const EMPTY_SYNC_STATUS: SyncStatus = {
  memberError: null,
  stateReadError: null,
  persistError: null,
  uploadFailedCount: 0,
  downloadFailedCount: 0,
  photosTotal: 0,
};

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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(EMPTY_SYNC_STATUS);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const clientIdRef = useRef(Math.random().toString(36).slice(2, 10));
  const lastManifestSigRef = useRef<string>('');

  const applyRow = useAppStore((s) => s.applyProjectStateRow);

  // 게스트 전용: project_state.photos가 realtime으로 갱신될 때마다 통째로 store에 얹으면(원시
  // 매니페스트엔 blob url이 없음) 이미 잘 내려받아 보이던 사진이 다른 사람 하트 클릭 한 번에도
  // 전부 사라진다 — IndexedDB 캐시 덕에 재다운로드는 사실상 공짜이므로, 매니페스트가 실제로
  // 바뀐 경우에만 다시 받아서 유효한 url로 다시 채워 넣는다.
  const applyPhotoManifestUpdate = useCallback(
    async (manifest: any[]) => {
      if (!sb || !projectIdParam) return;
      const sig = manifest.map((m) => `${m.path}:${m.size}:${m.mtime}`).join('|');
      if (sig === lastManifestSigRef.current) return;
      lastManifestSigRef.current = sig;
      const photos = await downloadPhotosFromManifest(sb, projectIdParam, manifest as any);
      store.setPhotos(photos);
      setSyncStatus((s) => ({ ...s, downloadFailedCount: photos.filter((p) => !p.url).length, photosTotal: photos.length }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sb, projectIdParam],
  );

  // ---------- 초기 연결(공통): 프로젝트 상태 로드 + Realtime 구독 ----------
  const setupChannel = useCallback(
    (projectId: string) => {
      if (!sb) return;
      const channel = createRoomChannel(sb, projectId, clientIdRef.current, {
        onStateUpdate: (row) => {
          applyRow(row);
          if (mode === 'guest' && Array.isArray((row as any).photos)) applyPhotoManifestUpdate((row as any).photos);
        },
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
    [sb, mode, applyRow, store, applyPhotoManifestUpdate],
  );

  async function loadOrInitProjectState(projectId: string) {
    if (!sb) return;
    const { data, error } = await sb.from('project_state').select('*').eq('project_id', projectId).maybeSingle();
    if (error) {
      console.error('프로젝트 상태 로드 실패:', error.message);
      setSyncStatus((s) => ({ ...s, stateReadError: error.message }));
      return;
    }
    if (data) applyRow(data as any);
    else {
      const { error: insertErr } = await sb
        .from('project_state')
        .insert({ project_id: projectId, selections: {}, notes: {}, ratings: {}, users: store.users, photos: [] });
      if (insertErr) {
        console.error('프로젝트 상태 초기화 실패:', insertErr.message);
        setSyncStatus((s) => ({ ...s, stateReadError: insertErr.message }));
      }
    }
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

      const { data: prevStateRow } = await sb.from('project_state').select('photos').eq('project_id', project.id).maybeSingle();
      const previousManifest = (prevStateRow?.photos as any[]) || [];

      setProgress({ open: true, title: '☁️ 썸네일을 업로드하는 중입니다...', sub: '', pct: 0 });
      const { failedNames } = await syncPhotosToStorage(
        sb,
        project.id,
        photos,
        (p: UploadProgress) => {
          setProgress({
            open: true,
            title: `☁️ 썸네일 확인/업로드 중... (${p.done}/${p.total})`,
            sub: p.failed > 0 ? `⚠️ 실패 ${p.failed}장` : '',
            pct: Math.round((p.done / p.total) * 100),
          });
        },
        previousManifest,
      );
      setProgress(HIDDEN_PROGRESS);
      setSyncStatus((s) => ({ ...s, uploadFailedCount: failedNames.length, photosTotal: photos.length }));

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

    // 게스트가 랜딩의 "참여 코드로 입장하기"를 거치지 않고(예: 공유받은 /room 링크로 바로 진입)
    // 들어온 경우에도 project_members에 반드시 들어가 있어야 project_state/Storage RLS를 통과한다.
    const {
      data: { user: authUser },
    } = await sb.auth.getUser();
    if (authUser) {
      const { error: memberErr } = await sb
        .from('project_members')
        .upsert({ project_id: projectIdParam, user_id: authUser.id, role: 'guest' }, { onConflict: 'project_id,user_id', ignoreDuplicates: true });
      if (memberErr) {
        console.error('project_members 등록 실패:', memberErr.message);
        setSyncStatus((s) => ({ ...s, memberError: memberErr.message }));
      }
    }

    await loadOrInitProjectState(projectIdParam);

    const { data: stateRow } = await sb.from('project_state').select('photos').eq('project_id', projectIdParam).maybeSingle();
    const manifest = (stateRow?.photos as any[]) || [];
    lastManifestSigRef.current = manifest.map((m) => `${m.path}:${m.size}:${m.mtime}`).join('|');

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

      const failedCount = photos.filter((p) => !p.url).length;
      setSyncStatus((s) => ({ ...s, downloadFailedCount: failedCount, photosTotal: photos.length }));
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
    persistProjectStateFn(sb, store.projectId, { sel: store.sel, notes: store.notes, ratings: store.ratings, users: store.users }, (message) => {
      setSyncStatus((s) => ({ ...s, persistError: message }));
    });
    setSyncStatus((s) => (s.persistError ? { ...s, persistError: null } : s)); // 새로 시도하는 거니 이전 에러 표시는 지움(성공하면 그대로 사라진 채 유지)
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
    syncStatus,
    receivedOriginals,
    openFolderPicker,
    regrantFolderAccess,
    persistState,
    requestOriginalsFromHost,
    pushOriginalsToAllGuests,
    clientId: clientIdRef.current,
  };
}
