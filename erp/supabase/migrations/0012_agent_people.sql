-- WKLY ERP 0012: 에이전트용 팀원 목록 (지시 처리 때 할 일 담당자 · 알림 받는 사람 지정)
--   read 범위 연결 키로만 호출. 이름 · 직함 · 메일 · 오늘 상태만 (인사 · 재무 정보 없음)
create function public.agent_people(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.agent_token_check(p_token, 'read');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'title', p.title, 'email', p.email, 'today_status', p.today_status) order by p.name)
    from public.profiles p
    where p.active and not p.is_agent
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.agent_people(text) from public, authenticated;
grant execute on function public.agent_people(text) to anon;
