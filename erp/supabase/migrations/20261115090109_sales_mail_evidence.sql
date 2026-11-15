-- Read-only provider evidence jobs. This never authorizes or enables outbound contact.
begin;
create table private.sales_mail_evidence_jobs(
 id uuid primary key default gen_random_uuid(),token uuid not null default gen_random_uuid(),strategy_id uuid not null references public.sales_strategies(id) on delete cascade,
 input_hash text not null,mailbox text not null,messages jsonb not null,
 state text not null default 'queued' check(state in ('queued','claimed','done','expired')),created_at timestamptz not null default now(),claimed_at timestamptz,finished_at timestamptz,result jsonb
);
create unique index sales_mail_evidence_active on private.sales_mail_evidence_jobs(strategy_id) where state in ('queued','claimed');
create index sales_mail_evidence_history on private.sales_mail_evidence_jobs(strategy_id,created_at desc);
revoke all on private.sales_mail_evidence_jobs from public,anon,authenticated,service_role;
alter function private.sales_contact_evidence(uuid) rename to sales_contact_evidence_before_mail;
create function private.sales_mail_evidence_input(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 with evidence as(select private.sales_contact_evidence_before_mail(p_id) e),pairs as(
 select c->>'email' email,m from evidence,jsonb_array_elements(e->'contacts') c,jsonb_array_elements(c->'mail') m
 where c->>'email'<>'' and not (c->>'excluded')::boolean and not (c->>'ambiguous')::boolean
 and m->>'id' ~ '^[a-fA-F0-9]{1,32}$' and m->>'thread_id' ~ '^[a-fA-F0-9]{1,32}$'
 ),grouped as(select m->>'id' id,m->>'thread_id' thread_id,max(m->>'sent_at') sent_at,jsonb_agg(distinct email order by email) emails from pairs group by 1,2),limited as(select * from grouped order by sent_at desc,id limit 5)
 select jsonb_build_object('input_hash',encode(sha256(convert_to((select e::text from evidence),'UTF8')),'hex'),
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'thread_id',thread_id,'emails',emails) order by sent_at desc,id),'[]') from limited))
$$;
create function private.sales_mail_evidence_tick() returns void language plpgsql security definer set search_path='' as $$
declare candidate record; packet jsonb; sender text; gateway text;run uuid;run_token uuid;started integer:=0;
begin
 -- Serializes scheduler invocations without holding shared business-table locks.
 if not pg_try_advisory_xact_lock(903150109) then return;end if;
 update private.sales_mail_evidence_jobs set state='expired',finished_at=now() where state in ('queued','claimed') and created_at<now()-interval '3 minutes';
 -- Prior configured mailbox selects the job; the worker rechecks live scope/profile on EVERY read.
 select email into sender from private.sales_sender_readiness where id and can_read and code in ('ready','read_only');
 if sender is null then return;end if;
 select btrim(decrypted_secret) into gateway from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 if coalesce(gateway,'')='' then return;end if;
 for candidate in select s.id from public.sales_strategies s where s.created_at>now()-interval '30 days' and s.status in ('승인 대기','승인')
 and not exists(select 1 from private.sales_mail_evidence_jobs j where j.strategy_id=s.id and j.state in ('queued','claimed'))
 and (select count(*) from private.sales_mail_evidence_jobs j where j.strategy_id=s.id and j.created_at>now()-interval '24 hours')<3
 and not exists(select 1 from private.sales_mail_evidence_jobs j where j.strategy_id=s.id and j.created_at>now()-interval '15 minutes')
 and jsonb_array_length(private.sales_mail_evidence_input(s.id)->'messages')>0
 and not exists(select 1 from private.sales_mail_evidence_jobs j where j.strategy_id=s.id and j.mailbox=sender and j.input_hash=private.sales_mail_evidence_input(s.id)->>'input_hash' and j.state='done' and j.finished_at>now()-interval '24 hours' and j.result->>'status' in ('complete','partial') and not exists(select 1 from jsonb_array_elements(j.result->'messages') m where m->>'status'='unavailable'))
 order by (select max(j.created_at) from private.sales_mail_evidence_jobs j where j.strategy_id=s.id) nulls first,s.id limit 20 loop
  packet:=private.sales_mail_evidence_input(candidate.id);
  if jsonb_array_length(packet->'messages')=0 or exists(select 1 from private.sales_mail_evidence_jobs j where j.strategy_id=candidate.id and j.mailbox=sender and j.input_hash=packet->>'input_hash' and j.state='done' and j.finished_at>now()-interval '24 hours' and j.result->>'status' in ('complete','partial') and not exists(select 1 from jsonb_array_elements(j.result->'messages') m where m->>'status'='unavailable')) then continue;end if;
  insert into private.sales_mail_evidence_jobs(strategy_id,input_hash,mailbox,messages) values(candidate.id,packet->>'input_hash',sender,packet->'messages') returning id,token into run,run_token;
  begin
   perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-mail-evidence',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,'apikey',gateway),body:=jsonb_build_object('id',run,'token',run_token),timeout_milliseconds:=10000);
  exception when others then update private.sales_mail_evidence_jobs set state='expired',finished_at=now() where id=run;end;
  started:=started+1;if started>=3 then exit;end if;
 end loop;
end $$;
create function public.sales_mail_evidence_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.sales_mail_evidence_jobs;
begin
 select * into job from private.sales_mail_evidence_jobs where id=p_id and token=p_token and state='queued' and created_at>now()-interval '3 minutes' for update;
 if job.id is null then return null;end if;
 if not exists(select 1 from public.sales_strategies where id=job.strategy_id and status in ('승인 대기','승인')) or not exists(select 1 from private.sales_sender_readiness where id and email=job.mailbox and can_read) or job.input_hash is distinct from private.sales_mail_evidence_input(job.strategy_id)->>'input_hash' then
  update private.sales_mail_evidence_jobs set state='expired',finished_at=now() where id=p_id;return null;
 end if;
 update private.sales_mail_evidence_jobs set state='claimed',claimed_at=now() where id=p_id;
 return jsonb_build_object('mailbox',job.mailbox,'messages',job.messages);
end $$;
create function public.sales_mail_evidence_finish(p_id uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare job private.sales_mail_evidence_jobs; m jsonb;seen text[]:='{}';
begin
 select * into job from private.sales_mail_evidence_jobs where id=p_id for update;
 if job.id is null or job.state<>'claimed' or job.created_at<=now()-interval '3 minutes' then raise exception 'Evidence lease expired' using errcode='PT409';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or p_result-ARRAY['status','messages']<>'{}' or coalesce(p_result->>'status','') not in ('complete','partial','account_unavailable') or jsonb_typeof(p_result->'messages') is distinct from 'array' or pg_column_size(p_result)>150000 then raise exception 'Invalid evidence result';end if;
 if p_result->>'status'='account_unavailable' then
  if jsonb_array_length(p_result->'messages')<>0 then raise exception 'Invalid failure evidence';end if;
 else
  if jsonb_array_length(p_result->'messages')<>jsonb_array_length(job.messages) then raise exception 'Incomplete evidence result';end if;
  for m in select value from jsonb_array_elements(p_result->'messages') loop
   if jsonb_typeof(m) is distinct from 'object' or m-ARRAY['id','status','text','truncated','direction']<>'{}' or coalesce(m->>'status','') not in ('retrieved','unsupported','unavailable','mismatch') or jsonb_typeof(m->'text') is distinct from 'string' or length(m->>'text')>6000 or jsonb_typeof(m->'truncated') is distinct from 'boolean' or m->>'id'=any(seen) or not exists(select 1 from jsonb_array_elements(job.messages) v where v->>'id'=m->>'id') then raise exception 'Invalid message evidence';end if;
   if m->>'status'='retrieved' then
    if coalesce(m->>'direction','') not in ('inbound','outbound') or length(btrim(m->>'text'))=0 then raise exception 'Missing retrieved text';end if;
   elsif m->>'text'<>'' or (m->>'truncated')::boolean or jsonb_typeof(m->'direction') is distinct from 'null' then raise exception 'Unexpected failure text';end if;
   if p_result->>'status'='complete' and (m->>'status'<>'retrieved' or (m->>'truncated')::boolean) then raise exception 'Incomplete complete result';end if;
   seen:=array_append(seen,m->>'id');
  end loop;
 end if;
 -- Target changes/opt-outs or mailbox changes while reading discard the result.
 if job.input_hash is distinct from private.sales_mail_evidence_input(job.strategy_id)->>'input_hash' or not exists(select 1 from public.sales_strategies where id=job.strategy_id and status in ('승인 대기','승인')) or not exists(select 1 from private.sales_sender_readiness where id and email=job.mailbox) then
  update private.sales_mail_evidence_jobs set state='expired',finished_at=now() where id=p_id;return;
 end if;
 update private.sales_mail_evidence_jobs set state='done',finished_at=now(),result=p_result where id=p_id;
end $$;
create function private.sales_contact_evidence(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare packet jsonb:=private.sales_contact_evidence_before_mail(p_id);job private.sales_mail_evidence_jobs;contacts jsonb;
begin
 select * into job from private.sales_mail_evidence_jobs j where j.strategy_id=p_id and j.state='done' and j.result->>'status' in ('complete','partial') and j.input_hash=private.sales_mail_evidence_input(p_id)->>'input_hash' and j.finished_at>now()-interval '24 hours' and exists(select 1 from private.sales_sender_readiness where id and email=j.mailbox) order by j.created_at desc limit 1;
 select coalesce(jsonb_agg(c||jsonb_build_object('mail',(select coalesce(jsonb_agg(m||jsonb_build_object('body',(select value||jsonb_build_object('retrieved_at',(select min(first_seen.finished_at) from private.sales_mail_evidence_jobs first_seen where first_seen.strategy_id=p_id and first_seen.mailbox=job.mailbox and first_seen.input_hash=job.input_hash and first_seen.state='done' and first_seen.result=job.result)) from jsonb_array_elements(job.result->'messages') where value->>'id'=m->>'id')) order by ordinal),'[]') from jsonb_array_elements(c->'mail') with ordinality mails(m,ordinal))) order by ordinal),'[]') into contacts from jsonb_array_elements(packet->'contacts') with ordinality contact(c,ordinal);
 return packet||jsonb_build_object('contacts',contacts,'body_scope','자동 원문 조회: 기획안별 최신 메일 최대 5건 · 일반 텍스트 최대 6,000자 · 첨부·HTML 전용·다중 수신자 미지원. 발신 진위·요청 의사·수신 자격은 별도 검증.');
end $$;
revoke all on function private.sales_mail_evidence_input(uuid),private.sales_mail_evidence_tick(),private.sales_contact_evidence(uuid),private.sales_contact_evidence_before_mail(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sales_mail_evidence_claim(uuid,uuid),public.sales_mail_evidence_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_mail_evidence_claim(uuid,uuid),public.sales_mail_evidence_finish(uuid,jsonb) to service_role;
alter function public.sales_execution_get(uuid) rename to sales_execution_get_before_mail;
revoke all on function public.sales_execution_get_before_mail(uuid) from public,anon,authenticated,service_role;
create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;job private.sales_mail_evidence_jobs;attempts integer;note text;
begin
 result:=public.sales_execution_get_before_mail(p_id);if result is null then return null;end if;
 select * into job from private.sales_mail_evidence_jobs where strategy_id=p_id order by created_at desc limit 1;
 select count(*) into attempts from private.sales_mail_evidence_jobs where strategy_id=p_id and created_at>now()-interval '24 hours';
 note:=case when not exists(select 1 from private.sales_sender_readiness where id and can_read) then '회사 계정 읽기 권한 점검 필요 · 연결 점검 후 자동 조회'
 when job.state in ('queued','claimed') and job.created_at>now()-interval '3 minutes' then '원문 자동 조회 대기·처리 중'
 when job.state='done' and job.result->>'status' in ('complete','partial') and job.finished_at>now()-interval '24 hours' and job.input_hash=private.sales_mail_evidence_input(p_id)->>'input_hash' then '조회 결과 저장 · 확보 범위와 대상별 제한은 아래 근거에서 확인'
 when attempts>=3 then '24시간 3회 조회 한도 · 다음 허용 시각에 자동 재확인'
 when jsonb_array_length(private.sales_mail_evidence_input(p_id)->'messages')=0 then '조회 가능한 저장 메일 없음 · 공식 연락 창구 추가 확보 필요'
 else '다음 예약에서 자동 조회 · 실패 시 최소 15분 간격으로 재시도' end;
 return result||jsonb_build_object('mail_evidence',jsonb_build_object('state',coalesce(job.state,'waiting'),'attempts',attempts,'checked_at',job.finished_at,'note',note));
end $$;
revoke all on function public.sales_execution_get(uuid) from public,anon;
grant execute on function public.sales_execution_get(uuid) to authenticated;
select cron.schedule('wkly_sales_mail_evidence','*/5 * * * *','select private.sales_mail_evidence_tick()');
notify pgrst,'reload schema';
commit;
