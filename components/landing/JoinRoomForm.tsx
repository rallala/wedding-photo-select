'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';
import type { CurrentUser } from '@/lib/authHelpers';

// 참여 코드로 셀렉 룸 입장 (wedding-photo-select/landing.html:514-524, 1230-1255 포팅)
export default function JoinRoomForm({
  user,
  onNeedLogin,
  initialCode = '',
}: {
  user: CurrentUser | null;
  onNeedLogin: () => void;
  initialCode?: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const sb = getSupabaseBrowserClient();

  useEffect(() => {
    if (initialCode) setCode(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  async function joinGuest() {
    if (!user) {
      onNeedLogin();
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) {
      alert('전달받으신 셀렉 룸 코드를 입력해 주세요.');
      return;
    }
    const { data: project, error: findErr } = await sb!.from('projects').select('id').eq('room_code', trimmed).maybeSingle();
    if (findErr || !project) {
      alert('해당 룸 코드의 프로젝트를 찾을 수 없습니다. 코드를 다시 확인해 주세요.');
      return;
    }

    // 이미 참여 중이어도 에러 없이 넘어가도록 멤버십 존재 여부만 보장
    const {
      data: { user: authUser },
    } = await sb!.auth.getUser();
    await sb!.from('project_members').upsert({ project_id: project.id, user_id: authUser!.id, role: 'guest' }, { onConflict: 'project_id,user_id', ignoreDuplicates: true });

    router.push(`/room?mode=guest&project=${encodeURIComponent(project.id)}`);
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-border bg-panel p-10 text-left shadow-md">
      <div>
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-light text-xl text-brand-primary">📱</div>
        <h3 className="mb-2.5 text-[22px] font-bold">참여 코드로 입장하기</h3>
        <p className="mb-8 text-sm text-text-muted">전달받은 셀렉 룸 코드를 입력하여 실시간 동시 셀렉에 참여합니다.</p>
      </div>
      <div className="flex flex-col gap-3">
        <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} placeholder="룸 코드 입력 (예: wps-7k9x)" className="input text-center" />
        <button onClick={joinGuest} className="rounded-md bg-text-main py-[15px] text-[15px] font-semibold text-white">
          셀렉 룸 입장
        </button>
      </div>
    </div>
  );
}
