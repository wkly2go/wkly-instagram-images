-- 프로젝트 '대화' 한 줄 모으기 (2026-11-19 대표 지시 '개선해' · 기획 '메신저 협업 단순화' 4번 '슬랙 · 카톡 · 외부 협업방 · 메일을 한 줄로')
-- 프로젝트 하나에 붙은 대화를 출처와 함께 시간순으로 돌려준다. 읽기만 · 표를 바꾸지 않음.
-- security invoker(기본): 부르는 사람의 권한(RLS)이 그대로 적용된다 — 들어갈 수 없는 대화방 · 외부 협업방 글은 나오지 않음.
create or replace function public.project_timeline(p_project uuid, p_before timestamptz default null, p_limit int default 60)
returns table (source text, at timestamptz, who text, body text, ref text)
language sql stable set search_path = '' as $$
  with lim as (select least(greatest(coalesce(p_limit, 60), 1), 200) n, coalesce(p_before, 'infinity'::timestamptz) b)
  select * from (
    (select '인트라넷'::text, m.created_at, coalesce(pr.name, ''), left(m.content, 1200), 'chat:' || m.room_id || ':' || m.id
       from public.chat_messages m join public.chat_rooms r on r.id = m.room_id left join public.profiles pr on pr.id = m.user_id, lim
      where r.project_id = p_project and m.created_at < lim.b order by m.created_at desc limit (select n from lim))
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
