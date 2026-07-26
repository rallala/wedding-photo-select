'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';
import type { CurrentUser } from '@/lib/authHelpers';

type ProjectRow = { id: string; title: string; folder_name: string | null; room_code: string; created_at: string };

// 프로젝트 생성/목록(계정당 최대 5개)/삭제 (wedding-photo-select/landing.html:497-513, 845-908 포팅)
export default function ProjectList({ user, onNeedLogin }: { user: CurrentUser | null; onNeedLogin: () => void }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [title, setTitle] = useState('');
  const sb = getSupabaseBrowserClient();

  async function refresh() {
    if (!user || !sb) {
      setProjects([]);
      return;
    }
    const { data, error } = await sb
      .from('projects')
      .select('id, title, folder_name, room_code, created_at')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) {
      console.error('프로젝트 목록 조회 실패:', error.message);
      return;
    }
    setProjects((data as ProjectRow[]) || []);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function createProject() {
    if (!user) {
      onNeedLogin();
      return;
    }
    if (!sb) {
      alert('Supabase 연동 키가 설정되지 않았습니다.');
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      alert('프로젝트 이름을 입력해 주세요.');
      return;
    }
    const roomCode = 'wps-' + Math.random().toString(36).slice(2, 8);
    const { data, error } = await sb.from('projects').insert({ host_id: user.id, title: trimmed, room_code: roomCode }).select().single();
    if (error) {
      alert('프로젝트 생성에 실패했습니다: ' + error.message);
      return;
    }
    setTitle('');
    router.push(`/room?mode=host&project=${encodeURIComponent(data.id)}`);
  }

  // 잘못된 폴더로 고정돼버린 프로젝트를 되돌릴 방법이 없어서, 삭제 후 새로 만들 수 있게 함
  // (project_members/project_state/storage는 on delete cascade/트리거로 함께 삭제됨)
  async function deleteProject(id: string, projectTitle: string) {
    if (!confirm(`"${projectTitle}" 프로젝트를 삭제하시겠습니까?\n연결된 폴더 지정, 선택/메모/별점 내역이 모두 사라지며 되돌릴 수 없습니다.`)) return;
    const { error } = await sb!.from('projects').delete().eq('id', id);
    if (error) {
      alert('삭제에 실패했습니다: ' + error.message);
      return;
    }
    refresh();
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-border bg-panel p-10 text-left shadow-md">
      <div>
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-light text-xl text-brand-primary">📁</div>
        <h3 className="mb-2.5 text-[22px] font-bold">내 PC 사진으로 셀렉하기</h3>
        <p className="mb-8 text-sm text-text-muted">컴퓨터에 저장된 원본 사진 폴더를 열고 룸을 개설합니다. (프로그램 다운로드 없음)</p>
      </div>

      {user && (
        <div className="mb-3 flex flex-col gap-2">
          {projects.length === 0 ? (
            <p className="m-0 text-xs text-text-muted">아직 만든 프로젝트가 없어요. 아래에서 새로 만들어 보세요.</p>
          ) : (
            projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-panel p-2">
                <div className="overflow-hidden text-left">
                  <div className="truncate text-[13px] font-semibold">{p.title}</div>
                  <div className="text-[11px] text-text-muted">{p.folder_name ? `📂 ${p.folder_name}` : '폴더 미선택'} · 코드 {p.room_code}</div>
                </div>
                <div className="flex flex-shrink-0 gap-1.5">
                  <button className="tbtn" onClick={() => router.push(`/room?mode=host&project=${encodeURIComponent(p.id)}`)}>
                    열기
                  </button>
                  <button className="rounded-md border border-border px-2.5 py-1.5 text-xs text-red-500" onClick={() => deleteProject(p.id, p.title)}>
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={40}
          placeholder="새 프로젝트 이름 (예: 2026 제주도 여행)"
          className="input text-center"
        />
        <button onClick={createProject} className="tbtn primary justify-center py-4 text-[15px]">
          새 프로젝트 만들기
        </button>
      </div>
    </div>
  );
}
