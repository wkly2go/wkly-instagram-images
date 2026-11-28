-- API 에이전트 스킬 (2026-11-28 대표 지시 '인트라넷의 구성 에이전트에게 필요한 스킬과 플러그인을 찾아서 모두 설치해')
--  스킬 = 에이전트가 필요할 때만 읽는 작업 지침 묶음(SKILL.md + 참고 글). Claude Console 에 올려 두고 실행 때 세션에 붙인다.
--  스킬 글(회사 작업 방식)은 공개 저장소에 두지 않고 운영 DB private 구역에만 둔다.
create table if not exists private.api_agent_skill_files (
  skill text not null,
  path text not null,
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (skill, path)
);

create table if not exists public.api_agent_skills (
  name text primary key,
  description text not null default '',
  console_skill_id text,
  console_version text,
  content_hash text,
  bytes integer not null default 0,
  files integer not null default 0,
  installed_at timestamptz,
  note text
);
alter table public.api_agent_skills enable row level security;
drop policy if exists api_agent_skills_admin_read on public.api_agent_skills;
create policy api_agent_skills_admin_read on public.api_agent_skills for select to authenticated using (public.is_admin());
revoke all on public.api_agent_skills from anon;

alter table public.api_agents add column if not exists skills text[] not null default '{}';

-- 설치 함수(api-agents-provision · service_role)만 스킬 글을 읽는다
create or replace function public.api_agent_skill_files()
returns table (skill text, path text, content text)
language sql security definer set search_path = '' as $$
  select f.skill, f.path, f.content from private.api_agent_skill_files f order by f.skill, f.path
$$;
revoke all on function public.api_agent_skill_files() from public, anon, authenticated;
grant execute on function public.api_agent_skill_files() to service_role;
