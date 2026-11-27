-- 1:1 대화(비서 대화 포함)는 프로젝트 '대화 모아 보기'에 자동으로 붙이지 않음 (대표 지시 2026-11-27 '이거 뭐야? 모두 지워')
-- 비서에게 보낸 화면 정보 · 비서 답에 연번(AR2611-12 등)이 들어 있어 트리거가 1:1 대화 764통을 프로젝트에 붙여 왔음.
-- 자동으로 붙은 것만 떼고(손으로 붙인 것은 그대로) · 글 자체는 지우지 않음.

delete from public.chat_message_projects t
using public.chat_messages m, public.chat_rooms r
where t.message_id = m.id and r.id = m.room_id and t.auto and r.name like 'dm:%';

create or replace function private.chat_message_auto_tag()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.content is null or new.content !~ '[A-Za-z]{2}\d{4}-\d{2}' then return new; end if;
  if exists (select 1 from public.chat_rooms r where r.id = new.room_id and (r.project_id is not null or r.name like 'dm:%')) then return new; end if;
  insert into public.chat_message_projects (message_id, project_id, tagged_by, auto)
  select new.id, p.id, new.user_id, true
    from public.projects p
   where p.code is not null and p.code <> ''
     and p.code in (select upper(m[1]) from regexp_matches(new.content, '([A-Za-z]{2}\d{4}-\d{2})', 'g') m)
  on conflict do nothing;
  return new;
exception when others then
  return new;
end $function$;
