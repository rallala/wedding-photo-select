// IndexedDB 썸네일/폴더핸들 캐시 (wedding-photo-select/index.html:430-500 포팅)
// 폴더를 다시 열거나(호스트) 같은 룸에 재접속(게스트)할 때마다 사진을 처음부터 다시
// 리사이즈/재다운로드하지 않도록 브라우저에 캐시해둔다. 키는 (범위+폴더/파일명+용량+수정시각)이라
// 파일이 실제로 바뀌면 자동으로 캐시 미스가 된다.

const IDB_NAME = 'picselec-cache';
const IDB_STORE = 'thumbs';
const IDB_HANDLE_STORE = 'dirhandles';

let idbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no-indexeddb'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if (!db.objectStoreNames.contains(IDB_HANDLE_STORE)) db.createObjectStore(IDB_HANDLE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}

export async function idbGet<T = Blob>(key: string): Promise<T | null> {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 캐시 실패는 무시 — 다음에 다시 받으면 됨 */
  }
}

export async function idbGetHandle(projectId: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(IDB_HANDLE_STORE, 'readonly').objectStore(IDB_HANDLE_STORE).get(projectId);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

export async function idbSetHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_HANDLE_STORE, 'readwrite');
      tx.objectStore(IDB_HANDLE_STORE).put(handle, projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 무시 */
  }
}

// 썸네일 생성 로직이 바뀔 때마다 버전을 올려서, 예전 버그가 있던 썸네일이 캐시에 남아
// 계속 재사용되는 일이 없도록 한다.
const THUMB_CACHE_VERSION = 'v3-webp';

export function thumbCacheKey(scope: string, folder: string, name: string, size: number, mtime: number) {
  return `${THUMB_CACHE_VERSION}::${scope}::${folder || ''}/${name}::${size || 0}::${mtime || 0}`;
}
