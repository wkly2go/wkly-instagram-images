-- 프로젝트 상태 '기획' → '문의' (2026-11-19 대표 지시 '기획을 문의로 변경해' · 상태 이름 전체 변경으로 확인받음)
-- 순서: 상담협의 → 문의 → 진행 → NIC → 완료 · 보류. '문의'는 예전 '기획'과 같은 뜻(열린 프로젝트 · 대화방 유지).
-- 예전 화면 · AI 팀원(agent-chat) · 외부 스크립트가 '기획'을 보내도 저장되도록, 넣기 · 고치기 전에 '기획'을 '문의'로 바꾸는 트리거를 둔다.
alter table public.projects drop constraint if exists projects_status_check;
update public.projects set status = '문의' where status = '기획';
alter table public.projects add constraint projects_status_check
  check (status = any (array['상담협의', '문의', '진행', 'NIC', '완료', '보류']));
alter table public.projects alter column status set default '문의';

create or replace function private.project_status_alias() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = '기획' then new.status := '문의'; end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_status_alias' and tgrelid = 'public.projects'::regclass) then
    create trigger projects_status_alias before insert or update of status on public.projects
      for each row execute function private.project_status_alias();
  end if;
end $$;

-- 상태를 보는 서버 함수 4개(agent_snapshot · agent_finance_snapshot · project_room_sync · mail_link): '기획' 자리를 '문의'로
-- 본문은 그대로 두고 그 부분만 바꿔 같은 이름 · 같은 인자로 다시 만든다(지우지 않음)
do $$
declare r record; def text; n int := 0;
begin
  for r in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid = p.pronamespace
           where (s.nspname, p.proname) in (('public', 'agent_snapshot'), ('public', 'agent_finance_snapshot'), ('private', 'project_room_sync'), ('private', 'mail_link'))
  loop
    def := pg_catalog.pg_get_functiondef(r.oid);
    def := replace(replace(replace(def, $q$in ('기획', '진행')$q$, $q$in ('문의', '진행')$q$), $q$('상담협의', '기획', '진행')$q$, $q$('상담협의', '문의', '진행')$q$), $q$('진행', '기획', 'NIC')$q$, $q$('진행', '문의', 'NIC')$q$);
    def := replace(def, $q$array['진행', '기획', '보류', '완료']$q$, $q$array['진행', '문의', '보류', '완료']$q$); -- agent_finance_snapshot 정렬 순서
    execute def;
    n := n + 1;
  end loop;
  if n < 4 then raise notice 'project status functions updated: %', n; end if;
end $$;
