'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';

// 사진 크게보기 + 별점/보정요청 메모 + 선택 (wedding-photo-select/index.html:1663-1734 포팅)
// 호스트는 원본 File을 로컬에 들고 있으니 그걸로 크게 보고, 게스트는 썸네일로 본다 —
// 게스트의 원본 접근은 최종 확정 시점의 P2P 핸드오프로만 이루어지므로 여기선 다루지 않는다.
export default function Lightbox({ persistState }: { persistState: () => void }) {
  const { lbId, byId, closeLightbox, who, sel, toggleSelect, ratings, setRating, notes, addNote } = useAppStore();
  const [noteText, setNoteText] = useState('');
  const fullResUrlRef = useRef<string | null>(null);
  const [imgSrc, setImgSrc] = useState('');

  const photo = lbId ? byId.get(lbId) : null;

  useEffect(() => {
    if (fullResUrlRef.current) {
      URL.revokeObjectURL(fullResUrlRef.current);
      fullResUrlRef.current = null;
    }
    if (!photo) return;
    if (photo.file) {
      const url = URL.createObjectURL(photo.file);
      fullResUrlRef.current = url;
      setImgSrc(url);
    } else {
      setImgSrc(photo.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lbId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeLightbox();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeLightbox]);

  if (!lbId || !photo) return null;

  const isPicked = sel[who]?.has(lbId);
  const myRating = ratings[lbId]?.[who] || 0;
  const photoNotes = notes[lbId] || [];

  function handleRate(star: number) {
    setRating(lbId!, star);
    persistState();
  }

  function handleSaveNote() {
    const text = noteText.trim();
    if (!text) return;
    addNote(lbId!, text);
    setNoteText('');
    persistState();
  }

  function handlePick() {
    toggleSelect(lbId!);
    persistState();
  }

  return (
    <div className="fixed inset-0 z-[999999] flex flex-col bg-gray-900/95 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.08] px-7 py-4 text-white">
        <span className="text-base font-semibold">{photo.name}</span>
        <button onClick={closeLightbox} className="rounded bg-white/20 px-3.5 py-1.5 text-sm text-white">
          ✕ 닫기 (Esc)
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imgSrc} alt="크게보기" className="max-h-[80vh] max-w-[92%] rounded-lg object-contain shadow-2xl" />
      </div>
      <div className="flex max-h-40 flex-col gap-2 overflow-y-auto bg-black/30 px-7 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-gray-400">내 별점:</span>
          <div className="flex gap-1 text-lg">
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} onClick={() => handleRate(i)} className="cursor-pointer" style={{ color: i <= myRating ? '#FBBF24' : '#6B7280' }}>
                {i <= myRating ? '★' : '☆'}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {photoNotes.length === 0 ? (
            <div className="text-xs text-gray-500">아직 등록된 보정요청이 없어요.</div>
          ) : (
            photoNotes.map((n) => (
              <div key={n.id} className="text-xs">
                <b style={{ color: n.userColor || '#fff' }}>{n.userName || '참여자'}</b> <span className="text-gray-400">{n.time}</span>
                <br />
                {n.text}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-5 bg-[#1F2937] px-7 py-4.5">
        <div className="flex max-w-[440px] flex-1 gap-2">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveNote()}
            placeholder="작가 보정요청사항 작성 (예: 피부 보정)"
            className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-3.5 py-2.5 text-[13px] text-white outline-none"
          />
          <button onClick={handleSaveNote} className="tbtn primary">
            등록
          </button>
        </div>
        <button onClick={handlePick} className="tbtn primary px-6 py-2.5 text-[15px]">
          {isPicked ? '♥ 내 선택 취소' : '♡ 내 선택 저장'}
        </button>
      </div>
    </div>
  );
}
