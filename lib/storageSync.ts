import type { SupabaseClient } from '@supabase/supabase-js';
import type { Photo } from '@/store/useAppStore';
import { idbGet, idbSet, thumbCacheKey } from '@/lib/idbCache';

export const STORAGE_BUCKET = 'project-photos';

// 같은 파일명이 다른 폴더에 있어도 스토리지 경로가 충돌하지 않도록 folder+name을 해시해 키로 쓴다.
async function photoStorageKey(folder: string, name: string): Promise<string> {
  const data = new TextEncoder().encode(`${folder}/${name}`);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type PhotoManifestEntry = { id: string; name: string; folder: string; size: number; mtime: number; path: string };

export type UploadProgress = { done: number; total: number; failed: number };
export type SyncResult = { manifest: PhotoManifestEntry[]; failedNames: string[] };

// 호스트: 로컬에서 만든 썸네일(blob URL)들을 Supabase Storage에 업로드하고 매니페스트를 project_state에 기록.
// (직전 vanilla 버전의 sendPhotoSubset 자리를 대체 — 이제 P2P가 아니라 Storage 업로드)
//
// 업로드가 실패해도 매니페스트에 그대로 기록해버리면, 게스트는 존재하지 않는 파일을 내려받으려다
// 전부 실패해서 그리드가 깨진 이미지 아이콘으로 가득 차게 된다 — 실패한 사진은 매니페스트에서
// 아예 제외해서, 최소한 "업로드 성공한 사진만 게스트에게 보인다"가 되도록 한다.
//
// previousManifest를 주면 (폴더+파일명+용량+수정시각)이 그대로인 사진은 blob fetch/업로드 요청 자체를
// 안 하고 바로 재사용한다 — 안 그러면 호스트가 프로젝트에 다시 들어올 때마다 안 바뀐 수백~수천 장을
// 매번 다시 fetch+업로드 시도하는 것처럼 보여서(진행률이 처음부터 다시 도는 것처럼 보임) 느리고 헷갈린다.
export async function syncPhotosToStorage(
  supabase: SupabaseClient,
  projectId: string,
  photos: Photo[],
  onProgress?: (p: UploadProgress) => void,
  previousManifest: PhotoManifestEntry[] = [],
): Promise<SyncResult> {
  const prevByName = new Map<string, PhotoManifestEntry>(previousManifest.map((m) => [`${m.folder}::${m.name}`, m]));

  const manifest: (PhotoManifestEntry | null)[] = new Array(photos.length);
  let done = 0;
  let failed = 0;
  const CONCURRENCY = 4;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < photos.length) {
      const i = nextIdx++;
      const p = photos[i];
      const prev = prevByName.get(`${p.folder}::${p.name}`);

      if (prev && prev.size === p.size && prev.mtime === p.mtime) {
        // 이전에 이미 업로드 성공한 것과 완전히 동일한 파일 — 다시 fetch/업로드하지 않고 그대로 재사용
        manifest[i] = prev;
        done++;
        onProgress?.({ done, total: photos.length, failed });
        continue;
      }

      const hash = await photoStorageKey(p.folder, p.name);
      const path = `${projectId}/${hash}.webp`;

      const blob = await fetch(p.url).then((r) => r.blob());
      const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, {
        upsert: true,
        contentType: 'image/webp',
      });
      if (error) {
        console.error(`썸네일 업로드 실패 (${p.name}):`, error.message);
        failed++;
        manifest[i] = null;
      } else {
        manifest[i] = { id: p.id, name: p.name, folder: p.folder, size: p.size, mtime: p.mtime, path };
      }

      done++;
      onProgress?.({ done, total: photos.length, failed });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const okManifest = manifest.filter((m): m is PhotoManifestEntry => m !== null);
  const failedNames = photos.filter((_, i) => manifest[i] === null).map((p) => p.name);

  const { error: stateErr } = await supabase
    .from('project_state')
    .update({ photos: okManifest, updated_at: new Date().toISOString() })
    .eq('project_id', projectId);
  if (stateErr) console.error('사진 매니페스트 저장 실패:', stateErr.message);

  return { manifest: okManifest, failedNames };
}

export type DownloadProgress = { done: number; total: number; cacheHits: number };

// 게스트: project_state.photos 매니페스트를 읽고, IndexedDB 캐시에 없는 것만 Storage에서 내려받는다.
export async function downloadPhotosFromManifest(
  supabase: SupabaseClient,
  projectId: string,
  manifest: PhotoManifestEntry[],
  onProgress?: (p: DownloadProgress) => void,
): Promise<Photo[]> {
  const total = manifest.length;
  const photos = new Array<Photo>(total);
  let done = 0;
  let cacheHits = 0;
  const CONCURRENCY = 6;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < total) {
      const i = nextIdx++;
      const m = manifest[i];
      const key = thumbCacheKey(projectId, m.folder, m.name, m.size, m.mtime);

      let blob = await idbGet<Blob>(key);
      if (blob) cacheHits++;
      else {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(m.path);
        if (!error && data) {
          blob = data;
          idbSet(key, blob);
        }
      }

      photos[i] = {
        id: m.id,
        name: m.name,
        folder: m.folder,
        size: m.size,
        mtime: m.mtime,
        path: m.path,
        url: blob ? URL.createObjectURL(blob) : '',
      };

      done++;
      onProgress?.({ done, total, cacheHits });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return photos;
}
