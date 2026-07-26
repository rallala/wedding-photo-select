-- PicSelec (Next.js 재작성판) 프로젝트(셀렉룸) 영속화 스키마
-- Supabase 대시보드 → SQL Editor 에서 실행하세요. (멱등하게 작성됨 - 다시 실행해도 안전)
--
-- 개념:
--   projects        : 호스트 계정 하나당 최대 5개까지 유지되는 "프로젝트"(이름 있음). 프로젝트 하나 = 폴더 하나로 고정.
--                      6번째를 만들면 가장 오래된 프로젝트가 자동으로 삭제됩니다(트리거).
--   project_members : 게스트가 room_code로 참여하면 생기는 멤버십 행.
--   project_state    : 선택/노트/별점/사진 매니페스트. 한 프로젝트당 한 행(JSONB), 갱신될 때마다 Realtime으로 전파됩니다.
--
-- 사진 전송 아키텍처(2026-07 재설계):
--   브라우징용 썸네일(항상 필요) → Supabase Storage(project-photos 버킷)에 업로드, project_state.photos에 매니페스트 기록.
--   최종 확정된 원본(소수, 1회성) → WebRTC P2P(STUN-only)로 그 순간 접속 중인 참여자에게만 전달, DB에는 안 남음.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '이름 없는 프로젝트',
  folder_name text not null default '', -- 첫 폴더 선택 시 채워지고, 이후 고정(같은 프로젝트=같은 폴더)
  room_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'guest',
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_state (
  project_id uuid primary key references public.projects(id) on delete cascade,
  selections jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  ratings jsonb not null default '{}'::jsonb,
  users jsonb not null default '[{"id":"p1","name":"참여자1","color":"#3B82F6"},{"id":"p2","name":"참여자2","color":"#EC4899"}]'::jsonb,
  photos jsonb not null default '[]'::jsonb, -- 썸네일 매니페스트: [{id,name,folder,size,mtime,path}]
  updated_at timestamptz not null default now()
);

-- 구버전(photos 컬럼 추가 이전, allow_original_download 있던 버전)을 이미 실행한 경우를 위한 마이그레이션
alter table public.project_state add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.projects drop column if exists allow_original_download;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_state enable row level security;

-- projects: title/room_code에 민감정보가 없어서 로그인한 사람 누구나 조회 가능(코드로 찾아 참여하는 흐름에 필요).
-- 생성/수정/삭제는 본인(host_id) 소유 행만.
drop policy if exists "projects readable by authenticated" on public.projects;
create policy "projects readable by authenticated" on public.projects
  for select to authenticated using (true);

drop policy if exists "host creates own project" on public.projects;
create policy "host creates own project" on public.projects
  for insert to authenticated with check (host_id = auth.uid());

drop policy if exists "host updates own project" on public.projects;
create policy "host updates own project" on public.projects
  for update to authenticated using (host_id = auth.uid());

drop policy if exists "host deletes own project" on public.projects;
create policy "host deletes own project" on public.projects
  for delete to authenticated using (host_id = auth.uid());

-- project_members: 본인 멤버십 또는 내가 호스트인 프로젝트의 멤버 목록만 조회. 본인 자리로만 참여 가능.
drop policy if exists "read relevant memberships" on public.project_members;
create policy "read relevant memberships" on public.project_members
  for select to authenticated using (
    user_id = auth.uid()
    or project_id in (select id from public.projects where host_id = auth.uid())
  );

drop policy if exists "join project as self" on public.project_members;
create policy "join project as self" on public.project_members
  for insert to authenticated with check (user_id = auth.uid());

-- project_state: 호스트 또는 멤버만 읽기/쓰기 가능 (선택 내역은 참여자 외 비공개)
drop policy if exists "members read state" on public.project_state;
create policy "members read state" on public.project_state
  for select to authenticated using (
    project_id in (select id from public.projects where host_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "members write state" on public.project_state;
create policy "members write state" on public.project_state
  for all to authenticated using (
    project_id in (select id from public.projects where host_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  ) with check (
    project_id in (select id from public.projects where host_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

-- project_state에 대한 Realtime(postgres_changes) 전파를 켜기 위해 필요 (이미 추가돼 있으면 에러 없이 무시됨)
do $$
begin
  alter publication supabase_realtime add table public.project_state;
exception when duplicate_object then null;
end $$;

-- 계정당 프로젝트 최대 5개, 초과 시 가장 오래된 것부터 자동 삭제
create or replace function public.enforce_project_limit() returns trigger as $$
begin
  delete from public.projects
  where host_id = new.host_id
    and id not in (
      select id from public.projects
      where host_id = new.host_id
      order by created_at desc
      limit 5
    );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_enforce_project_limit on public.projects;
create trigger trg_enforce_project_limit
  after insert on public.projects
  for each row execute function public.enforce_project_limit();

-- ---------- Storage: 썸네일 전용 private 버킷 ----------
insert into storage.buckets (id, name, public)
values ('project-photos', 'project-photos', false)
on conflict (id) do nothing;

-- 경로 규칙: {project_id}/{hash}.webp — storage.foldername(name)[1]로 project_id를 추출해 권한 체크
drop policy if exists "project members read thumbnails" on storage.objects;
create policy "project members read thumbnails" on storage.objects
  for select to authenticated using (
    bucket_id = 'project-photos' and (
      exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[1] and p.host_id = auth.uid())
      or exists (select 1 from public.project_members m where m.project_id::text = (storage.foldername(name))[1] and m.user_id = auth.uid())
    )
  );

drop policy if exists "host uploads thumbnails" on storage.objects;
create policy "host uploads thumbnails" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'project-photos' and
    exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[1] and p.host_id = auth.uid())
  );

drop policy if exists "host updates thumbnails" on storage.objects;
create policy "host updates thumbnails" on storage.objects
  for update to authenticated using (
    bucket_id = 'project-photos' and
    exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[1] and p.host_id = auth.uid())
  );

drop policy if exists "host deletes thumbnails" on storage.objects;
create policy "host deletes thumbnails" on storage.objects
  for delete to authenticated using (
    bucket_id = 'project-photos' and
    exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[1] and p.host_id = auth.uid())
  );

-- 프로젝트가 삭제되면(호스트 직접 삭제든, 5개 초과 자동삭제든) 남은 썸네일도 함께 정리
create or replace function public.cleanup_project_storage() returns trigger as $$
begin
  delete from storage.objects
  where bucket_id = 'project-photos'
    and (storage.foldername(name))[1] = old.id::text;
  return old;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_cleanup_project_storage on public.projects;
create trigger trg_cleanup_project_storage
  before delete on public.projects
  for each row execute function public.cleanup_project_storage();
