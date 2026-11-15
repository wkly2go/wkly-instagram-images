-- Assemble existing evidence automatically; do not infer consent or buying intent.
begin;
create function private.sales_contact_evidence(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 with raw_targets as materialized (select value t from jsonb_array_elements(private.sales_strategy_targets(p_id))),
 grouped as (select case when t->>'email'<>'' then t->>'email' else 'source:'||(t->>'source_id') end contact_key,
 min(t->>'email') email,jsonb_agg(t order by t->>'source_id') targets from raw_targets group by 1),
 contacts as materialized (select * from grouped order by contact_key limit 50),
 candidates as materialized (
  select m.id,m.thread_id,m.from_addr,m.to_addr,m.subject,m.snippet,m.sent_at,m.synced_at
  from public.mail_index m where m.sent_at>=now()-interval '180 days' and m.sent_at<=now()
  and not (coalesce(m.labels,'{}') && array['SPAM','TRASH','DRAFT'])
  and (lower(btrim(m.from_addr)) in(select email from contacts where email<>'') or lower(btrim(m.to_addr)) in(select email from contacts where email<>''))
  order by m.sent_at desc,m.id desc limit 1001
 ), sampled as materialized (select * from candidates order by sent_at desc,id desc limit 1000),
 matches as (
  select c.contact_key,m.*,row_number() over(partition by c.contact_key order by m.sent_at desc,m.id desc) ordinal
  from contacts c join sampled m on c.email<>'' and (lower(btrim(m.from_addr))=c.email or lower(btrim(m.to_addr))=c.email)
 ), reports as (
  select c.contact_key,c.email,
  (select coalesce(jsonb_agg(distinct t->>'company' order by t->>'company'),'[]') from jsonb_array_elements(c.targets) t where t->>'company'<>'') companies,
  (select coalesce(jsonb_agg(distinct t->>'person' order by t->>'person'),'[]') from jsonb_array_elements(c.targets) t where t->>'person'<>'') people,
  exists(select 1 from jsonb_array_elements(c.targets) t where t->>'status'='접촉 제외') excluded,
  (select count(distinct coalesce(nullif(t->>'company_id',''),t->>'company'))>1 from jsonb_array_elements(c.targets) t) ambiguous,
  (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'origin',p.source,'url',p.source_url,'excerpt',left(coalesce(p.evidence,''),500),'signature',private.sales_prospect_signature(p)) order by p.id),'[]')
   from public.sales_prospects p where exists(select 1 from jsonb_array_elements(c.targets) t where t->>'source_id'=p.id::text)) sources,
  (select count(*) from matches m where m.contact_key=c.contact_key) sampled_matches,
  (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'thread_id',m.thread_id,'subject',left(coalesce(m.subject,''),200),'excerpt',left(coalesce(m.snippet,''),400),'sent_at',m.sent_at,'synced_at',m.synced_at,
   'address_match',case when lower(btrim(m.from_addr))=c.email then 'from' else 'to' end) order by m.sent_at desc,m.id desc),'[]') from matches m where m.contact_key=c.contact_key and m.ordinal<=5) mail
  from contacts c
 )
 select jsonb_build_object('version',1,'window_days',180,'contact_limit',50,'contact_total',(select count(*) from grouped),'contacts_truncated',(select count(*)>50 from grouped),
 'mail_scan_limit',1000,'mail_truncated',(select count(*)>1000 from candidates),'mail_per_contact_limit',5,
 'scope','저장된 최근 180일 메일 중 발신·수신 주소가 정확히 일치하는 최신 1,000건 · 연락처별 최대 5건. 다중 주소 문자열·CC/BCC·본문 전체·실시간 메일함은 확인하지 않음.',
 'proposal',(select jsonb_build_object('title',s.plan->>'title','offer',s.plan->>'offer','customer',s.plan->>'customer','why_now',s.plan->>'why_now') from public.sales_strategies s where s.id=p_id),
 'contacts',(select coalesce(jsonb_agg(jsonb_build_object('key',contact_key,'email',email,'companies',companies,'people',people,'sources',sources,'mail',mail,'sampled_matches',sampled_matches,'excluded',excluded,'ambiguous',ambiguous,
  'assessment',case when excluded then '접촉 제외 · 기존 이력과 무관하게 발송 중단' when ambiguous then '동일 주소의 회사 관계 자동 대조 필요' when email='' then '공식 연락 창구 자동 확보 필요' when sampled_matches>0 then '주소가 일치하는 저장 메일 확인 · 제안 목적·수신 의사 검증 전' else '출처 자료만 확인 · 기존 연락 근거 미확인' end,
  'next_action',case when excluded then '제외 상태 유지' when ambiguous then '회사·담당자 관계를 원문과 자동 대조' when email='' then '공식 홈페이지·문의 창구 자동 탐색 대상' when sampled_matches>0 then '메일 원문에서 요청 범위·시점·발신 진위 자동 검증 대상' else '제안 목적을 뒷받침하는 공식 근거 추가 확보 대상' end,
  'outreach_authorized',false) order by contact_key),'[]') from reports))
$$;
revoke all on function private.sales_contact_evidence(uuid) from public,anon,authenticated,service_role;

alter table private.sales_strategy_preparations add column contact_evidence jsonb;
alter table private.sales_strategy_preparations add column evidence_retries integer not null default 0;
alter function public.sales_strategy_claim(uuid,uuid) rename to sales_strategy_claim_before_contact_evidence;
revoke all on function public.sales_strategy_claim_before_contact_evidence(uuid,uuid) from public,anon,authenticated,service_role;
create function public.sales_strategy_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job jsonb; strategy uuid; evidence jsonb;
begin
 job:=public.sales_strategy_claim_before_contact_evidence(p_id,p_token);
 if job is null or job->>'phase' is distinct from 'prepare' then return job;end if;
 select strategy_id into strategy from private.sales_strategy_preparations where id=p_id;
 evidence:=private.sales_contact_evidence(strategy);
 update private.sales_strategy_preparations set contact_evidence=evidence where id=p_id;
 return job||jsonb_build_object('contact_evidence',evidence);
end $$;
create function private.sales_contact_restart(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare prep private.sales_strategy_preparations; strategy uuid; next_id uuid:=gen_random_uuid();next_token uuid:=gen_random_uuid(); old_package record;
begin
 select strategy_id into strategy from private.sales_strategy_preparations where id=p_id;
 perform 1 from public.sales_strategies where id=strategy for update;
 select * into prep from private.sales_strategy_preparations where id=p_id for update;
 if prep.id is null or not prep.done or prep.evidence_retries>=1 or not exists(select 1 from public.sales_strategies where id=strategy and status in ('승인 대기','승인')) then return false;end if;
 for old_package in update public.sales_execution_packages set status='재검토',approved_at=null,approved_by=null,checked_at=now() where strategy_id=strategy and status not in ('재검토','보류') returning id loop
  insert into public.sales_execution_events(package_id,kind,note) values(old_package.id,'재검토','연락 근거 변경 · 자동 재준비 중 · 기존 승인 취소');
 end loop;
 update private.sales_strategy_preparations set id=next_id,token=next_token,claimed=false,done=false,started_at=now(),contact_evidence=null,evidence_retries=evidence_retries+1 where id=p_id;
 update public.sales_strategies set preparation_status='준비 중',preparation_error='연락 근거 변경으로 자동 재준비 1회',revision=revision+1 where id=strategy;
 begin perform private.sales_strategy_post(next_id,next_token);
 exception when others then
  update private.sales_strategy_preparations set done=true where id=next_id;
  update public.sales_strategies set preparation_status='확인 필요',preparation_error='자동 재준비 서버 연결 복구 필요' where id=strategy;
 end;
 return true;
end $$;
revoke all on function private.sales_contact_restart(uuid) from public,anon,authenticated,service_role;
alter function public.sales_strategy_prepared(uuid,jsonb,text) rename to sales_strategy_prepared_before_contact_evidence;
revoke all on function public.sales_strategy_prepared_before_contact_evidence(uuid,jsonb,text) from public,anon,authenticated,service_role;
create function public.sales_strategy_prepared(p_id uuid,p_plan jsonb,p_error text default '') returns void language plpgsql security definer set search_path='' as $$
declare prep private.sales_strategy_preparations; strategy uuid;
begin
 select strategy_id into strategy from private.sales_strategy_preparations where id=p_id;
 perform 1 from public.sales_strategies where id=strategy for update;
 select * into prep from private.sales_strategy_preparations where id=p_id for update;
 if prep.id is null or not prep.claimed or prep.done then return;end if;
 if p_error='' and prep.contact_evidence is not null and prep.contact_evidence is distinct from private.sales_contact_evidence(strategy) then
  perform public.sales_strategy_prepared_before_contact_evidence(p_id,null,'준비 중 연락 근거 변경 · 최신 자료로 자동 재준비 필요');
  if prep.started_at>now()-interval '5 minutes' then perform private.sales_contact_restart(p_id);end if;
  return;
 end if;
 perform public.sales_strategy_prepared_before_contact_evidence(p_id,p_plan,p_error);
end $$;
revoke all on function public.sales_strategy_claim(uuid,uuid),public.sales_strategy_prepared(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_strategy_claim(uuid,uuid),public.sales_strategy_prepared(uuid,jsonb,text) to service_role;

-- Include the exact reviewed excerpts in the immutable execution material.
-- New/changed/withdrawn matching evidence invalidates a previously approved package.
alter function private.sales_execution_material(uuid) rename to sales_execution_material_before_contact_evidence;
create function private.sales_execution_material(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare material jsonb; payload jsonb; evidence jsonb; prepared_evidence jsonb; blockers jsonb;
begin
 material:=private.sales_execution_material_before_contact_evidence(p_id);if material is null then return null;end if;
 evidence:=private.sales_contact_evidence(p_id);
 select contact_evidence into prepared_evidence from private.sales_strategy_preparations where strategy_id=p_id;
 blockers:=material->'blockers';
 if prepared_evidence is not null and prepared_evidence is distinct from evidence then blockers:=blockers||jsonb_build_array('초안 작성 후 연락 근거 변경 · 최신 근거로 자동 재준비 필요');end if;
 payload:=(material->'payload')||jsonb_build_object('contact_evidence',evidence,'contact_evidence_prepared',prepared_evidence is not null and prepared_evidence=evidence);
 return material||jsonb_build_object('payload',payload,'blockers',blockers,'fingerprint',encode(sha256(convert_to(jsonb_build_array(payload,blockers)::text,'UTF8')),'hex'));
end $$;
revoke all on function private.sales_execution_material(uuid),private.sales_execution_material_before_contact_evidence(uuid) from public,anon,authenticated,service_role;
create function private.sales_contact_evidence_tick() returns void language plpgsql security definer set search_path='' as $$
declare candidate record; prep private.sales_strategy_preparations; checked integer:=0;
begin
 for candidate in select s.id,s.targets from public.sales_strategies s join private.sales_strategy_preparations p on p.strategy_id=s.id where s.created_at>now()-interval '30 days' and s.status in ('승인 대기','승인') and s.preparation_status='완료' and p.done and p.contact_evidence is not null order by s.execution_checked_at nulls first,s.id limit 20 for update of s skip locked loop
  select * into prep from private.sales_strategy_preparations where strategy_id=candidate.id for update;
  if prep.contact_evidence is distinct from private.sales_contact_evidence(candidate.id) and candidate.targets=private.sales_strategy_targets(candidate.id) then
   if prep.evidence_retries<1 then perform private.sales_contact_restart(prep.id);
   else update public.sales_strategies set preparation_status='확인 필요',preparation_error='연락 근거 재변경 · 자동 재준비 1회 한도 도달 · 재기획 범위 결정 필요',revision=revision+1 where id=candidate.id;end if;
   checked:=checked+1;if checked>=3 then exit;end if;
  end if;
 end loop;
end $$;
revoke all on function private.sales_contact_evidence_tick() from public,anon,authenticated,service_role;
select cron.schedule('wkly_sales_contact_evidence','*/5 * * * *','select private.sales_contact_evidence_tick()');
notify pgrst,'reload schema';
commit;
