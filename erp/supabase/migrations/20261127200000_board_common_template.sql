-- 화이트보드 공통 사용 (대표 지시 2026-11-27 '모든 프로젝트에서 공통으로 사용가능하게' → 공통 화이트보드 · 보드 복사 · 템플릿)
-- ① 프로젝트에 묶이지 않은 공통 보드: project_id 를 비워 둘 수 있게 (프로젝트 보드는 예전 그대로)
-- ② 템플릿: is_template = true 인 보드(프로젝트 없음). 새 보드를 템플릿에서 시작 · 아무 보드나 템플릿으로 저장
-- ③ 복사: board_copy(원본, 대상 프로젝트(없으면 공통), 이름, 템플릿 여부) — 그림 · 사진 경로를 그대로 복사(사진은 지우지 않으므로 원본 경로를 함께 씀)
-- 권한은 예전과 같음(읽기 · 만들기 · 고치기 활성 팀원 · 지우기 만든 사람 · 관리자 · anon 없음)

alter table public.project_boards alter column project_id drop not null;
alter table public.project_boards add column if not exists is_template boolean not null default false;
create index if not exists project_boards_common_idx on public.project_boards (is_template, updated_at desc) where project_id is null;

create or replace function public.board_copy(p_src uuid, p_project uuid, p_title text, p_template boolean default false)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_scene jsonb;
begin
  select scene into v_scene from public.project_boards where id = p_src;
  if not found then raise exception '복사할 보드를 찾을 수 없습니다.' using errcode = '22023'; end if;
  insert into public.project_boards (project_id, title, scene, is_template, created_by, updated_by)
  values (case when p_template then null else p_project end, left(coalesce(nullif(btrim(p_title), ''), '새 보드'), 60), v_scene, coalesce(p_template, false), auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.board_copy(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.board_copy(uuid, uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
