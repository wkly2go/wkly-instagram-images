-- 거래처 리포트 에이전트 보강 (대표 지시 2026-11-12 "한계에 대해서 자세히 설명하고 거래처 리포트 없는 발주처 리포트 작성해")
--  - 예약 작업은 Gmail 연결을 쓸 수 없어 메일 기록이 빠졌음 → 인트라넷이 이미 모아 둔 메일 색인(mail_index · 프로젝트 메일 동기화)과
--    담당자(contacts · 이름 · 직함만)를 리포트 자료로 함께 넘김. 메일 주소 · 전화번호는 넘기지 않음 (보낸 쪽 도메인만)
--  - client_report_context(id) : 한 거래처의 자료 묶음 (안쪽 함수 · 직접 호출 불가)
--  - agent_client_report_context(token, ids[]) : 지정한 거래처들 자료 (일괄 작성용, 최대 20곳)
--  - agent_client_report_targets : 같은 자료 묶음을 쓰고, 발주처(클라이언트)를 협력사보다 먼저 고름

create or replace function public.client_report_context(p_client uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'client', jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'website', c.website, 'address', c.address, 'memo', left(c.memo, 1500)),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code, 'status', p.status, 'category', p.category, 'division', p.division, 'start_date', p.start_date, 'end_date', p.end_date) order by p.updated_at desc), '[]'::jsonb) from public.projects p where p.client_id = c.id),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object('name', ct.name, 'title', ct.title, 'primary', ct.is_primary)), '[]'::jsonb) from public.contacts ct where ct.client_id = c.id),
    'mail', (select jsonb_build_object(
        'count', count(*), 'first', min(m.sent_at)::date, 'last', max(m.sent_at)::date,
        'domains', (select coalesce(jsonb_agg(distinct split_part(m2.from_addr, '@', 2)), '[]'::jsonb) from public.mail_index m2 where m2.client_id = c.id and m2.from_addr like '%@%' and m2.from_addr not like '%thewklyn.com%'),
        'recent', (select coalesce(jsonb_agg(jsonb_build_object('date', x.sent_at::date, 'from', x.from_name, 'subject', x.subject, 'snippet', left(x.snippet, 220)) order by x.sent_at desc), '[]'::jsonb)
                   from (select * from public.mail_index m3 where m3.client_id = c.id order by m3.sent_at desc limit 10) x),
        'indexed_since', (select min(sent_at)::date from public.mail_index))
      from public.mail_index m where m.client_id = c.id),
    'report', (select jsonb_build_object('id', ri.id, 'title', ri.title, 'updated_at', ri.updated_at, 'body', ri.body) from public.research_items ri where ri.kind = '거래처 리포트' and ri.client_id = c.id order by ri.updated_at desc limit 1))
  from public.clients c where c.id = p_client
$$;
revoke all on function public.client_report_context(uuid) from public, anon, authenticated;

create or replace function public.agent_client_report_context(p_token text, p_client_ids uuid[])
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.agent_token_check(p_token, 'task');
  if coalesce(array_length(p_client_ids, 1), 0) > 20 then
    raise exception '한 번에 20곳까지입니다.' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(public.client_report_context(i) order by o), '[]'::jsonb)
          from unnest(p_client_ids) with ordinality as u(i, o) where exists (select 1 from public.clients c where c.id = i));
end $$;

create or replace function public.agent_client_report_targets(p_token text, p_limit int default 3)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 3), 1), 5);
  v jsonb := '[]'::jsonb;
  r record;
  v_ids uuid[] := '{}';
  v_norm text;
  v_client uuid;
begin
  perform public.agent_token_check(p_token, 'task');
  -- 1) 요청 할 일 '[거래처 리포트] 회사명'
  for r in select t.id, t.title, t.memo from public.tasks t
           where t.title like '[거래처 리포트]%' and t.status <> '완료' order by t.created_at limit v_limit loop
    v_norm := regexp_replace(trim(substr(r.title, length('[거래처 리포트]') + 1)), '\(주\)|（주）|주식회사|\s', '', 'g');
    select c.id into v_client from public.clients c
      where regexp_replace(c.name, '\(주\)|（주）|주식회사|\s', '', 'g') ilike v_norm
      order by (c.category = '클라이언트') desc limit 1;
    if v_client is null and length(v_norm) >= 2 then
      select c.id into v_client from public.clients c
        where regexp_replace(c.name, '\(주\)|（주）|주식회사|\s', '', 'g') ilike '%' || v_norm || '%' order by length(c.name) limit 1;
    end if;
    v := v || jsonb_build_array(jsonb_build_object('task_id', r.id, 'request', trim(substr(r.title, length('[거래처 리포트]') + 1)), 'memo', r.memo, 'client_id', v_client));
    if v_client is not null then v_ids := v_ids || v_client; end if;
    v_client := null;
  end loop;
  -- 2) 발주처(클라이언트) 먼저: 리포트 없음 → 프로젝트 · 메일이 리포트보다 새로움 → 90일 지남 / 3) 프로젝트 있는 협력사
  for r in
    with c as (
      select cl.id, cl.category, cl.created_at,
        (select max(p.updated_at) from public.projects p where p.client_id = cl.id) last_proj,
        (select max(m.sent_at) from public.mail_index m where m.client_id = cl.id) last_mail,
        (select max(ri.updated_at) from public.research_items ri where ri.kind = '거래처 리포트' and ri.client_id = cl.id) last_rep
      from public.clients cl)
    select id from c
    where not (id = any (v_ids))
      and ((category = '클라이언트' and (last_rep is null or last_rep < greatest(last_proj, last_mail) or last_rep < now() - interval '90 days'))
        or (last_proj is not null and (last_rep is null or last_rep < last_proj or last_rep < now() - interval '90 days')))
    order by (category = '클라이언트') desc, (last_rep is null) desc, greatest(last_proj, last_mail, created_at) desc nulls last
    limit greatest(v_limit - jsonb_array_length(v), 0)
  loop
    v := v || jsonb_build_array(jsonb_build_object('client_id', r.id));
  end loop;
  select coalesce(jsonb_agg(x.e || coalesce(public.client_report_context((x.e->>'client_id')::uuid), '{}'::jsonb) order by x.o), '[]'::jsonb)
  into v from jsonb_array_elements(v) with ordinality as x(e, o);
  return v;
end $$;

revoke all on function public.agent_client_report_context(text, uuid[]) from public;
grant execute on function public.agent_client_report_context(text, uuid[]) to anon, authenticated;
