-- WKLY ERP 0018: 거래처 리서치 보고서
--   - 자료실 종류에 '거래처 리포트' 추가 · 보고받을 담당자(shared_to)
--   - report_templates: 보고서 공통 양식 (모두 사용, 만든 사람 · 관리자만 수정)
--   - agent_research_context: AI 팀원이 양식 · 거래처 · 기존 보고서 · 담당자 목록을 읽음 (scope read)
--   - agent_submit_report: AI 팀원이 보고서를 올리고 담당자에게 알림 (scope research)

-- 1. 자료실
alter table public.research_items drop constraint if exists research_items_kind_check;
alter table public.research_items add constraint research_items_kind_check
  check (kind in ('거래처 리포트', '팝업', '브랜드', '트렌드', '경쟁사', '인터뷰', '기타'));
alter table public.research_items add column if not exists shared_to uuid references public.profiles (id) on delete set null;
comment on column public.research_items.shared_to is '보고받는 담당자 (거래처 리포트)';
create index if not exists research_items_client_idx on public.research_items (client_id, created_at desc);

-- 2. 보고서 양식
create table if not exists public.report_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  body        text not null check (char_length(body) <= 20000),
  is_default  boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.report_templates is '리서치 보고서 공통 양식. {{거래처}} {{구분}} {{작성일}} {{작성자}} 는 작성할 때 채워짐';
create unique index if not exists report_templates_one_default on public.report_templates (is_default) where is_default;
drop trigger if exists set_updated_at on public.report_templates;
create trigger set_updated_at before update on public.report_templates
  for each row execute function public.set_updated_at();

alter table public.report_templates enable row level security;
drop policy if exists report_templates_select on public.report_templates;
create policy report_templates_select on public.report_templates for select to authenticated
  using ((select public.is_active_member()));
drop policy if exists report_templates_insert on public.report_templates;
create policy report_templates_insert on public.report_templates for insert to authenticated
  with check ((select public.is_active_member()) and created_by = (select auth.uid()));
drop policy if exists report_templates_update on public.report_templates;
create policy report_templates_update on public.report_templates for update to authenticated
  using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.is_active_member()));
drop policy if exists report_templates_delete on public.report_templates;
create policy report_templates_delete on public.report_templates for delete to authenticated
  using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
grant select, insert, update, delete on public.report_templates to authenticated;
revoke all on public.report_templates from anon;

insert into public.report_templates (name, is_default, created_by, body)
select '거래처 리서치 보고서 (기본)', true, null, $t$# {{거래처}} 리서치 보고서

구분: {{구분}}
작성일: {{작성일}}
작성자: {{작성자}}
홈페이지:
받은 메일: (언제 · 누가 · 무슨 요청인지 한 줄)

## 1. 한눈에 보기
- 핵심 요약 1
- 핵심 요약 2
- 핵심 요약 3

## 2. 회사 · 브랜드 개요
- 업종 · 주요 제품/서비스
- 규모 · 설립 · 본사/매장 위치
- 주요 고객층

## 3. 최근 동향 (최근 6개월)
- 뉴스 · 보도자료 · 신제품 · 투자 · 인사

## 4. 마케팅 방향성
- 타깃 고객
- 브랜드 톤앤매너 · 핵심 메시지
- 주력 채널 (인스타그램 · 유튜브 · 오프라인 팝업 · 커머스 등)
- 최근 캠페인 · 팝업 · 협업 사례
- 앞으로의 방향 (추정 근거와 함께)

## 5. 경쟁사 · 시장 흐름
- 경쟁 브랜드와 차이점
- 업계 흐름

## 6. WKLY 제안 포인트
- 협업 기회 (팝업 · 공간 · 콘텐츠 · 캠페인)
- 첫 미팅에서 꺼낼 이야기

## 7. 확인할 점 · 리스크
-

## 8. 출처
-
$t$
where not exists (select 1 from public.report_templates);

-- 3. AI 팀원: 양식 · 거래처 · 기존 보고서 · 담당자 읽기 (scope read)
--    p_query 가 있으면 거래처 이름 · 이메일 · 웹사이트 · 담당자 이메일로 찾고, 없으면 최근 바뀐 거래처 30곳
create or replace function public.agent_research_context(p_token text, p_query text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform public.agent_token_check(p_token, 'read');
  return jsonb_build_object(
    'template', (
      select jsonb_build_object('id', t.id, 'name', t.name, 'body', t.body)
      from public.report_templates t
      order by t.is_default desc, t.updated_at desc
      limit 1
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'title', p.title) order by p.name)
      from public.profiles p
      where p.active and not p.is_agent
    ), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(x.item order by x.updated_at desc)
      from (
        select c.updated_at,
               jsonb_build_object(
                 'id', c.id, 'name', c.name, 'category', c.category,
                 'email', c.email, 'website', c.website, 'memo', left(c.memo, 300),
                 'contacts', coalesce((
                   select jsonb_agg(jsonb_build_object('name', ct.name, 'title', ct.title, 'email', ct.email))
                   from public.contacts ct where ct.client_id = c.id
                 ), '[]'::jsonb),
                 'owner', (
                   select jsonb_build_object('id', o.id, 'name', o.name)
                   from public.projects pr join public.profiles o on o.id = pr.owner_id
                   where pr.client_id = c.id and pr.status <> '보류'
                   order by (pr.status = '완료'), pr.updated_at desc
                   limit 1
                 ),
                 'reports', coalesce((
                   select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'created_at', r.created_at) order by r.created_at desc)
                   from public.research_items r
                   where r.client_id = c.id and r.kind = '거래처 리포트'
                 ), '[]'::jsonb)
               ) as item
        from public.clients c
        where v_q is null
           or c.name ilike '%' || v_q || '%'
           or c.email ilike '%' || v_q || '%'
           or c.website ilike '%' || v_q || '%'
           or exists (select 1 from public.contacts ct where ct.client_id = c.id and (ct.email ilike '%' || v_q || '%' or ct.name ilike '%' || v_q || '%'))
        order by c.updated_at desc
        limit case when v_q is null then 30 else 20 end
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- 4. AI 팀원: 보고서 올리기 + 담당자 알림 (scope research)
--    payload: client_id 또는 client_name, title, summary, body(필수), source_url, source_name, tags, project_id,
--             share_to(담당자 id · 이름 · 이메일). 없으면 거래처 최근 프로젝트 책임자 → 그래도 없으면 관리자 전체
create or replace function public.agent_submit_report(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent   uuid;
  v_client  public.clients;
  v_name    text;
  v_body    text;
  v_title   text;
  v_summary text;
  v_share   text;
  v_to      uuid;
  v_tags    text[];
  v_id      uuid;
  v_count   integer := 0;
  r         record;
begin
  v_agent := public.agent_token_check(p_token, 'research');
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload 는 JSON 객체여야 합니다.' using errcode = '22023';
  end if;

  v_body := public.payload_text(p_payload, 'body', 20000);
  if v_body is null then
    raise exception 'payload.body (보고서 본문)이 필요합니다.' using errcode = '22023';
  end if;

  if public.payload_ref(p_payload, 'client_id', 'public.clients') is not null then
    select * into v_client from public.clients where id = public.payload_ref(p_payload, 'client_id', 'public.clients');
  else
    v_name := public.payload_text(p_payload, 'client_name', 200);
    if v_name is not null then
      select * into v_client from public.clients c where lower(c.name) = lower(v_name) order by c.updated_at desc limit 1;
    end if;
  end if;
  v_name := coalesce(v_client.name, public.payload_text(p_payload, 'client_name', 200));
  if v_name is null then
    raise exception 'payload.client_id 또는 client_name 이 필요합니다.' using errcode = '22023';
  end if;

  v_title := coalesce(public.payload_text(p_payload, 'title', 200), v_name || ' 리서치 보고서');
  v_summary := public.payload_text(p_payload, 'summary', 2000);

  select coalesce(array_agg(left(btrim(e.value), 40)), '{}'::text[]) into v_tags
  from jsonb_array_elements_text(case when jsonb_typeof(p_payload -> 'tags') = 'array' then p_payload -> 'tags' else '[]'::jsonb end) e
  where btrim(e.value) <> '';
  v_tags := (array['거래처 리포트'] || coalesce(v_client.category, '거래처') || v_tags[1:18]);

  -- 담당자
  v_share := public.payload_text(p_payload, 'share_to', 200);
  if v_share is not null then
    select p.id into v_to from public.profiles p
    where p.active and not p.is_agent
      and (p.id::text = v_share or lower(p.email) = lower(v_share) or p.name = v_share)
    limit 1;
  end if;
  if v_to is null and v_client.id is not null then
    select pr.owner_id into v_to from public.projects pr
    join public.profiles o on o.id = pr.owner_id and o.active and not o.is_agent
    where pr.client_id = v_client.id and pr.status <> '보류'
    order by (pr.status = '완료'), pr.updated_at desc
    limit 1;
  end if;

  insert into public.research_items (
    kind, title, summary, body, source_url, source_name, brand_name, tags, status,
    client_id, project_id, shared_to, collected_by_agent, created_by
  ) values (
    '거래처 리포트', v_title, v_summary, v_body,
    public.payload_text(p_payload, 'source_url', 2000),
    coalesce(public.payload_text(p_payload, 'source_name', 200), 'AI 리서치'),
    v_name, v_tags, '새 자료',
    v_client.id, public.payload_ref(p_payload, 'project_id', 'public.projects'),
    v_to, v_agent, v_agent
  )
  returning id into v_id;

  if v_to is not null then
    if public.notify(v_to, '시스템', '📑 리서치 보고서 · ' || v_name, coalesce(v_summary, v_title), '/library?id=' || v_id) is not null then
      v_count := 1;
    end if;
  else
    for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
      if public.notify(r.id, '시스템', '📑 리서치 보고서 · ' || v_name, coalesce(v_summary, v_title), '/library?id=' || v_id) is not null then
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'kind', 'report', 'id', v_id, 'client_id', v_client.id, 'shared_to', v_to, 'notified', v_count);
end;
$$;

revoke all on function public.agent_research_context(text, text) from public;
revoke all on function public.agent_submit_report(text, jsonb) from public;
grant execute on function public.agent_research_context(text, text) to anon, authenticated;
grant execute on function public.agent_submit_report(text, jsonb) to anon, authenticated;

-- 5. 화면에서 보고서의 담당자를 정하면 그 사람에게 알림 (AI 는 agent_submit_report 가 직접 알림)
create or replace function private.research_share_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.shared_to is not null and new.shared_to <> auth.uid()
     and (tg_op = 'INSERT' or new.shared_to is distinct from old.shared_to) then
    perform public.notify(new.shared_to, '시스템', '📑 리서치 보고서 · ' || coalesce(new.brand_name, new.title), coalesce(left(new.summary, 300), new.title), '/library?id=' || new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists research_items_share_notify on public.research_items;
create trigger research_items_share_notify
  after insert or update of shared_to on public.research_items
  for each row execute function private.research_share_notify();

-- 6. 기본 양식은 하나: 새 기본 양식을 정하면 나머지는 해제
create or replace function private.report_templates_one_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_default then
    update public.report_templates set is_default = false where is_default and id <> new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists report_templates_one_default on public.report_templates;
create trigger report_templates_one_default
  before insert or update of is_default on public.report_templates
  for each row execute function private.report_templates_one_default();
