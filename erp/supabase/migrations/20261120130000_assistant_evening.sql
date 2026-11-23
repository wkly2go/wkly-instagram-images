-- 2026-11-20 비서 저녁 정리 (기획 '메신저 협업 단순화' 2~4주차 마지막 · 대표 지시 '진행해')
-- 평일 18:23(KST) 사람 팀원마다 자기 비서 1:1 방에 '오늘 정리' 한 통: 오늘 끝낸 할 일 · 기한 지난 할 일 · 내일 할 일 · 오늘 업무 일지 여부 · 안 읽은 알림 수.
-- AI 를 부르지 않는 계산 글(비용 없음) · 비서가 보낸 글이라 agent-chat 이 다시 답하지 않음(agent_on_chat_message 가 AI 글은 건너뜀).
-- 적을 것이 하나도 없으면 보내지 않음. 같은 날 두 번 보내지 않음. 휴가인 사람은 건너뜀.

create or replace function private.assistant_evening_digest(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_tomorrow date := (now() at time zone 'Asia/Seoul')::date + case extract(isodow from (now() at time zone 'Asia/Seoul')::date)::int when 5 then 3 else 1 end;
  p record; v_agent uuid; v_key text; v_room uuid; v_body text;
  v_done text; v_late text; v_next text; v_logs int; v_unread int; v_late_n int; v_next_n int; v_done_n int;
  n_sent int := 0; n_skip int := 0;
begin
  for p in
    select pr.id, pr.name from public.profiles pr
     where pr.active and not pr.is_agent
       and exists (select 1 from public.ai_agents a where a.owner_id = pr.id and a.private)
  loop
    -- 휴가인 날은 건너뜀
    if exists (select 1 from public.leave_records l where l.profile_id = p.id and l.status = '승인' and v_today between l.start_date and l.end_date) then
      n_skip := n_skip + 1; continue;
    end if;
    select a.profile_id into v_agent from public.ai_agents a where a.owner_id = p.id and a.private order by a.created_at limit 1;
    v_key := least(p.id::text, v_agent::text) || ':' || greatest(p.id::text, v_agent::text);
    select r.id into v_room from public.chat_rooms r where r.dm_key = v_key;
    -- 오늘 이미 보냈으면 건너뜀
    if v_room is not null and exists (select 1 from public.chat_messages m where m.room_id = v_room and m.user_id = v_agent
        and m.content like '[오늘 정리]%' and (m.created_at at time zone 'Asia/Seoul')::date = v_today) then
      n_skip := n_skip + 1; continue;
    end if;

    select count(*), string_agg('- ' || t.title, E'\n' order by t.completed_at) filter (where rn <= 5) into v_done_n, v_done
      from (select t.*, row_number() over (order by t.completed_at) rn from public.tasks t
             where coalesce(t.assignee_id, t.created_by) = p.id and t.status = '완료'
               and (t.completed_at at time zone 'Asia/Seoul')::date = v_today) t;
    select count(*), string_agg('- ' || t.title || ' (' || to_char(t.due_date, 'MM.DD') || ')', E'\n' order by t.due_date) filter (where rn <= 5) into v_late_n, v_late
      from (select t.*, row_number() over (order by t.due_date) rn from public.tasks t
             where coalesce(t.assignee_id, t.created_by) = p.id and t.status <> '완료' and t.due_date < v_today) t;
    select count(*), string_agg('- ' || t.title, E'\n' order by t.due_date) filter (where rn <= 5) into v_next_n, v_next
      from (select t.*, row_number() over (order by t.due_date) rn from public.tasks t
             where coalesce(t.assignee_id, t.created_by) = p.id and t.status <> '완료'
               and (t.due_date = v_tomorrow or t.start_date = v_tomorrow)) t;
    select count(*) into v_logs from public.work_logs w where w.user_id = p.id and w.log_date = v_today;
    select count(*) into v_unread from public.notifications nn where nn.user_id = p.id and nn.read_at is null and nn.created_at > now() - interval '7 days';

    if v_done_n = 0 and v_late_n = 0 and v_next_n = 0 and v_logs > 0 and v_unread = 0 then
      n_skip := n_skip + 1; continue;
    end if;

    v_body := '[오늘 정리] ' || to_char(v_today, 'MM.DD') || ' · ' || p.name || '님' || E'\n'
      || case when v_done_n > 0 then E'\n오늘 끝낸 일 ' || v_done_n || '건' || E'\n' || v_done || case when v_done_n > 5 then E'\n- 외 ' || (v_done_n - 5) || '건' else '' end || E'\n' else '' end
      || case when v_late_n > 0 then E'\n기한 지난 일 ' || v_late_n || '건' || E'\n' || v_late || case when v_late_n > 5 then E'\n- 외 ' || (v_late_n - 5) || '건' else '' end || E'\n' else '' end
      || case when v_next_n > 0 then E'\n' || case when v_tomorrow - v_today = 3 then '다음 월요일' else '내일' end || ' 할 일 ' || v_next_n || '건' || E'\n' || v_next || case when v_next_n > 5 then E'\n- 외 ' || (v_next_n - 5) || '건' else '' end || E'\n' else '' end
      || case when v_logs = 0 then E'\n오늘 업무 일지가 아직 없습니다. 한 일을 말씀해 주시면 일지에 적어 드릴게요.' else '' end
      || case when v_unread > 0 then E'\n안 읽은 알림 ' || v_unread || '건이 있습니다.' else '' end
      || E'\n\n기한을 옮기거나 일지를 적을 일이 있으면 이 방에 말씀해 주세요.';

    if p_dry then n_sent := n_sent + 1; continue; end if;
    if v_room is null then
      insert into public.chat_rooms (name, description, members, dm_key, created_by)
      values ('dm:' || v_key, null, array[p.id, v_agent], v_key, p.id)
      on conflict (dm_key) do nothing returning id into v_room;
      if v_room is null then select r.id into v_room from public.chat_rooms r where r.dm_key = v_key; end if;
    end if;
    insert into public.chat_messages (room_id, user_id, content) values (v_room, v_agent, left(v_body, 3500));
    n_sent := n_sent + 1;
  end loop;
  return jsonb_build_object('sent', n_sent, 'skipped', n_skip, 'dry', p_dry);
end $$;
revoke all on function private.assistant_evening_digest(boolean) from public, anon, authenticated;

-- 평일 18:23 KST = 09:23 UTC (정각 · 5분 단위 피함)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'wkly_assistant_evening') then perform cron.unschedule('wkly_assistant_evening'); end if;
  perform cron.schedule('wkly_assistant_evening', '23 9 * * 1-5', 'select private.assistant_evening_digest()');
end $$;
