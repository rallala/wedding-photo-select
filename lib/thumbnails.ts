import type { Photo } from '@/store/useAppStore';
import { idbGet, idbSet, thumbCacheKey } from '@/lib/idbCache';

const IMG_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;

// 원본을 그대로 그리드에 물고 있으면 2천 장 넘는 폴더에서 브라우저가 메모리 부족으로 죽기 때문에,
// 로드 시점에 작게 축소한 썸네일만 만들어서 들고 있고 원본(file)은 라이트박스/최종 확정 시에만 쓴다.
// (wedding-photo-select/index.html:1263-1282 makeThumbBlob 포팅 — 포맷만 WebP로 변경해 100KB 이하를 목표로 함)
export async function makeThumbBlob(file: File, maxDim = 640, quality = 0.82): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  } catch {
    return null; // 실패하면 호출부에서 원본으로 폴백
  }
}

export type ScanProgress = { done: number; total: number; cacheHits: number };

// 폴더를 재귀적으로 훑어 이미지 파일을 모으고, 워커 풀로 병렬 썸네일 생성(IndexedDB 캐시 우선).
// (wedding-photo-select/index.html:1284-1356 loadPhotosFromDirectory 포팅)
export async function scanDirectoryPhotos(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (p: ScanProgress) => void,
): Promise<Photo[]> {
  const rawEntries: { entry: FileSystemFileHandle; folder: string }[] = [];

  async function scanDir(handle: FileSystemDirectoryHandle, folderName = '') {
    for await (const entry of (handle as any).values() as AsyncIterable<FileSystemHandle>) {
      if (entry.kind === 'file' && IMG_EXT_RE.test(entry.name)) {
        rawEntries.push({ entry: entry as FileSystemFileHandle, folder: folderName });
      } else if (entry.kind === 'directory') {
        const subFolder = folderName ? `${folderName}/${entry.name}` : entry.name;
        await scanDir(entry as FileSystemDirectoryHandle, subFolder);
      }
    }
  }
  await scanDir(dirHandle);

  const total = rawEntries.length;
  if (total === 0) return [];

  const scope = dirHandle.name;
  const photoObjs = new Array<Photo>(total);
  let doneCount = 0;
  let cacheHitCount = 0;
  const CONCURRENCY = 6;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < total) {
      const i = nextIdx++;
      const item = rawEntries[i];
      const file = await item.entry.getFile();
      const key = thumbCacheKey(scope, item.folder, item.entry.name, file.size, file.lastModified);

      let thumbBlob = await idbGet<Blob>(key);
      if (thumbBlob) cacheHitCount++;
      else {
        thumbBlob = await makeThumbBlob(file);
        if (thumbBlob) idbSet(key, thumbBlob);
      }
      const url = URL.createObjectURL(thumbBlob || file);
      photoObjs[i] = {
        id: item.entry.name,
        name: item.entry.name,
        folder: item.folder,
        file,
        url,
        size: file.size,
        mtime: file.lastModified,
      };

      doneCount++;
      if (onProgress && (doneCount % 20 === 0 || doneCount === total)) {
        onProgress({ done: doneCount, total, cacheHits: cacheHitCount });
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // 촬영 타임스탬프 순 정렬(탐색 순서/파일명 순 아님)
  photoObjs.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return photoObjs;
}
