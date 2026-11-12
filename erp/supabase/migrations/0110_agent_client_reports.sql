-- 거래처 리포트 에이전트용 함수 (대표 지시 2026-11-12 "거래처 리포트를 작성하고 인트라넷에 업데이트하는 에이전트를 만들어")
-- 예약 작업은 커넥터 없이 환경 변수(WKLY_ERP_URL · ANON_KEY · AGENT_TOKEN)로 이 두 함수만 부른다 (agent_dev_requests 와 같은 방식 · 'task' 권한 토큰)
--  1) agent_client_report_targets : 쓸 거래처 고르기 — 요청 할 일('[거래처 리포트] 회사명') → 프로젝트가 있는데 리포트가 없거나 오래된 거래처 → 리포트 없는 클라이언트
--  2) agent_client_report_save    : 리포트 저장 (같은 거래처 리포트가 있으면 갱신) · 요청 할 일 완료 처리 · 작업 기록(agent_reports) 한 줄
-- 결재 · 알림은 만들지 않는다 (대표 지시: 결재가 이루어지지 않는 보고는 하지 않음)

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
  -- 1) 요청 할 일
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
  -- 2) 프로젝트가 있는데 리포트가 없거나 오래된 거래처 → 3) 리포트 없는 클라이언트
  for r in
    with c as (
      select cl.id, cl.category,
        (select max(p.updated_at) from public.projects p where p.client_id = cl.id) last_proj,
        (select max(ri.updated_at) from public.research_items ri where ri.kind = '거래처 리포트' and ri.client_id = cl.id) last_rep,
        cl.created_at
      from public.clients cl)
    select id from c
    where not (id = any (v_ids))
      and ((last_proj is not null and (last_rep is null or last_rep < last_proj or last_rep < now() - interval '90 days'))
        or (category = '클라이언트' and last_rep is null))
    order by (last_proj is not null) desc, (last_rep is null) desc, (category = '클라이언트') desc, coalesce(last_proj, created_at) desc
    limit greatest(v_limit - jsonb_array_length(v), 0)
  loop
    v := v || jsonb_build_array(jsonb_build_object('client_id', r.id));
  end loop;
  -- 거래처 정보 · 프로젝트 · 기존 리포트 붙이기 (개인 연락처는 넘기지 않음)
  select coalesce(jsonb_agg(x.e || coalesce((
    select jsonb_build_object(
      'client', jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'website', c.website, 'address', c.address, 'memo', left(c.memo, 1500)),
      'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code, 'status', p.status, 'category', p.category, 'division', p.division, 'start_date', p.start_date, 'end_date', p.end_date) order by p.updated_at desc), '[]'::jsonb) from public.projects p where p.client_id = c.id),
      'report', (select jsonb_build_object('id', ri.id, 'title', ri.title, 'updated_at', ri.updated_at, 'body', ri.body) from public.research_items ri where ri.kind = '거래처 리포트' and ri.client_id = c.id order by ri.updated_at desc limit 1))
    from public.clients c where c.id = (x.e->>'client_id')::uuid), '{}'::jsonb) order by x.o), '[]'::jsonb)
  into v from jsonb_array_elements(v) with ordinality as x(e, o);
  return v;
end $$;

create or replace function public.agent_client_report_save(
  p_token text, p_client_id uuid, p_task_id uuid, p_company text, p_summary text, p_body text,
  p_tags text[] default null, p_source_url text default null, p_brand text default null, p_verdict text default '완료')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_agent uuid := '3241613e-35ca-459f-bd82-05dffea812aa'; -- 리서치팀장 (AI)
  v_owner uuid := 'd6ec347b-766a-427d-9aae-7957e830797f'; -- 대표
  v_title text := left(trim(p_company), 120) || ' 리서치 보고서';
  v_id uuid;
  v_new boolean := false;
  v_proj uuid;
begin
  perform public.agent_token_check(p_token, 'task');
  if coalesce(trim(p_company), '') = '' or coalesce(length(p_body), 0) < 200 then
    raise exception '회사 이름과 200자 이상의 본문이 필요합니다.' using errcode = '22023';
  end if;
  if p_body ~ '\d{6}\s*-\s*[1-4]\d{6}' then
    raise exception '주민등록번호 형식이 들어 있어 저장하지 않습니다.' using errcode = '22023';
  end if;
  select ri.id into v_id from public.research_items ri
    where ri.kind = '거래처 리포트' and ((p_client_id is not null and ri.client_id = p_client_id) or ri.title = v_title)
    order by ri.updated_at desc limit 1;
  select p.id into v_proj from public.projects p where p.client_id = p_client_id order by p.updated_at desc limit 1;
  if v_id is null then
    insert into public.research_items (kind, title, summary, body, tags, source_url, source_name, brand_name, client_id, project_id, section, biz, status, shared_to, collected_by_agent, created_by)
    values ('거래처 리포트', v_title, left(p_summary, 1000), left(p_body, 60000), coalesce(p_tags, array['거래처 리포트']), p_source_url, 'AI 리서치', coalesce(p_brand, trim(p_company)), p_client_id, v_proj, '사업 기회', '공통', '새 자료', v_owner, v_agent, v_agent)
    returning id into v_id;
    v_new := true;
  else
    update public.research_items set title = v_title, summary = left(p_summary, 1000), body = left(p_body, 60000),
      tags = coalesce(p_tags, tags), source_url = coalesce(p_source_url, source_url), brand_name = coalesce(p_brand, brand_name),
      client_id = coalesce(client_id, p_client_id), project_id = coalesce(v_proj, project_id), status = '새 자료', updated_at = now()
    where id = v_id;
  end if;
  if p_task_id is not null then
    update public.tasks set status = '완료', completed_at = now(), updated_at = now(),
      memo = coalesce(memo, '') || E'\n리포트 작성 완료 (리서치 메뉴 · ' || v_title || ')'
    where id = p_task_id and title like '[거래처 리포트]%';
  end if;
  insert into public.agent_reports (job_name, report_date, run_at, verdict, title, summary, body)
  values ('WKLY-거래처 리포트 작성', (now() at time zone 'Asia/Seoul')::date, now(),
    case when p_verdict in ('완료', '일부 실패') then p_verdict else '완료' end,
    'WKLY-거래처 리포트 · ' || left(trim(p_company), 60),
    case when v_new then '새로 작성' else '갱신' end || ' · ' || v_title, left(p_summary, 2000))
  on conflict (job_name, report_date, title) do update set run_at = excluded.run_at, summary = excluded.summary, body = excluded.body, verdict = excluded.verdict;
  return jsonb_build_object('ok', true, 'id', v_id, 'new', v_new, 'title', v_title);
end $$;

revoke all on function public.agent_client_report_targets(text, int) from public;
revoke all on function public.agent_client_report_save(text, uuid, uuid, text, text, text, text[], text, text, text) from public;
grant execute on function public.agent_client_report_targets(text, int) to anon, authenticated;
grant execute on function public.agent_client_report_save(text, uuid, uuid, text, text, text, text[], text, text, text) to anon, authenticated;
