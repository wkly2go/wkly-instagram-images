-- 2026-11-20 메신저 협업 2단계 (기획 '메신저 협업 단순화 · 프로젝트 연결' 2~4주차 · 대표 지시 '개선해' → '계속 진행해')
-- ① 1:1 · 그룹 대화방의 글을 프로젝트에 붙이기: 글 옆 '프로젝트에 붙이기' 단추 → chat_message_tag
-- ② 자동 태그: 프로젝트방이 아닌 곳의 글에 프로젝트 연번(예: AR2611-06 · TW2610-04)이 적혀 있으면 그 프로젝트에 저절로 붙음
-- ③ 프로젝트 화면 '대화 모아 보기'(project_timeline)에 붙인 글도 나옴 (출처 '인트라넷' · 대화방 이름 표시)
-- 붙이기는 글을 볼 수 있는 사람만(대화방 RLS 그대로) · 떼기는 붙인 사람 · 관리자 · 자동 태그는 그 방 사람 누구나.

create table if not exists public.chat_message_projects (
  message_id bigint not null references public.chat_messages (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  tagged_by uuid references public.profiles (id) on delete set null,
  auto boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (message_id, project_id)
);
create index if not exists chat_message_projects_project_idx on public.chat_message_projects (project_id, created_at desc);
alter table public.chat_message_projects enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_message_projects' and policyname = 'chat_message_projects_select') then
    -- 글을 볼 수 있는 사람만 (chat_messages 의 RLS 가 안쪽 조회에 그대로 걸림)
    create policy chat_message_projects_select on public.chat_message_projects for select
      using ((select public.is_active_member()) and exists (select 1 from public.chat_messages m where m.id = message_id));
  end if;
end $$;
revoke all on table public.chat_message_projects from anon;
grant select on table public.chat_message_projects to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_message_projects' and policyname = 'chat_message_projects_insert') then
    -- 손으로 붙이기: 본인 이름으로 · 볼 수 있는 글에만
    create policy chat_message_projects_insert on public.chat_message_projects for insert
      with check ((select public.is_active_member()) and tagged_by = (select auth.uid()) and not auto
        and exists (select 1 from public.chat_messages m where m.id = message_id));
    -- 떼기: 자동 태그 · 내가 붙인 것 · 관리자
    create policy chat_message_projects_delete on public.chat_message_projects for delete
      using ((select public.is_active_member()) and exists (select 1 from public.chat_messages m where m.id = message_id)
        and (auto or tagged_by = (select auth.uid()) or (select public.is_admin())));
  end if;
end $$;
grant insert, delete on table public.chat_message_projects to authenticated;

-- 붙이기 · 떼기 (부르는 사람 권한 그대로 · 프로젝트방 글은 이미 그 프로젝트 것이라 그냥 둠)
create or replace function public.chat_message_tag(p_message bigint, p_project uuid, p_on boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_room_project uuid;
begin
  select r.project_id into v_room_project from public.chat_messages m join public.chat_rooms r on r.id = m.room_id where m.id = p_message;
  if not found then raise exception '글을 찾을 수 없습니다.' using errcode = '22023'; end if;
  if p_on then
    if v_room_project = p_project then return jsonb_build_object('ok', true, 'already', true); end if;
    insert into public.chat_message_projects (message_id, project_id, tagged_by, auto)
    values (p_message, p_project, auth.uid(), false) on conflict do nothing;
  else
    delete from public.chat_message_projects where message_id = p_message and project_id = p_project;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.chat_message_tag(bigint, uuid, boolean) from public, anon;
grant execute on function public.chat_message_tag(bigint, uuid, boolean) to authenticated;

-- 자동 태그: 프로젝트방이 아닌 대화방 글에 적힌 연번 (AR · TW · IR 등 영문 2글자 + 4자리 + - + 2자리)
create or replace function private.chat_message_auto_tag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.content is null or new.content !~ '[A-Za-z]{2}\d{4}-\d{2}' then return new; end if;
  if exists (select 1 from public.chat_rooms r where r.id = new.room_id and r.project_id is not null) then return new; end if;
  insert into public.chat_message_projects (message_id, project_id, tagged_by, auto)
  select new.id, p.id, new.user_id, true
    from public.projects p
   where p.code is not null and p.code <> ''
     and p.code in (select upper(m[1]) from regexp_matches(new.content, '([A-Za-z]{2}\d{4}-\d{2})', 'g') m)
  on conflict do nothing;
  return new;
exception when others then
  return new; -- 태그가 실패해도 글 저장은 막지 않음
end $$;
revoke all on function private.chat_message_auto_tag() from public, anon, authenticated;

create or replace trigger chat_messages_auto_tag after insert on public.chat_messages for each row execute function private.chat_message_auto_tag();

-- 프로젝트 '대화 모아 보기'에 붙인 글 추가 (시그니처 그대로)
create or replace function public.project_timeline(p_project uuid, p_before timestamptz default null, p_limit int default 60)
returns table (source text, at timestamptz, who text, body text, ref text)
language sql stable set search_path = '' as $$
  with lim as (select least(greatest(coalesce(p_limit, 60), 1), 200) n, coalesce(p_before, 'infinity'::timestamptz) b)
  select * from (
    (select '인트라넷'::text, m.created_at, coalesce(pr.name, ''), left(m.content, 1200), 'chat:' || m.room_id || ':' || m.id
       from public.chat_messages m join public.chat_rooms r on r.id = m.room_id left join public.profiles pr on pr.id = m.user_id, lim
      where r.project_id = p_project and m.created_at < lim.b order by m.created_at desc limit (select n from lim))
    union all
    (select '인트라넷'::text, m.created_at, coalesce(pr.name, '') || ' · ' || coalesce(nullif(r.name, ''), '대화방'), left(m.content, 1200), 'chat:' || m.room_id || ':' || m.id
       from public.chat_message_projects t join public.chat_messages m on m.id = t.message_id join public.chat_rooms r on r.id = m.room_id
       left join public.profiles pr on pr.id = m.user_id, lim
      where t.project_id = p_project and r.project_id is distinct from p_project and m.created_at < lim.b order by m.created_at desc limit (select n from lim))
    union all
    (select '슬랙', s.posted_at, s.user_name, left(s.text, 1200), 'slack:' || s.channel_name
       from public.slack_messages s, lim where s.project_id = p_project and s.posted_at < lim.b order by s.posted_at desc limit (select n from lim))
    union all
    (select '카톡', k.sent_at, k.sender, left(k.content, 1200), 'kakao:' || coalesce(k.import_id::text, '')
       from public.kakao_messages k, lim where k.project_id = p_project and k.sent_at < lim.b order by k.sent_at desc limit (select n from lim))
    union all
    (select '메일', mi.sent_at, coalesce(nullif(mi.from_name, ''), mi.from_addr, ''), left(concat_ws(' — ', nullif(mi.subject, ''), nullif(mi.snippet, '')), 1200), 'mail:' || mi.thread_id
       from public.mail_index mi, lim where p_project = any (mi.project_ids) and mi.sent_at < lim.b order by mi.sent_at desc limit (select n from lim))
    union all
    (select '협업방', cm.created_at, coalesce(g.name || coalesce(' · ' || g.org, ''), pr.name, ''), left(cm.body, 1200), 'collab:' || cm.room_id
       from public.collab_messages cm join public.collab_rooms cr on cr.id = cm.room_id
       left join public.collab_guests g on g.id = cm.guest_id left join public.profiles pr on pr.id = cm.user_id, lim
      where cr.project_id = p_project and cm.deleted_at is null and cm.created_at < lim.b order by cm.created_at desc limit (select n from lim))
  ) x (source, at, who, body, ref)
  where at is not null
  order by at desc
  limit (select n from lim)
$$;
revoke all on function public.project_timeline(uuid, timestamptz, int) from public, anon;
grant execute on function public.project_timeline(uuid, timestamptz, int) to authenticated;
notify pgrst, 'reload schema';
