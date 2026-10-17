-- WKLY ERP 0032: AI 팀원을 맡은 사람 관리자 (AI팀 › 조직도 · 관리자)
--   관리자만 지정 (profiles_update_admin 정책). 부서는 departments.member_ids 로 관리(관리 › 팀원 관리 · 부서 칸)
alter table public.profiles add column if not exists manager_id uuid references public.profiles (id) on delete set null;
comment on column public.profiles.manager_id is 'AI 팀원을 맡은 사람 관리자';
