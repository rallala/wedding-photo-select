-- PicSelec 프로젝트(셀렉룸) 영속화 스키마
-- Supabase 대시보드 → SQL Editor 에서 실행하세요. (이전에 구버전을 이미 실행했어도 다시 그대로 실행하면 됩니다 - 멱등하게 작성됨)
--
-- 개념:
--   projects        : 호스트 계정 하나당 최대 5개까지 유지되는 "프로젝트"(이름 있음). 프로젝트 하나 = 폴더 하나로 고정.
--                      6번째를 만들면 가장 오래된 프로젝트가 자동으로 삭제됩니다(트리거).
--   project_members : 게스트가 room_code로 참여하면 생기는 멤버십 행.
--   project_state    : 선택/노트/별점 데이터. 한 프로젝트당 한 행(JSONB), 갱신될 때마다 Realtime으로 전파됩니다.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '이름 없는 프로젝트',
  folder_name text not null default '', -- 첫 폴더 선택 시 채워지고, 이후 고정(같은 프로젝트=같은 폴더)
  room_code text not null unique,
  created_at timestamptz not null default now()
);

-- 구버전(스키마 초판)을 이미 실행한 경우를 위한 마이그레이션
alter table public.projects add column if not exists title text not null default '이름 없는 프로젝트';
alter table public.projects alter column folder_name drop not null;
alter table public.projects alter column folder_name set default '';
alter table public.projects drop constraint if exists projects_host_id_folder_name_key;

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
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_state enable row level security;

-- projects: title/room_code에 민감정보가 없어서 로그인한 사람 누구나 조회 가능(코드로 찾아 참여하는 흐름에 필요).
-- 생성/수정은 본인(host_id) 소유 행만.
drop policy if exists "projects readable by authenticated" on public.projects;
create policy "projects readable by authenticated" on public.projects
  for select to authenticated using (true);

drop policy if exists "host creates own project" on public.projects;
create policy "host creates own project" on public.projects
  for insert to authenticated with check (host_id = auth.uid());

drop policy if exists "host updates own project" on public.projects;
create policy "host updates own project" on public.projects
  for update to authenticated using (host_id = auth.uid());

-- 잘못된 폴더로 고정돼버린 프로젝트를 되돌릴 방법이 없었던 문제 대응: 호스트가 자기 프로젝트를
-- 삭제하고 새로 만들 수 있게 함 (project_members/project_state는 on delete cascade로 함께 삭제됨).
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
