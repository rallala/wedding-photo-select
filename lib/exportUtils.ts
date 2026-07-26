import type { Photo, Profile } from '@/store/useAppStore';

export type FinalScope = 'union' | 'common' | `user:${string}`;

// (wedding-photo-select/index.html:1783-1793 computeFinalScopeIds 포팅)
export function computeFinalScopeIds(scope: FinalScope, users: Profile[], sel: Record<string, Set<string>>, allIds: string[]): string[] {
  if (scope === 'common') {
    return allIds.filter((id) => users.filter((u) => sel[u.id]?.has(id)).length >= 2);
  }
  if (scope.startsWith('user:')) {
    return Array.from(sel[scope.slice(5)] || []);
  }
  const union = new Set<string>();
  users.forEach((u) => (sel[u.id] || new Set()).forEach((id) => union.add(id)));
  return Array.from(union);
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// 작가 전달용 보정요청서: 별점/보정 메모를 엑셀(CSV)로 (wedding-photo-select/index.html:1819-1832 포팅)
export function buildCorrectionCSV(
  ids: string[],
  byId: Map<string, Photo>,
  users: Profile[],
  sel: Record<string, Set<string>>,
  ratings: Record<string, Record<string, number>>,
  notes: Record<string, { userName?: string; user: string; text: string }[]>,
): string {
  const header = ['파일명', '폴더', ...users.flatMap((u) => [`${u.name}선택`, `${u.name}별점`]), '보정요청사항'];
  const rows: string[][] = [header];
  ids.forEach((id) => {
    const p = byId.get(id);
    if (!p) return;
    const r = ratings[id] || {};
    const noteStr = (notes[id] || []).map((n) => `[${n.userName || n.user}] ${n.text}`).join(' / ');
    const perUser = users.flatMap((u) => [sel[u.id]?.has(id) ? 'O' : '', String(r[u.id] || '')]);
    rows.push([p.name, p.folder || '', ...perUser, noteStr]);
  });
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  return '﻿' + csv; // BOM: 엑셀에서 한글 깨짐 방지
}

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// 신규: 라이트룸/스튜디오 제출용 콤마 구분 파일명 목록
export function buildFilenameList(ids: string[], byId: Map<string, Photo>): string {
  return ids.map((id) => byId.get(id)?.name).filter(Boolean).join(', ');
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  try {
    if ((await (handle as any).queryPermission(opts)) === 'granted') return true;
    if ((await (handle as any).requestPermission(opts)) === 'granted') return true;
  } catch {}
  return false;
}

// 브라우저로 연 원본 폴더 안에 결과 폴더를 만들어 선택된 원본 파일을 복사(호스트 전용)
// (wedding-photo-select/index.html:1853-1882 포팅)
export async function copySelectedFilesToFolder(
  dirHandle: FileSystemDirectoryHandle,
  ids: string[],
  byId: Map<string, Photo>,
): Promise<{ ok: boolean; count?: number; total?: number; destName?: string; reason?: string }> {
  if (!(await ensureWritePermission(dirHandle))) return { ok: false, reason: 'no-permission' };

  const destName = '_최종셀렉_' + new Date().toISOString().slice(0, 10);
  const destHandle = await (dirHandle as any).getDirectoryHandle(destName, { create: true });

  const usedNames = new Set<string>();
  let count = 0;
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || !p.file) continue;
    let name = p.name;
    let i = 1;
    while (usedNames.has(name)) {
      const dot = p.name.lastIndexOf('.');
      const base = dot > -1 ? p.name.slice(0, dot) : p.name;
      const ext = dot > -1 ? p.name.slice(dot) : '';
      name = `${base}(${i})${ext}`;
      i++;
    }
    usedNames.add(name);
    try {
      const fh = await destHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(p.file);
      await w.close();
      count++;
    } catch {}
  }
  return { ok: true, count, total: ids.length, destName };
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
