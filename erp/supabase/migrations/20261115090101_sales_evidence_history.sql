-- Preserve source changes without replacing authoritative company/contact records.
begin;
create table public.sales_source_history (
 id bigint generated always as identity primary key,
 prospect_id uuid not null references public.sales_prospects(id),
 version integer not null check(version>0),
 origin text not null check(origin in ('baseline','collection')),
 snapshot jsonb not null,
 captured_at timestamptz not null default now(),
 last_collected_at timestamptz not null,
 source_updated_at timestamptz,
 unique(prospect_id,version)
);
alter table public.sales_source_history enable row level security;
create policy sales_source_history_read on public.sales_source_history for select to authenticated using((select public.is_active_member()));
revoke all on public.sales_source_history from public,anon,authenticated;
grant select on public.sales_source_history to authenticated;

create function private.sales_source_snapshot(p public.sales_prospects) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('source',p.source,'source_key',p.source_key,'name',p.name,
 'entity_kind',p.entity_kind,'organization',p.organization,'contact',p.contact,
 'source_url',p.source_url,'evidence',p.evidence,'client_id',p.client_id,
 'contact_id',p.contact_id,'blocked',p.blocked,'end_date',p.end_date,'event_data',p.event_data)
$$;

-- Baseline means existing saved material, not newly discovered customers.
insert into public.sales_source_history(prospect_id,version,origin,snapshot,last_collected_at,source_updated_at)
select id,1,'baseline',private.sales_source_snapshot(p),p.collected_at,p.source_updated_at from public.sales_prospects p;

create function private.sales_source_capture() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous public.sales_source_history; content jsonb;
begin
 content:=private.sales_source_snapshot(new);
 select * into previous from public.sales_source_history where prospect_id=new.id order by version desc limit 1 for update;
 if previous.id is not null and previous.snapshot=content then
  -- Human review alone does not constitute another collection.
  if new.collected_at>previous.last_collected_at then
   update public.sales_source_history set last_collected_at=new.collected_at,source_updated_at=new.source_updated_at where id=previous.id;
  end if;
 else
  insert into public.sales_source_history(prospect_id,version,origin,snapshot,last_collected_at,source_updated_at)
  values(new.id,coalesce(previous.version,0)+1,'collection',content,new.collected_at,new.source_updated_at);
 end if;
 return new;
end $$;
create trigger sales_source_capture after insert or update on public.sales_prospects for each row execute function private.sales_source_capture();
revoke all on function private.sales_source_snapshot(public.sales_prospects),private.sales_source_capture() from public,anon,authenticated;

create function public.sales_source_versions(p_id uuid,p_before integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if p_id is null or (p_before is not null and p_before<1) then raise exception '조회 조건을 확인해 주세요.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(h) order by h.version desc),'[]'::jsonb) from
  (select * from public.sales_source_history where prospect_id=p_id and (p_before is null or version<p_before) order by version desc limit 20) h);
end $$;

create function public.sales_automation_readiness() returns jsonb
language plpgsql security definer set search_path='' as $$
declare counts jsonb;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 select jsonb_build_object('total',count(*),
  'companies',count(*) filter(where coalesce(reviewed_kind,entity_kind)='회사'),
  'people',count(*) filter(where coalesce(reviewed_kind,entity_kind)='사람'),
  'unclassified',count(*) filter(where coalesce(reviewed_kind,entity_kind)='미분류'),
  'content_verified',count(*) filter(where private.sales_prospect_verified(p)),
  'blocked',count(*) filter(where private.sales_prospect_blocked(p)),
  'missing_source',count(*) filter(where btrim(source_url)='' or btrim(evidence)=''),
  'missing_contact',count(*) filter(where btrim(contact)=''),
  'linked_opportunities',count(*) filter(where linked_sales_id is not null)) into counts from public.sales_prospects p;
 return jsonb_build_object('counts',counts,'sending_enabled',false,
  'sending_status','발송 권한·채널 자격·실행안 승인을 연결하기 전입니다.',
  'new_today',(select count(*) from public.sales_source_history where version=1 and origin='collection' and (captured_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date),
  'baseline',(select count(*) from public.sales_source_history where version=1 and origin='baseline'));
end $$;
revoke all on function public.sales_source_versions(uuid,integer),public.sales_automation_readiness() from public,anon;
grant execute on function public.sales_source_versions(uuid,integer),public.sales_automation_readiness() to authenticated;
notify pgrst,'reload schema';
commit;
