-- Versioned execution material; no delivery transport is enabled here.
begin;
create table public.sales_execution_packages(
 id uuid primary key default gen_random_uuid(),strategy_id uuid not null references public.sales_strategies(id),version integer not null check(version>0),
 fingerprint text not null,payload jsonb not null,blockers jsonb not null,
 status text not null check(status in ('준비 중','승인 대기','승인','재검토','보류')),
 created_at timestamptz not null default now(),checked_at timestamptz not null default now(),approved_at timestamptz,approved_by uuid references public.profiles(id),
 unique(strategy_id,version)
);
create table public.sales_execution_events(
 id bigint generated always as identity primary key,package_id uuid not null references public.sales_execution_packages(id),
 kind text not null check(kind in ('자료 준비','재검토','승인','보류')),actor_id uuid references public.profiles(id),note text not null,created_at timestamptz not null default now()
);
alter table public.sales_execution_packages enable row level security;
alter table public.sales_execution_events enable row level security;
create policy sales_execution_packages_read on public.sales_execution_packages for select to authenticated using((select public.is_active_member()));
create policy sales_execution_events_read on public.sales_execution_events for select to authenticated using((select public.is_active_member()));
revoke all on public.sales_execution_packages,public.sales_execution_events from public,anon,authenticated;
grant select on public.sales_execution_packages,public.sales_execution_events to authenticated;
create index sales_execution_events_package on public.sales_execution_events(package_id,id);
alter table public.sales_strategies add column execution_checked_at timestamptz;

create function private.sales_execution_material(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare s public.sales_strategies; targets jsonb; sources jsonb; messages jsonb; blockers jsonb:='[]'; payload jsonb; local_day date; scheduled timestamptz; previous_schedule jsonb;
begin
 select * into s from public.sales_strategies where id=p_id;
 if s.id is null or not s.preparation_before_approval or s.preparation_status<>'완료' or s.preparation is null then return null;end if;
 targets:=private.sales_strategy_targets(p_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'snapshot',private.sales_source_snapshot(p),'verified',private.sales_prospect_verified(p),'assessment',coalesce(p.reviewed_assessment,p.assessment)) order by p.id),'[]') into sources from public.sales_prospects p where s.plan->'evidence_ids' ? p.id::text;
 if s.status not in ('승인 대기','승인') then blockers:=blockers||jsonb_build_array('기획이 보류되거나 수정되었습니다.');end if;
 if jsonb_array_length(targets)=0 then blockers:=blockers||jsonb_build_array('시스템의 실명 대상·연락처 확보가 필요합니다.');end if;
 if targets is distinct from s.targets or exists(select 1 from jsonb_array_elements(s.sources) old left join public.sales_prospects p on p.id::text=old->>'id' where s.plan->'evidence_ids' ? (old->>'id') and (p.id is null or private.sales_prospect_signature(p) is distinct from old->>'signature')) then blockers:=blockers||jsonb_build_array('준비 자료의 근거 또는 대상이 변경되어 자동 재기획이 필요합니다.');end if;
 if exists(select 1 from jsonb_array_elements(targets) t where t->>'status'='접촉 제외') then blockers:=blockers||jsonb_build_array('수신 거부·제외·마감 대상은 접촉할 수 없습니다.');end if;
 if exists(select 1 from jsonb_array_elements(targets) t where t->>'email'='') then blockers:=blockers||jsonb_build_array('시스템의 공식 연락처 추가 확보가 필요합니다.');end if;
 if exists(select 1 from jsonb_array_elements(targets) t where t->>'email'<>'' group by t->>'email' having count(distinct coalesce(nullif(t->>'company_id',''),t->>'company'))>1) then blockers:=blockers||jsonb_build_array('같은 이메일에 여러 회사가 연결되어 관계 자동 검증이 필요합니다.');end if;
 -- Stored evidence and provider capability are separate gates. A contact or a plan approval is not a send grant.
 blockers:=blockers||jsonb_build_array('발신 계정·이메일 발송 권한과 전송 처리가 아직 연결되지 않았습니다.','시스템의 수신 자격·문안·제안 범위 검증이 완료되지 않았습니다.');
 local_day:=(now() at time zone 'Asia/Seoul')::date+1;
 while extract(isodow from local_day)>5 loop local_day:=local_day+1;end loop;
 scheduled:=(local_day+time '10:00') at time zone 'Asia/Seoul';
 -- Keep the reviewed window across midnight. Expired windows need a fresh version/approval.
 select p.payload->'schedule' into previous_schedule from public.sales_execution_packages p where p.strategy_id=p_id order by p.version desc limit 1;
 if (previous_schedule->>'expires_at')::timestamptz>now() then scheduled:=(previous_schedule->>'at')::timestamptz;end if;
 select coalesce(jsonb_agg(jsonb_build_object('channel','email','recipient',email,'company',company,'person',person,'source_ids',ids,
  'subject',regexp_replace(left(s.plan->>'title',160),'[[:cntrl:]]',' ','g'),'body',s.preparation->>'contact_draft') order by email),'[]') into messages from (
   select t->>'email' email,min(t->>'company') company,min(nullif(t->>'person','')) person,jsonb_agg(t->>'source_id' order by t->>'source_id') ids
   from jsonb_array_elements(targets) t where t->>'email'<>'' and t->>'status'<>'접촉 제외' group by t->>'email'
 ) recipients;
 payload:=jsonb_build_object('strategy_id',s.id,'strategy_revision',s.revision,'title',s.plan->>'title','plan',s.plan,'research',s.preparation->>'research','targets',targets,'sources',sources,'messages',messages,
  'attachments',jsonb_build_array(jsonb_build_object('name','proposal.md','mime','text/markdown; charset=utf-8','content',s.preparation->>'proposal')),
  'schedule',jsonb_build_object('at',scheduled,'timezone','Asia/Seoul','expires_at',scheduled+interval '4 hours','per_recipient_limit',1,'followups','없음 · 회신 시 재접촉 중단'),
  'sender',null,'checks',s.preparation->'checks','transport_enabled',false);
 return jsonb_build_object('payload',payload,'blockers',blockers,'fingerprint',encode(sha256(convert_to(jsonb_build_array(payload,blockers)::text,'UTF8')),'hex'));
end $$;

create function private.sales_execution_refresh(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare current public.sales_execution_packages; material jsonb; new_id uuid;
begin
 perform 1 from public.sales_strategies where id=p_id for update;
 if not found then return null;end if;
 select * into current from public.sales_execution_packages where strategy_id=p_id order by version desc limit 1 for update;
 material:=private.sales_execution_material(p_id);
 update public.sales_strategies set execution_checked_at=now() where id=p_id;
 if material is null then return current.id;end if;
 if current.id is not null and current.fingerprint=material->>'fingerprint' then update public.sales_execution_packages set checked_at=now() where id=current.id;return current.id;end if;
 if current.id is not null and current.status<>'재검토' then
  update public.sales_execution_packages set status='재검토',checked_at=now(),approved_at=null,approved_by=null where id=current.id;
  insert into public.sales_execution_events(package_id,kind,note) values(current.id,'재검토','대상·근거·문안·일정 변경으로 이전 실행안 재검토');
 end if;
 insert into public.sales_execution_packages(strategy_id,version,fingerprint,payload,blockers,status)
 values(p_id,coalesce(current.version,0)+1,material->>'fingerprint',material->'payload',material->'blockers',case when current.status='보류' then '보류' when jsonb_array_length(material->'blockers')=0 then '승인 대기' else '준비 중' end) returning id into new_id;
 insert into public.sales_execution_events(package_id,kind,note) values(new_id,'자료 준비','시스템이 대상·문안·제안서·예정 시각을 저장 · 외부 발송 미실행');
 return new_id;
end $$;

create function private.sales_execution_after_preparation() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.sales_execution_refresh(new.id);return new;end $$;
create trigger sales_execution_after_preparation after update of preparation_status on public.sales_strategies for each row when(new.preparation_before_approval and new.preparation_status='완료' and old.preparation_status is distinct from new.preparation_status) execute function private.sales_execution_after_preparation();
create function private.sales_execution_schedule() returns void language plpgsql security definer set search_path='' as $$
declare s record;
begin
 for s in select id from public.sales_strategies where preparation_before_approval and preparation_status='완료' and status in ('승인 대기','승인') and created_at>now()-interval '30 days' order by execution_checked_at nulls first,id limit 20 for update skip locked loop perform private.sales_execution_refresh(s.id);end loop;
end $$;

create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.sales_execution_packages; m jsonb; stale boolean;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501';end if;
 select * into p from public.sales_execution_packages where strategy_id=p_id order by version desc limit 1;
 if p.id is null then return null;end if;
 m:=private.sales_execution_material(p_id);stale:=m is null or p.fingerprint is distinct from m->>'fingerprint';
 return to_jsonb(p)||jsonb_build_object('current',not stale,'status',case when stale then '재검토' else p.status end,'can_approve',not stale and p.status='승인 대기' and jsonb_array_length(m->'blockers')=0,
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from (select id,kind,note,created_at from public.sales_execution_events where package_id in (select id from public.sales_execution_packages where strategy_id=p_id) order by id desc limit 20) e));
end $$;
create function public.sales_execution_decide(p_id uuid,p_version integer,p_fingerprint text,p_decision text) returns void language plpgsql security definer set search_path='' as $$
declare p public.sales_execution_packages; m jsonb; strategy uuid;
begin
 if not public.is_admin() then raise exception '관리자만 실행안을 결정할 수 있습니다.' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('승인','보류') then raise exception '결정을 확인해 주세요.';end if;
 select strategy_id into strategy from public.sales_execution_packages where id=p_id;
 perform 1 from public.sales_strategies where id=strategy for update;
 select * into p from public.sales_execution_packages where id=p_id for update;
 if p.id is null or p.version is distinct from p_version or p.fingerprint is distinct from p_fingerprint or exists(select 1 from public.sales_execution_packages where strategy_id=strategy and version>p.version) then raise exception '실행안이 변경되었습니다. 최신 내용을 확인해 주세요.' using errcode='PT409';end if;
 m:=private.sales_execution_material(strategy);
 if m is null or p.fingerprint is distinct from m->>'fingerprint' then raise exception '근거·대상·내용·일정이 변경되어 재검토가 필요합니다.' using errcode='PT409';end if;
 if p.status=p_decision and p.approved_by=auth.uid() then return;end if;
 if p_decision='승인' and (p.status<>'승인 대기' or jsonb_array_length(m->'blockers')>0 or not coalesce((m->'payload'->>'transport_enabled')::boolean,false)) then raise exception '발송 조건이 준비되지 않았습니다. 시스템의 연결·검증 완료 후 승인할 수 있습니다.';end if;
 update public.sales_execution_packages set status=p_decision,approved_by=auth.uid(),approved_at=now() where id=p_id;
 insert into public.sales_execution_events(package_id,kind,actor_id,note) values(p_id,p_decision,auth.uid(),case p_decision when '승인' then '확인한 버전의 대상·문안·첨부·일정만 승인' else '대표가 실행안 보류 · 외부 실행 없음' end);
end $$;
revoke all on function private.sales_execution_material(uuid),private.sales_execution_refresh(uuid),private.sales_execution_after_preparation(),private.sales_execution_schedule() from public,anon,authenticated;
revoke all on function public.sales_execution_get(uuid),public.sales_execution_decide(uuid,integer,text,text) from public,anon;
grant execute on function public.sales_execution_get(uuid),public.sales_execution_decide(uuid,integer,text,text) to authenticated;
select cron.schedule('wkly_sales_execution_material','*/2 * * * *','select private.sales_execution_schedule()');
create function private.sales_execution_summary() returns jsonb language sql stable set search_path='' as $$
 with latest as (select distinct on(p.strategy_id) p.* from public.sales_execution_packages p join public.sales_strategies s on s.id=p.strategy_id where s.created_at>now()-interval '30 days' order by p.strategy_id,p.version desc),
 states as (select case when status='보류' then '보류' when fingerprint is distinct from private.sales_execution_material(strategy_id)->>'fingerprint' then '재검토' else status end state,checked_at from latest)
 select jsonb_build_object('scope','최근 30일 기획의 최신 실행안','total',count(*),'review_ready',count(*) filter(where state='승인 대기'),'needs_verification',count(*) filter(where state='준비 중'),'recheck',count(*) filter(where state='재검토'),'held',count(*) filter(where state='보류'),'approved',count(*) filter(where state='승인'),'sent',null,'delivery_connected',false,'last_checked_at',max(checked_at),'note','실제 발송·회신 기록은 아직 연결되지 않았습니다. 준비 건수를 발송 실적으로 집계하지 않습니다.') from states
$$;
revoke all on function private.sales_execution_summary() from public,anon,authenticated;

create or replace function private.sales_desk_snapshot(p_instruction text) returns jsonb language plpgsql set search_path='' as $$
declare terms text[]; since_at timestamptz; sources jsonb; matched integer;
begin
 if p_instruction ~ '이번[ ]?주' then since_at:=date_trunc('week',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'; end if;
 select array_agg(distinct term) into terms from (
  select case when char_length(t)>3 then regexp_replace(t,'(에서|으로|에게|까지|부터|관련|을|를|은|는|의|에)$','') else t end term
  from regexp_split_to_table(lower(p_instruction),'[^a-z0-9가-힣]+') t
 ) q where char_length(term)>=2 and term not in ('이번주','이번','신규','영업','자료','데이터','분석','분석해줘','분석해','조회','조회해줘','보고서','만들어','작성','작성해줘','알려줘','불러와','대상','추천','계획','기획','해줘','해주세요','정리','정리해줘','관련','이번에');
 select count(*) into matched from public.sales_prospects p where not private.sales_prospect_blocked(p)
 and (since_at is null or p.created_at>=since_at)
 and (terms is null or exists(select 1 from unnest(terms) t where strpos(lower(p.name||' '||p.organization||' '||p.evidence),t)>0));
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into sources from (
  select id,name,source,organization,entity_kind,left(evidence,1000) evidence,source_url,source_updated_at from public.sales_prospects p
  where not private.sales_prospect_blocked(p) and (since_at is null or p.created_at>=since_at)
  and (terms is null or exists(select 1 from unnest(terms) t where strpos(lower(p.name||' '||p.organization||' '||p.evidence),t)>0))
  order by source_updated_at desc nulls last,created_at desc,id limit 12
 ) x;
 return jsonb_build_object('at',now(),'scope',case when since_at is null then '저장 DB · 지시문 키워드 일치 · 최신 자료 최대 12건' else '이번 주 KST 최초 등록 자료 · 지시문 키워드 일치 · 최대 12건' end,
  'matched_total',matched,'sources',sources,'execution',private.sales_execution_summary(),
  'coverage',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select distinct on(source) source,status,left(note,250) note from public.sales_collection_runs order by source,started_at desc) x),
  'pipeline',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select stage,count(*) count from public.sales_opportunities group by stage) x));
end $$;
create or replace function private.sales_strategy_brief() returns void language plpgsql security definer set search_path='' as $$
declare actor record; ready integer; pending integer; failed integer; execution jsonb;
begin
 select count(*) filter(where status='승인 대기' and preparation_status='완료'),
 count(*) filter(where status='기획 중' or (status='승인 대기' and preparation_status='준비 중')),
 count(*) filter(where status='생성 실패' or (status='승인 대기' and preparation_status='확인 필요'))
 into ready,pending,failed from public.sales_strategies where report_date=(now() at time zone 'Asia/Seoul')::date;
 execution:=private.sales_execution_summary();
 if ready+pending+failed=0 and (execution->>'total')::integer=0 then return;end if;
 for actor in select id from public.profiles where active and role='admin' and not is_agent loop
  perform public.notify(actor.id,'일일 보고','AI 영업 기획 브리핑',format('오늘 기획 검토 대기 %s건 · 자동 준비 중 %s건 · 복구 필요 %s건. 최근 30일 실행안: 검증 대기 %s건 · 재검토 %s건 · 보류 %s건. 실제 발송·회신 기록은 미연결이며 준비 건수를 발송 실적으로 집계하지 않습니다.',ready,pending,failed,execution->>'needs_verification',execution->>'recheck',execution->>'held'),'/sales');
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
