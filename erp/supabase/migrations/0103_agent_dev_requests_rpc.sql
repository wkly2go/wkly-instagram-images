-- 인트라넷 수정 요청을 정기 실행(Claude Code)이 연결 키로 읽고 결과를 남기는 함수 (2026-11-10)
--   커넥터 없이 공개 키 + 에이전트 연결 키(p_token, scope 'task')로 호출
create or replace function public.agent_dev_requests(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.agent_token_check(p_token, 'task');
  with picked as (
    update public.dev_requests set status = '진행', updated_at = now()
    where status = '대기' returning id, content, requested_by, room_id, created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'content', content, 'requested_by', requested_by, 'room_id', room_id, 'created_at', created_at) order by created_at), '[]'::jsonb) into v from picked;
  return v;
end $$;

create or replace function public.agent_dev_request_done(p_token text, p_id uuid, p_status text, p_result text, p_pr_url text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.dev_requests;
begin
  perform public.agent_token_check(p_token, 'task');
  if p_status not in ('완료', '보류', '대기') then
    raise exception '상태는 완료 · 보류 · 대기 중 하나입니다.' using errcode = '22023';
  end if;
  update public.dev_requests set status = p_status, result = left(p_result, 4000), pr_url = p_pr_url, updated_at = now()
  where id = p_id returning * into r;
  if r.id is null then raise exception '그 요청을 찾지 못했습니다.' using errcode = '22023'; end if;
  if p_status <> '대기' then
    insert into public.notifications (user_id, kind, title, body, link)
    values (r.requested_by, '시스템', case when p_status = '완료' then '인트라넷 수정 완료' else '인트라넷 수정 보류 · 확인 필요' end, left(p_result, 1000), '/');
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'status', r.status);
end $$;

revoke all on function public.agent_dev_requests(text) from public;
revoke all on function public.agent_dev_request_done(text, uuid, text, text, text) from public;
grant execute on function public.agent_dev_requests(text) to anon, authenticated;
grant execute on function public.agent_dev_request_done(text, uuid, text, text, text) to anon, authenticated;
