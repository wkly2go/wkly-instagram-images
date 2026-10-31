-- [적용 대기] 대표 확인 후 운영 DB에 적용 · 적용하면 supabase/migrations 로 옮김
-- 0070 메일 · 에이전트가 모은 자료를 프로젝트와 연결 (대표 지시 2026-10-31 "수집한 자료를 모두 프로젝트와 연동해서 반영")
--   - agent_reports.project_ids: 제목 · 요약 · 본문에 연번(AR2609-03) 또는 프로젝트 이름이 나오면 그 프로젝트
--   - 새로 쌓이는 보고도 자동 연결(트리거), 지금까지 쌓인 것도 한 번에 연결
--   - 연결 안 된 업무 일지 · 할 일도 연번 · 이름이 분명히 하나만 맞으면 연결
alter table public.agent_reports add column if not exists project_ids uuid[] not null default '{}';
create index if not exists agent_reports_project_ids on public.agent_reports using gin (project_ids);

create or replace function public.match_projects(p_text text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct p.id), '{}')
  from public.projects p
  where p_text is not null and (
    (p.code is not null and length(p.code) >= 7 and p_text ilike '%' || p.code || '%')
    or (length(replace(p.name, ' ', '')) >= 4 and replace(p_text, ' ', '') ilike '%' || replace(p.name, ' ', '') || '%')
  )
$$;
grant execute on function public.match_projects(text) to authenticated;

create or replace function private.report_link() returns trigger language plpgsql set search_path = '' as $$
begin
  new.project_ids := (select array(select distinct unnest(coalesce(new.project_ids, '{}') || public.match_projects(concat_ws(' ', new.title, new.summary, left(new.body, 20000))))));
  return new;
end $$;
create or replace trigger agent_reports_link before insert or update of title, summary, body on public.agent_reports for each row execute function private.report_link();

update public.agent_reports set project_ids = public.match_projects(concat_ws(' ', title, summary, left(body, 20000)));

-- 연결 안 된 업무 일지 · 할 일: 딱 하나의 프로젝트만 맞을 때
update public.work_logs w set project_id = (public.match_projects(w.content))[1]
where w.project_id is null and cardinality(public.match_projects(w.content)) = 1;
update public.tasks t set project_id = (public.match_projects(concat_ws(' ', t.title, t.memo)))[1]
where t.project_id is null and cardinality(public.match_projects(concat_ws(' ', t.title, t.memo))) = 1;
