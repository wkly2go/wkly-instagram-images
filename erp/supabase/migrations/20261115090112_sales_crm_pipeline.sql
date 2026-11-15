-- Bind accepted outreach and reply activity to the existing pipeline. No sending is enabled.
begin;
alter table private.sales_crm_threads add column opportunity_id uuid references public.sales_opportunities(id);
alter table private.sales_crm_threads add column pipeline_note text not null default '승인 당시 연결 정보 자동 대조 대상';
alter table private.sales_crm_threads add column pipeline_created boolean not null default false;
alter table private.sales_crm_threads add column pipeline_revision integer;
alter table private.sales_crm_threads add column pipeline_actor uuid references public.profiles(id);
alter table private.sales_crm_threads add column pipeline_failures integer not null default 0;
alter table private.sales_crm_threads add column pipeline_last_failure timestamptz;
create table private.sales_crm_pipeline_events(
 dispatch_id uuid not null references private.sales_crm_threads(dispatch_id),event_key text not null,
 opportunity_id uuid not null references public.sales_opportunities(id),activity_id uuid not null references public.sales_activities(id),
 created_at timestamptz not null default now(),primary key(dispatch_id,event_key)
);
revoke all on private.sales_crm_pipeline_events from public,anon,authenticated,service_role;

-- Mapping is part of the reviewed fingerprint, never guessed after approval.
alter function private.sales_execution_material(uuid) rename to sales_execution_material_before_pipeline;
create function private.sales_execution_material(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare m jsonb;payload jsonb;blockers jsonb;links jsonb:='{}';msg jsonb;target jsonb;company uuid;person uuid;opportunity uuid;op public.sales_opportunities;owner uuid;company_count int;person_count int;op_count int;
begin
 m:=private.sales_execution_material_before_pipeline(p_id);if m is null then return null;end if;
 payload:=m->'payload';blockers:=m->'blockers';
 select requested_by into owner from public.sales_strategies where id=p_id;
 for msg in select value from jsonb_array_elements(payload->'messages') loop
  select count(distinct t->>'company_id'),count(distinct t->>'person_id'),min(t->>'company_id')::uuid,min(t->>'person_id')::uuid into company_count,person_count,company,person from jsonb_array_elements(payload->'targets') t where t->>'email'=msg->>'recipient';
  if company_count<>1 then company:=null;end if;if person_count<>1 or company is null then person:=null;end if;
  select count(distinct p.linked_sales_id),min(p.linked_sales_id::text)::uuid into op_count,opportunity from public.sales_prospects p where msg->'source_ids' ? p.id::text;
  if op_count>1 then blockers:=blockers||jsonb_build_array('같은 수신 대상에 여러 영업 건이 연결되어 시스템 관계 검증이 필요합니다.');opportunity:=null;end if;
  op:=null;
  if opportunity is not null then
   select * into op from public.sales_opportunities where id=opportunity;
   if op.id is null or op.client_id is distinct from company or op.contact_id is distinct from person or op.stage in ('수주','실주','보류') then blockers:=blockers||jsonb_build_array('기존 영업 건의 대상 또는 종료 상태를 시스템이 재검증해야 합니다.');end if;
  end if;
  links:=links||jsonb_build_object(msg->>'recipient',jsonb_build_object('opportunity_id',opportunity,'client_id',company,'contact_id',person,'division',coalesce(op.division,'TW'),'owner_id',coalesce(op.owner_id,owner),'title',left(payload->>'title',160),'mode',case when opportunity is null then 'new' else 'existing' end));
 end loop;
 payload:=payload||jsonb_build_object('pipeline',links);
 return jsonb_build_object('payload',payload,'blockers',blockers,'fingerprint',encode(sha256(convert_to(jsonb_build_array(payload,blockers)::text,'UTF8')),'hex'));
end $$;

create function private.sales_crm_pipeline_sync(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c private.sales_crm_threads;j private.sales_dispatch_jobs;p public.sales_execution_packages;link jsonb;op public.sales_opportunities;actor uuid;activity uuid;r record;key text;note text;changed boolean;next_stage text;
begin
 select * into c from private.sales_crm_threads where dispatch_id=p_id for update;if c.dispatch_id is null then return;end if;
 select * into j from private.sales_dispatch_jobs where id=p_id;
 select * into p from public.sales_execution_packages where id=j.package_id;
 link:=p.payload->'pipeline'->c.recipient;actor:=coalesce(c.pipeline_actor,p.approved_by,(select actor_id from public.sales_execution_events where package_id=p.id and kind='승인' order by id desc limit 1));
 if actor is null or not exists(select 1 from public.profiles where id=actor) then update private.sales_crm_threads set pipeline_note='승인 기록 확인 필요 · 원래 활동 기록 보존' where dispatch_id=p_id;return;end if;
 if c.opportunity_id is null then
  if jsonb_typeof(link) is distinct from 'object' or coalesce(link->>'mode','') not in ('new','existing') or coalesce(link->>'division','') not in ('TW','AR') or not exists(select 1 from public.profiles where id=(link->>'owner_id')::uuid and active and not is_agent) then update private.sales_crm_threads set pipeline_note='승인 당시 파이프라인 연결 정보 없음 · 시스템 연결 검증 대상' where dispatch_id=p_id;return;end if;
  if link->>'client_id' is not null and not exists(select 1 from public.clients where id=(link->>'client_id')::uuid) or link->>'contact_id' is not null and not exists(select 1 from public.contacts where id=(link->>'contact_id')::uuid and client_id=(link->>'client_id')::uuid) then update private.sales_crm_threads set pipeline_note='승인 이후 회사·담당자 관계 변경 · 자동 연결 보류' where dispatch_id=p_id;return;end if;
  if link->>'mode'='existing' then
   select * into op from public.sales_opportunities where id=(link->>'opportunity_id')::uuid for update;
   if op.id is null or op.client_id is distinct from (link->>'client_id')::uuid or op.contact_id is distinct from (link->>'contact_id')::uuid or op.division<>link->>'division' then update private.sales_crm_threads set pipeline_note='기존 영업 건 관계 변경 · 원본 수정 없이 자동 연결 보류' where dispatch_id=p_id;return;end if;
  else
   if exists(select 1 from public.sales_opportunities where id=c.dispatch_id) then update private.sales_crm_threads set pipeline_note='영업 식별자 충돌 · 기존 자료 보존 및 시스템 복구 대상' where dispatch_id=p_id;return;end if;
   insert into public.sales_opportunities(id,title,division,client_id,contact_id,owner_id,stage,source,expected_amount,next_action,description,created_by,updated_by)
   values(c.dispatch_id,left(link->>'title',160),link->>'division',(link->>'client_id')::uuid,(link->>'contact_id')::uuid,(link->>'owner_id')::uuid,'접촉','직접 발굴',null,'시스템이 회신을 확인하고 후속안을 준비합니다. 외부 발송은 별도 승인 전 미실행.','AI 영업 실행안의 제공사 접수 기록에서 자동 생성 · 구매 의향·수주 확인 아님',actor,actor) returning * into op;
   insert into public.sales_revisions(opportunity_id,revision,snapshot,created_by) values(op.id,op.revision,to_jsonb(op),actor);
   c.pipeline_created:=true;
  end if;
  update private.sales_crm_threads set opportunity_id=op.id,pipeline_actor=actor,pipeline_created=c.pipeline_created,pipeline_revision=case when c.pipeline_created then op.revision else null end,pipeline_note='승인 당시 연결 정보로 영업 파이프라인 자동 연결' where dispatch_id=p_id returning * into c;
 else
  select * into op from public.sales_opportunities where id=c.opportunity_id for update;
  if op.id is null or op.client_id is distinct from (link->>'client_id')::uuid or op.contact_id is distinct from (link->>'contact_id')::uuid then update private.sales_crm_threads set pipeline_note='연결 후 회사·담당자 관계 변경 · 원본 수정 없이 활동 기록 보존' where dispatch_id=p_id;return;end if;
 end if;
 for r in select 'accepted' event_key,'[시스템] 이메일 제공사 접수 · 수신함 도착·열람·구매 의향 확인 아님' body
 union all select 'reply:'||message_id,case signal when 'stop' then '[시스템] 연락 중단 표현 감지 · 해당 주소 후속 발송 차단' when 'limited' then '[시스템] 회신 일부 확보 · 시스템 추가 검증 대상' else '[시스템] 대화 참조가 일치하는 회신 확보 · 후속안 자동 준비 대상' end||E'\n'||left(text,1500) from private.sales_crm_replies where dispatch_id=p_id order by event_key loop
  if exists(select 1 from private.sales_crm_pipeline_events where dispatch_id=p_id and event_key=r.event_key) then continue;end if;
  activity:=gen_random_uuid();
  insert into public.sales_activities(id,opportunity_id,kind,body,created_by) values(activity,op.id,'메일',r.body,actor);
  insert into private.sales_crm_pipeline_events(dispatch_id,event_key,opportunity_id,activity_id) values(p_id,r.event_key,op.id,activity);
 end loop;
 -- Respect explicit human edits and terminal states. Only the untouched system-owned row advances.
 if c.pipeline_created and op.revision=c.pipeline_revision and op.stage in ('발굴','접촉') and c.stage='연락 중단' then
  update public.sales_opportunities set stage='보류',next_action='해당 수신 주소 연락 중단 · 재발송 차단',next_date=null,result_note='회신의 연락 중단 표현 감지 · 계약 결과를 의미하지 않음',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=op.id returning * into op;
  insert into public.sales_revisions(opportunity_id,revision,snapshot,created_by) values(op.id,op.revision,to_jsonb(op),actor);
  update private.sales_crm_threads set pipeline_revision=op.revision where dispatch_id=p_id;
 end if;
end $$;
-- Keep receipt/reply persistence independent from a recoverable pipeline failure.
create function private.sales_crm_pipeline_try(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.sales_crm_pipeline_sync(p_id);
 update private.sales_crm_threads set pipeline_failures=0,pipeline_last_failure=null where dispatch_id=p_id;
exception when others then
 update private.sales_crm_threads set pipeline_failures=case when pipeline_last_failure<now()-interval '24 hours' then 1 else pipeline_failures+1 end,pipeline_last_failure=now(),pipeline_note='파이프라인 연결 오류 · 접수·회신 원문 보존 · 시스템이 15분 간격, 24시간 최대 3회 자동 복구' where dispatch_id=p_id;
end $$;
create function private.sales_crm_pipeline_after_record() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.sales_crm_pipeline_try(new.dispatch_id);return new;end $$;
create trigger sales_crm_pipeline_record after insert on private.sales_crm_threads for each row execute function private.sales_crm_pipeline_after_record();
-- Reply finishing sets the final stop state after inserting the reply, so bridge afterward.
alter function public.sales_reply_finish(uuid,jsonb) rename to sales_reply_finish_before_pipeline;
create function public.sales_reply_finish(p_id uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare dispatch uuid;
begin
 perform public.sales_reply_finish_before_pipeline(p_id,p_result);
 select dispatch_id into dispatch from private.sales_reply_jobs where id=p_id and state='done';
 if dispatch is not null then perform private.sales_crm_pipeline_try(dispatch);end if;
end $$;
alter function public.sales_execution_get(uuid) rename to sales_execution_get_before_pipeline;
create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rows jsonb;
begin
 result:=public.sales_execution_get_before_pipeline(p_id);if result is null then return null;end if;
 select coalesce(jsonb_agg(t||jsonb_build_object('opportunity_id',c.opportunity_id,'pipeline_note',c.pipeline_note,'pipeline_stage',o.stage) order by n),'[]') into rows from jsonb_array_elements(result->'crm'->'threads') with ordinality x(t,n) join private.sales_crm_threads c on c.dispatch_id=(t->>'dispatch_id')::uuid left join public.sales_opportunities o on o.id=c.opportunity_id;
 return jsonb_set(result,'{crm,threads}',rows);
end $$;
alter function private.sales_reply_tick() rename to sales_reply_tick_before_pipeline;
create function private.sales_reply_tick() returns void language plpgsql security definer set search_path='' as $$
declare c record;
begin
 perform private.sales_reply_tick_before_pipeline();
 if not pg_try_advisory_xact_lock(903150112) then return;end if;
 for c in select dispatch_id from private.sales_crm_threads where pipeline_last_failure<now()-interval '15 minutes' and (pipeline_failures<3 or pipeline_last_failure<now()-interval '24 hours') order by pipeline_last_failure limit 3 loop
  perform private.sales_crm_pipeline_try(c.dispatch_id);
 end loop;
end $$;
revoke all on function private.sales_crm_pipeline_try(uuid),private.sales_reply_tick(),private.sales_reply_tick_before_pipeline() from public,anon,authenticated,service_role;
revoke all on function private.sales_execution_material(uuid),private.sales_execution_material_before_pipeline(uuid),private.sales_crm_pipeline_sync(uuid),private.sales_crm_pipeline_after_record(),public.sales_reply_finish_before_pipeline(uuid,jsonb),public.sales_execution_get_before_pipeline(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sales_reply_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_reply_finish(uuid,jsonb) to service_role;
revoke all on function public.sales_execution_get(uuid) from public,anon;
grant execute on function public.sales_execution_get(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
