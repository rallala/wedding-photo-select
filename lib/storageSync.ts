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

export type UploadProgress = { done: number; total: number };

// 호스트: 로컬에서 만든 썸네일(blob URL)들을 Supabase Storage에 업로드하고 매니페스트를 project_state에 기록.
// (직전 vanilla 버전의 sendPhotoSubset 자리를 대체 — 이제 P2P가 아니라 Storage 업로드)
export async function syncPhotosToStorage(
  supabase: SupabaseClient,
  projectId: string,
  photos: Photo[],
  onProgress?: (p: UploadProgress) => void,
): Promise<PhotoManifestEntry[]> {
  const { data: existing } = await supabase.storage.from(STORAGE_BUCKET).list(projectId, { limit: 5000 });
  const existingSizes = new Map<string, number>((existing || []).map((o) => [o.name, o.metadata?.size ?? -1]));

  const manifest: PhotoManifestEntry[] = new Array(photos.length);
  let done = 0;
  const CONCURRENCY = 4;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < photos.length) {
      const i = nextIdx++;
      const p = photos[i];
      const hash = await photoStorageKey(p.folder, p.name);
      const objectName = `${hash}.webp`;
      const path = `${projectId}/${objectName}`;

      const blob = await fetch(p.url).then((r) => r.blob());
      const alreadyUploaded = existingSizes.get(objectName) === blob.size;
      if (!alreadyUploaded) {
        await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, {
          upsert: true,
          contentType: 'image/webp',
        });
      }
      manifest[i] = { id: p.id, name: p.name, folder: p.folder, size: p.size, mtime: p.mtime, path };

      done++;
      onProgress?.({ done, total: photos.length });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await supabase
    .from('project_state')
    .update({ photos: manifest, updated_at: new Date().toISOString() })
    .eq('project_id', projectId);

  return manifest;
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
