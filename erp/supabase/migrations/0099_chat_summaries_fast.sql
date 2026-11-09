-- 채팅 방 목록 빠르게 (대표 지시 2026-11-09 "채팅이 좀 느려")
--   chat_room_summaries_v3 가 평균 170ms (메시지 한 줄마다 권한 검사 · 방마다 같은 일을 세 번) → 권한은 방 단위로 한 번만
--   결과 열 · 의미는 그대로. 보이는 방 = 활성 팀원 + (공개 방이거나 내가 멤버인 방) — chat_rooms 읽기 정책과 같음
create or replace function public.chat_room_summaries_v3()
returns table (id uuid, name text, description text, project_id uuid, is_archived boolean, created_by uuid, created_at timestamptz,
  members uuid[], last_content text, last_at timestamptz, last_user_id uuid, unread integer, mentions integer, level text, project_status text)
language sql stable security definer set search_path = '' as $$
  with me as (
    select auth.uid() as uid,
           '@' || coalesce((select btrim(p.name) from public.profiles p where p.id = auth.uid()), '') as tag,
           public.is_active_member() as ok
  ),
  rooms as (
    select r.*, cr.last_read_at
    from public.chat_rooms r
    cross join me
    left join public.chat_reads cr on cr.room_id = r.id and cr.user_id = me.uid
    where me.ok and not r.is_archived and (r.members is null or me.uid = any (r.members))
  ),
  cnt as (
    select m.room_id,
           count(*)::int as unread,
           count(*) filter (where me.tag <> '@' and strpos(m.content, me.tag) > 0)::int as mentions
    from rooms r
    cross join me
    join public.chat_messages m on m.room_id = r.id and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    where m.user_id is distinct from me.uid
    group by m.room_id
  )
  select r.id, r.name, r.description, r.project_id, r.is_archived, r.created_by, r.created_at, r.members,
         lm.content, lm.created_at, lm.user_id,
         coalesce(c.unread, 0), coalesce(c.mentions, 0),
         coalesce(pf.level, case
           when r.members is not null or r.project_id is null then 'all'
           when pr.owner_id = me.uid or exists (select 1 from public.project_members pm where pm.project_id = r.project_id and pm.profile_id = me.uid) then 'all'
           else 'mention' end),
         pr.status
  from rooms r
  cross join me
  left join cnt c on c.room_id = r.id
  left join public.chat_room_prefs pf on pf.room_id = r.id and pf.user_id = me.uid
  left join public.projects pr on pr.id = r.project_id
  left join lateral (select m.content, m.created_at, m.user_id from public.chat_messages m where m.room_id = r.id order by m.created_at desc, m.id desc limit 1) lm on true
  order by coalesce(lm.created_at, r.created_at) desc
$$;
revoke all on function public.chat_room_summaries_v3() from public, anon;
grant execute on function public.chat_room_summaries_v3() to authenticated;
