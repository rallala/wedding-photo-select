import type { Photo } from '@/store/useAppStore';
import { detectEyesClosed } from '@/lib/eyeDetect';

export type PhotoHash = { id: string; hash: string; folder: string; avgColor: [number, number, number] };

// 새로고침 후 폴더를 다시 열면 이 함수가 다시 트리거되는데, 이전 실행이 아직 안 끝난 채로 같이
// 돌면 결과가 뒤섞일 수 있다 — 토큰으로 오래된 실행은 결과를 버리게 한다.
// (wedding-photo-select/index.html:1399-1485 runSmartAnalysisAsync 포팅)
let smartAnalysisToken = 0;

export type SmartAnalysisProgress = { done: number; total: number };

export async function runSmartAnalysis(
  photos: Photo[],
  onProgress?: (p: SmartAnalysisProgress) => void,
): Promise<{ hashes: PhotoHash[]; eyeClosedIds: Set<string> } | null> {
  if (photos.length === 0) return null;
  const myToken = ++smartAnalysisToken;

  const total = photos.length;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 8;
  canvas.height = 8;

  const hashes: PhotoHash[] = [];
  const eyeClosedIds = new Set<string>();

  for (let i = 0; i < total; i++) {
    if (smartAnalysisToken !== myToken) return null; // 더 최신 실행이 시작됨 — 이 실행은 포기

    const p = photos[i];
    let bitmap: ImageBitmap | null = null;
    try {
      // p.url은 이미 축소된 썸네일이라 원본을 다시 디코딩하지 않음(2천 장대 폴더 메모리 부족 방지)
      const blob = await fetch(p.url).then((r) => r.blob());
      bitmap = await createImageBitmap(blob);

      ctx.drawImage(bitmap, 0, 0, 8, 8);
      const imgData = ctx.getImageData(0, 0, 8, 8).data;

      const gray = new Array<number>(64);
      let sumR = 0,
        sumG = 0,
        sumB = 0;
      for (let idx = 0; idx < 64; idx++) {
        const o = idx * 4;
        gray[idx] = (imgData[o] + imgData[o + 1] + imgData[o + 2]) / 3;
        sumR += imgData[o];
        sumG += imgData[o + 1];
        sumB += imgData[o + 2];
      }

      // 가로+세로 그라디언트로 112비트 — 구도/윤곽 판별력이 커져서 서로 다른 장면인데
      // 우연히 비슷하게 잡히는 오탐이 줄어든다.
      let hashStr = '';
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 7; x++) hashStr += gray[y * 8 + x] > gray[y * 8 + x + 1] ? '1' : '0';
      }
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 7; y++) hashStr += gray[y * 8 + x] > gray[(y + 1) * 8 + x] ? '1' : '0';
      }

      hashes.push({ id: p.id, hash: hashStr, folder: p.folder, avgColor: [sumR / 64, sumG / 64, sumB / 64] });

      const eyesClosed = await Promise.race([
        detectEyesClosed(bitmap),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000)),
      ]);
      if (eyesClosed) eyeClosedIds.add(p.id);
    } catch {
      /* 이 사진은 건너뛰고 계속 진행 */
    } finally {
      bitmap?.close();
    }

    if (smartAnalysisToken === myToken && (i % 10 === 0 || i === total - 1)) {
      onProgress?.({ done: i + 1, total });
    }
    if (i % 25 === 0) await new Promise((r) => setTimeout(r, 10));
  }

  if (smartAnalysisToken !== myToken) return null;
  return { hashes, eyeClosedIds };
}

// ⚖️ 감도 슬라이더 실시간 조율 연동 — 구도 해시(가로+세로 그라디언트) + 평균 색상, 둘 다 가까워야
// "유사 컷"으로 인정한다. (wedding-photo-select/index.html:1487-1525 recalculateSimilarity 포팅)
export function computeSimilarGroups(hashes: PhotoHash[], sensLevel: number): Map<string, string> {
  const similarGroups = new Map<string, string>();
  if (!hashes || hashes.length === 0) return similarGroups;

  const baseThresholds = [0, 9, 12, 16, 20, 27];
  const seqThresholds = [0, 13, 18, 22, 28, 36];
  const colorThresholds = [0, 30, 45, 60, 80, 100];

  const baseTh = baseThresholds[sensLevel] ?? 16;
  const seqTh = seqThresholds[sensLevel] ?? 22;
  const colorTh = colorThresholds[sensLevel] ?? 60;

  let groupIdx = 1;
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const isNearSeq = j - i <= 4 && hashes[i].folder === hashes[j].folder;

      let diff = 0;
      const hi = hashes[i].hash,
        hj = hashes[j].hash;
      for (let k = 0; k < hi.length; k++) if (hi[k] !== hj[k]) diff++;
      if (diff > (isNearSeq ? seqTh : baseTh)) continue;

      const ci = hashes[i].avgColor,
        cj = hashes[j].avgColor;
      const colorDiff = Math.abs(ci[0] - cj[0]) + Math.abs(ci[1] - cj[1]) + Math.abs(ci[2] - cj[2]);
      if (colorDiff > colorTh) continue;

      const curGroup = similarGroups.get(hashes[i].id) || `그룹 ${groupIdx}`;
      similarGroups.set(hashes[i].id, curGroup);
      similarGroups.set(hashes[j].id, curGroup);
    }
    if (similarGroups.has(hashes[i].id)) groupIdx++;
  }

  return similarGroups;
}
