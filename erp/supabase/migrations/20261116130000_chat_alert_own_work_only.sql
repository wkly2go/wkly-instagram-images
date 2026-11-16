-- 자기 업무에만 알림 (대표 지시 2026-11-16): 모두가 보는 방(# 전체 등)의 기본 알림을 '멘션만'으로
--  - 1:1 · 초대된 대화방: 전체 / 프로젝트 방: 담당 · 참여자만 전체, 나머지는 멘션만 (그대로)
--  - 모두가 보는 방: 내 이름이 불린 글만 알림 (예전에는 모든 글이 모두에게 울림)
--  - 방마다 직접 고른 알림 단계(chat_room_prefs)는 그대로 우선
create or replace function public.chat_level(p_user uuid, p_room uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select level from public.chat_room_prefs where user_id = p_user and room_id = p_room),
    (select case
       when r.members is not null then 'all'
       when r.project_id is null then 'mention'
       when exists (select 1 from public.projects p where p.id = r.project_id and p.owner_id = p_user)
         or exists (select 1 from public.project_members m where m.project_id = r.project_id and m.profile_id = p_user) then 'all'
       else 'mention' end
     from public.chat_rooms r where r.id = p_room),
    'all')
$function$;
