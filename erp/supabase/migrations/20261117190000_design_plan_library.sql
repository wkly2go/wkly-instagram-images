-- 설계 작업 환경 개선 (2026-11-17 대표 지시 '마감재와 각종 기구들을 저장해서 바로 사용할 수 있게' · '제안서는 피그마와 같은 환경에 houzz 의 스펙 기능을 합쳐' · '피그마처럼 협업')
--  1) design.plan_library   — 회사가 저장한 마감재 · 기구 (평면 · 3D 작업 공간의 라이브러리. 기본 제공 목록은 화면 코드 lib/designLibrary.ts)
--  2) design.proposal_boards — 프로젝트별 제안 보드 (페이지 · 글 · 스펙 카드 · 댓글. 형식은 lib/designBoard.ts)
--  3) 같이 보기(접속 표시 · '방금 고쳤습니다' 알림)용 비공개 방송 정책 — 주제 'design-plan:<프로젝트 id>[:board]' 는 팀원만 듣고 보낸다
-- 설계 구역(design)에만 더한다. 기존 표 · 함수는 바꾸지 않는다. 작업 처리기(design_worker)에는 권한을 주지 않는다(화면 전용).
begin;

create table if not exists design.plan_library (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('finish', 'fixture')),
  group_name text not null default '내 저장' check (char_length(group_name) between 1 and 40),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 8000),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists plan_library_kind on design.plan_library (kind, created_at desc);
alter table design.plan_library enable row level security;
revoke all on design.plan_library from public, anon;
grant select, insert, update, delete on design.plan_library to authenticated;
grant all on design.plan_library to service_role;
drop policy if exists plan_library_read on design.plan_library;
create policy plan_library_read on design.plan_library for select to authenticated
  using ((select public.is_active_member()));
drop policy if exists plan_library_insert on design.plan_library;
create policy plan_library_insert on design.plan_library for insert to authenticated
  with check ((select public.is_active_member()) and created_by = (select auth.uid()));
drop policy if exists plan_library_update on design.plan_library;
create policy plan_library_update on design.plan_library for update to authenticated
  using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
drop policy if exists plan_library_delete on design.plan_library;
create policy plan_library_delete on design.plan_library for delete to authenticated
  using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
create or replace view public.design_plan_library with (security_invoker = true) as select * from design.plan_library;
revoke all on public.design_plan_library from public, anon;
grant select, insert, update, delete on public.design_plan_library to authenticated;
grant all on public.design_plan_library to service_role;

create table if not exists design.proposal_boards (
  project_id uuid primary key references design.projects(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 1500000),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table design.proposal_boards enable row level security;
revoke all on design.proposal_boards from public, anon;
grant select, insert, update, delete on design.proposal_boards to authenticated;
grant all on design.proposal_boards to service_role;
drop policy if exists proposal_boards_member on design.proposal_boards;
create policy proposal_boards_member on design.proposal_boards for all to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
-- 누가 · 언제 고쳤는지는 서버가 적는다 (화면이 보낸 값은 쓰지 않음)
create or replace function design.proposal_board_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists proposal_boards_touch on design.proposal_boards;
create trigger proposal_boards_touch before insert or update on design.proposal_boards
  for each row execute function design.proposal_board_touch();
create or replace view public.design_proposal_boards with (security_invoker = true) as select * from design.proposal_boards;
revoke all on public.design_proposal_boards from public, anon;
grant select, insert, update, delete on public.design_proposal_boards to authenticated;
grant all on public.design_proposal_boards to service_role;

-- 같이 보기: 비공개 방송 · 접속 표시. 팀원만 듣고(select) 보낸다(insert). 다른 주제의 정책은 건드리지 않는다.
drop policy if exists design_plan_live_read on realtime.messages;
create policy design_plan_live_read on realtime.messages for select to authenticated
  using (extension in ('broadcast', 'presence') and realtime.topic() like 'design-plan:%' and (select public.is_active_member()));
drop policy if exists design_plan_live_write on realtime.messages;
create policy design_plan_live_write on realtime.messages for insert to authenticated
  with check (extension in ('broadcast', 'presence') and realtime.topic() like 'design-plan:%' and (select public.is_active_member()));

notify pgrst, 'reload schema';
commit;
