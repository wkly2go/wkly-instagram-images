-- 영업 기회는 거래처·연락처 상태와 분리한다. 0107은 재실행하지 않는다.
begin;
create table public.sales_opportunities (
  id uuid primary key,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  division text not null check (division in ('TW','AR')),
  client_id uuid references public.clients(id),
  contact_id uuid references public.contacts(id),
  owner_id uuid not null references public.profiles(id),
  stage text not null check (stage in ('발굴','접촉','미팅','제안','협상','수주','실주','보류')),
  source text not null check (source in ('직접 발굴','홈페이지','소개','SNS','광고','나라장터','기타')),
  source_url text not null default '',
  expected_amount numeric(16,0) check (expected_amount between 0 and 9007199254740991),
  next_action text not null default '' check (char_length(next_action) <= 500),
  next_date date,
  description text not null default '' check (char_length(description) <= 10000),
  result_note text not null default '' check (char_length(result_note) <= 2000),
  project_id uuid references public.projects(id),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (next_date is null or btrim(next_action) <> ''),
  check (stage not in ('수주','실주','보류') or btrim(result_note) <> ''),
  check (project_id is null or stage = '수주'),
  check (contact_id is null or client_id is not null)
);
create index sales_updated_idx on public.sales_opportunities(updated_at desc, id);
create index sales_followup_idx on public.sales_opportunities(next_date, owner_id) where stage not in ('수주','실주','보류');
create table public.sales_activities (
  id uuid primary key,
  opportunity_id uuid not null references public.sales_opportunities(id),
  kind text not null check (kind in ('메모','전화','메일','미팅','상태 변경','등록')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index sales_activity_idx on public.sales_activities(opportunity_id, created_at desc, id);
create table public.sales_revisions (
  opportunity_id uuid not null references public.sales_opportunities(id),
  revision integer not null,
  snapshot jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(opportunity_id, revision)
);
alter table public.sales_opportunities enable row level security;
alter table public.sales_activities enable row level security;
alter table public.sales_revisions enable row level security;
create policy sales_read on public.sales_opportunities for select to authenticated using ((select public.is_active_member()));
create policy sales_activity_read on public.sales_activities for select to authenticated using ((select public.is_active_member()));
create policy sales_revision_read on public.sales_revisions for select to authenticated using ((select public.is_active_member()));
revoke all on public.sales_opportunities, public.sales_activities, public.sales_revisions from anon, authenticated;
grant select on public.sales_opportunities, public.sales_activities, public.sales_revisions to authenticated;

create function public.sales_save_opportunity(p_id uuid, p_document jsonb, p_expected_revision integer)
returns public.sales_opportunities language plpgsql security definer set search_path='' as $$
declare
  prior public.sales_opportunities;
  saved public.sales_opportunities;
  d public.sales_opportunities;
  k text;
begin
  if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0 then raise exception '저장 버전을 확인해 주세요.'; end if;
  if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text) > 65536 then raise exception '입력 형식을 확인해 주세요.'; end if;
  if p_document - array['title','division','client_id','contact_id','owner_id','stage','source','source_url','expected_amount','next_action','next_date','description','result_note','project_id'] <> '{}'::jsonb then raise exception '허용되지 않은 입력 항목입니다.'; end if;
  foreach k in array array['title','division','owner_id','stage','source','source_url','next_action','description','result_note'] loop
    if jsonb_typeof(p_document->k) is distinct from 'string' then raise exception '필수 항목을 확인해 주세요: %', k; end if;
  end loop;
  if p_document->'expected_amount' is distinct from 'null'::jsonb then
    if jsonb_typeof(p_document->'expected_amount') is distinct from 'number' then raise exception '예상 금액을 확인해 주세요.'; end if;
    if (p_document->>'expected_amount')::numeric < 0 or (p_document->>'expected_amount')::numeric > 9007199254740991 or trunc((p_document->>'expected_amount')::numeric) <> (p_document->>'expected_amount')::numeric then raise exception '예상 금액은 0 이상의 정수로 입력해 주세요.'; end if;
  end if;
  if p_document->>'next_date' is not null and (p_document->>'next_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '다음 연락일을 확인해 주세요.'; end if;
  d := jsonb_populate_record(null::public.sales_opportunities, p_document);
  d.title := btrim(d.title);
  if char_length(d.source_url) > 2000 or (d.source_url <> '' and (d.source_url !~* '^https?://[^[:space:]/@?#]+([/?#][^[:space:]]*)?$' or d.source_url ~ '[[:cntrl:]]')) then raise exception '출처는 http 또는 https 주소로 입력해 주세요.'; end if;
  if not exists(select 1 from public.profiles where id=d.owner_id and active and not is_agent) then raise exception '활성 팀원을 담당자로 선택해 주세요.'; end if;
  if d.contact_id is not null and not exists(select 1 from public.contacts where id=d.contact_id and client_id=d.client_id) then raise exception '연락처가 선택한 거래처에 속하지 않습니다.'; end if;
  if d.project_id is not null and not exists(select 1 from public.projects where id=d.project_id and client_id is not distinct from d.client_id and division=d.division) then raise exception '같은 회사·거래처의 프로젝트를 선택해 주세요.'; end if;
  -- 존재하지 않는 ID의 동시 생성도 하나의 트랜잭션으로 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into prior from public.sales_opportunities where id=p_id for update;
  if not public.is_admin() and (d.owner_id <> auth.uid() or (prior.id is not null and prior.owner_id <> auth.uid())) then raise exception '담당자 또는 관리자만 수정할 수 있습니다.' using errcode='42501'; end if;
  if coalesce(prior.revision,0) <> p_expected_revision then raise exception '다른 작업에서 변경되었습니다. 새로 불러온 뒤 수정해 주세요.' using errcode='40001'; end if;
  insert into public.sales_opportunities(id,title,division,client_id,contact_id,owner_id,stage,source,source_url,expected_amount,next_action,next_date,description,result_note,project_id,created_by,updated_by)
  values(p_id,d.title,d.division,d.client_id,d.contact_id,d.owner_id,d.stage,d.source,d.source_url,d.expected_amount,d.next_action,d.next_date,d.description,d.result_note,d.project_id,auth.uid(),auth.uid())
  on conflict(id) do update set title=excluded.title,division=excluded.division,client_id=excluded.client_id,contact_id=excluded.contact_id,owner_id=excluded.owner_id,stage=excluded.stage,source=excluded.source,source_url=excluded.source_url,expected_amount=excluded.expected_amount,next_action=excluded.next_action,next_date=excluded.next_date,description=excluded.description,result_note=excluded.result_note,project_id=excluded.project_id,revision=sales_opportunities.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp()
  returning * into saved;
  insert into public.sales_revisions(opportunity_id,revision,snapshot,created_by) values(saved.id,saved.revision,to_jsonb(saved),auth.uid());
  insert into public.sales_activities(id,opportunity_id,kind,body,created_by) values(gen_random_uuid(),saved.id,case when prior.id is null then '등록' else '상태 변경' end,case when prior.id is null then '영업 건 등록 · '||saved.stage else '저장 '||saved.revision||' · '||prior.stage||' → '||saved.stage end,auth.uid());
  return saved;
end $$;

create function public.sales_add_activity(p_id uuid,p_opportunity_id uuid,p_kind text,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare prior public.sales_activities; item public.sales_opportunities;
begin
  if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  select * into item from public.sales_opportunities where id=p_opportunity_id for update;
  if item.id is null or (not public.is_admin() and item.owner_id <> auth.uid()) then raise exception '담당자 또는 관리자만 기록할 수 있습니다.' using errcode='42501'; end if;
  if p_id is null or p_kind is null or p_kind not in ('메모','전화','메일','미팅') or p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then raise exception '활동 종류와 내용을 확인해 주세요.'; end if;
  select * into prior from public.sales_activities where id=p_id;
  if prior.id is not null then
    if prior.opportunity_id <> p_opportunity_id or prior.kind <> p_kind or prior.body <> btrim(p_body) or prior.created_by <> auth.uid() then raise exception '같은 요청에 다른 내용이 있습니다.'; end if;
    return;
  end if;
  insert into public.sales_activities(id,opportunity_id,kind,body,created_by) values(p_id,p_opportunity_id,p_kind,btrim(p_body),auth.uid());
end $$;
revoke all on function public.sales_save_opportunity(uuid,jsonb,integer), public.sales_add_activity(uuid,uuid,text,text) from public, anon;
grant execute on function public.sales_save_opportunity(uuid,jsonb,integer), public.sales_add_activity(uuid,uuid,text,text) to authenticated;
commit;
