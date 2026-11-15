-- Sales-owned receipt/reply ledger. No outbound transport or automatic follow-up sends.
begin;
create table private.sales_crm_threads(
 dispatch_id uuid primary key references private.sales_dispatch_jobs(id),strategy_id uuid not null references public.sales_strategies(id),
 mailbox text not null,recipient text not null,provider_id text not null,sent_at timestamptz not null,
 stage text not null default '접수 확인' check(stage in ('접수 확인','회신 확인','연락 중단')),
 next_action text not null default '시스템이 동일 대화의 회신을 자동 확인합니다. 후속 발송은 별도 승인 전 미실행.',
 last_reply_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table private.sales_reply_jobs(
 id uuid primary key default gen_random_uuid(),token uuid not null default gen_random_uuid(),dispatch_id uuid not null references private.sales_crm_threads(dispatch_id),
 mailbox text not null,messages jsonb not null,input_hash text not null,
 state text not null default 'queued' check(state in ('queued','claimed','done','expired')),
 created_at timestamptz not null default now(),finished_at timestamptz,result jsonb
);
create unique index sales_reply_active on private.sales_reply_jobs(dispatch_id) where state in ('queued','claimed');
create index sales_reply_history on private.sales_reply_jobs(dispatch_id,created_at desc);
create table private.sales_crm_replies(
 dispatch_id uuid not null references private.sales_crm_threads(dispatch_id),message_id text not null,
 text text not null,signal text not null check(signal in ('reply','stop','limited')),received_at timestamptz not null,recorded_at timestamptz not null default now(),
 primary key(dispatch_id,message_id)
);
create table private.sales_contact_suppressions(
 recipient text primary key,dispatch_id uuid not null references private.sales_crm_threads(dispatch_id),message_id text not null,
 reason text not null,created_at timestamptz not null default now()
);
revoke all on private.sales_crm_threads,private.sales_reply_jobs,private.sales_crm_replies,private.sales_contact_suppressions from public,anon,authenticated,service_role;

create function private.sales_crm_record(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into private.sales_crm_threads(dispatch_id,strategy_id,mailbox,recipient,provider_id,sent_at)
 select j.id,j.strategy_id,lower(p.payload->>'sender'),j.recipient,j.provider_id,j.finished_at
 from private.sales_dispatch_jobs j join public.sales_execution_packages p on p.id=j.package_id
 where j.id=p_id and j.state='accepted' and j.provider_id ~ '^[a-fA-F0-9]{1,32}$' and p.payload->>'sender' is not null and j.finished_at is not null
 on conflict(dispatch_id) do nothing;
end $$;
create function private.sales_crm_after_dispatch() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.state='accepted' then perform private.sales_crm_record(new.id);end if;return new;end $$;
create trigger sales_crm_after_dispatch after update of state on private.sales_dispatch_jobs for each row execute function private.sales_crm_after_dispatch();

-- Only stored, exact-address matches in the provider-confirmed outbound thread are read.
create function private.sales_reply_input(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 with eligible as(
 select m.id,m.thread_id,m.sent_at,c.recipient,c.mailbox,c.sent_at sent_time,c.dispatch_id
 from private.sales_crm_threads c join public.mail_index sent on sent.id=c.provider_id
 join public.mail_index m on m.thread_id=sent.thread_id
 where c.dispatch_id=p_id and sent.thread_id ~ '^[a-fA-F0-9]{1,32}$' and 'SENT'=any(sent.labels) and not sent.labels&&array['DRAFT','SPAM','TRASH']
 and lower(btrim(sent.from_addr))=c.mailbox and lower(btrim(sent.to_addr))=c.recipient
 and m.id<>sent.id and m.id ~ '^[a-fA-F0-9]{1,32}$' and lower(btrim(m.from_addr))=c.recipient and lower(btrim(m.to_addr))=c.mailbox
 and m.sent_at>=c.sent_at and m.sent_at<=now() and not m.labels&&array['SENT','DRAFT','SPAM','TRASH']
 and not exists(select 1 from private.sales_crm_replies r where r.dispatch_id=p_id and r.message_id=m.id)
 order by m.sent_at,m.id limit 5
 ),packet as(select coalesce(jsonb_agg(jsonb_build_object('id',id,'thread_id',thread_id,'emails',jsonb_build_array(recipient),'reply_to','<wkly-sales-'||dispatch_id::text||'@'||split_part(mailbox,'@',2)||'>','not_before',floor(extract(epoch from sent_time)*1000)) order by sent_at,id),'[]') messages from eligible)
 select jsonb_build_object('messages',messages,'input_hash',encode(sha256(convert_to(messages::text,'UTF8')),'hex')) from packet
$$;
create function private.sales_reply_tick() returns void language plpgsql security definer set search_path='' as $$
declare c record;packet jsonb;gateway text;run uuid;run_token uuid;started integer:=0;
begin
 if not pg_try_advisory_xact_lock(903150111) then return;end if;
 update private.sales_reply_jobs set state='expired',finished_at=now() where state in ('queued','claimed') and created_at<now()-interval '3 minutes';
 for c in select id from private.sales_dispatch_jobs j where state='accepted' and finished_at>now()-interval '30 days' and not exists(select 1 from private.sales_crm_threads where dispatch_id=j.id) order by finished_at limit 20 loop perform private.sales_crm_record(c.id);end loop;
 select btrim(decrypted_secret) into gateway from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 if coalesce(gateway,'')='' then return;end if;
 for c in select t.* from private.sales_crm_threads t where t.sent_at>now()-interval '30 days' and t.stage<>'연락 중단'
 and exists(select 1 from private.sales_sender_readiness where id and can_read and email=t.mailbox)
 and not exists(select 1 from private.sales_reply_jobs j where j.dispatch_id=t.dispatch_id and j.state in ('queued','claimed'))
 and not exists(select 1 from private.sales_reply_jobs j where j.dispatch_id=t.dispatch_id and j.created_at>now()-interval '15 minutes')
 and (select count(*) from private.sales_reply_jobs j where j.dispatch_id=t.dispatch_id and j.created_at>now()-interval '24 hours')<3
 order by (select max(j.created_at) from private.sales_reply_jobs j where j.dispatch_id=t.dispatch_id) nulls first,t.dispatch_id limit 20 loop
  packet:=private.sales_reply_input(c.dispatch_id);
  if jsonb_array_length(packet->'messages')=0 or exists(select 1 from private.sales_reply_jobs j where j.dispatch_id=c.dispatch_id and j.input_hash=packet->>'input_hash' and j.state='done' and j.finished_at>now()-interval '24 hours' and j.result->>'status'<>'account_unavailable' and not exists(select 1 from jsonb_array_elements(j.result->'messages') m where m->>'status'='unavailable')) then continue;end if;
  insert into private.sales_reply_jobs(dispatch_id,mailbox,messages,input_hash) values(c.dispatch_id,c.mailbox,packet->'messages',packet->>'input_hash') returning id,token into run,run_token;
  begin
   perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-replies',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,'apikey',gateway),body:=jsonb_build_object('id',run,'token',run_token),timeout_milliseconds:=10000);
  exception when others then update private.sales_reply_jobs set state='expired',finished_at=now() where id=run;end;
  started:=started+1;if started>=3 then exit;end if;
 end loop;
end $$;
create function public.sales_reply_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_reply_jobs;
begin
 select * into j from private.sales_reply_jobs where id=p_id and token=p_token and state='queued' and created_at>now()-interval '3 minutes' for update;
 if j.id is null then return null;end if;
 if j.input_hash is distinct from private.sales_reply_input(j.dispatch_id)->>'input_hash' or not exists(select 1 from private.sales_sender_readiness where id and can_read and email=j.mailbox) then update private.sales_reply_jobs set state='expired',finished_at=now() where id=p_id;return null;end if;
 update private.sales_reply_jobs set state='claimed' where id=p_id;
 return jsonb_build_object('mailbox',j.mailbox,'messages',j.messages);
end $$;
create function public.sales_reply_finish(p_id uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_reply_jobs;c private.sales_crm_threads;m jsonb;seen text[]:='{}';own_text text;signal text;received timestamptz;
begin
 select * into j from private.sales_reply_jobs where id=p_id for update;
 if j.id is null or j.state<>'claimed' or j.created_at<=now()-interval '3 minutes' then raise exception 'Reply lease expired' using errcode='PT409';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or p_result-ARRAY['status','messages']<>'{}' or coalesce(p_result->>'status','') not in ('complete','partial','account_unavailable') or jsonb_typeof(p_result->'messages') is distinct from 'array' or pg_column_size(p_result)>150000 then raise exception 'Invalid reply result';end if;
 if p_result->>'status'='account_unavailable' then
  if jsonb_array_length(p_result->'messages')<>0 then raise exception 'Invalid failure result';end if;
 else
  if jsonb_array_length(p_result->'messages')<>jsonb_array_length(j.messages) then raise exception 'Incomplete reply result';end if;
  for m in select value from jsonb_array_elements(p_result->'messages') loop
   if jsonb_typeof(m) is distinct from 'object' or m-ARRAY['id','status','text','truncated','direction']<>'{}' or coalesce(m->>'status','') not in ('retrieved','unsupported','unavailable','mismatch') or jsonb_typeof(m->'text') is distinct from 'string' or length(m->>'text')>6000 or jsonb_typeof(m->'truncated') is distinct from 'boolean' or m->>'id'=any(seen) or not exists(select 1 from jsonb_array_elements(j.messages) v where v->>'id'=m->>'id') then raise exception 'Invalid reply evidence';end if;
   if m->>'status'='retrieved' then
    if m->>'direction' is distinct from 'inbound' or length(btrim(m->>'text'))=0 then raise exception 'Inbound reply required';end if;
   elsif m->>'text'<>'' or (m->>'truncated')::boolean or jsonb_typeof(m->'direction') is distinct from 'null' then raise exception 'Unexpected failure text';end if;
   if p_result->>'status'='complete' and (m->>'status'<>'retrieved' or (m->>'truncated')::boolean) then raise exception 'Incomplete complete result';end if;
   seen:=array_append(seen,m->>'id');
  end loop;
 end if;
 if j.input_hash is distinct from private.sales_reply_input(j.dispatch_id)->>'input_hash' or not exists(select 1 from private.sales_sender_readiness where id and can_read and email=j.mailbox) then update private.sales_reply_jobs set state='expired',finished_at=now() where id=p_id;return;end if;
 select * into c from private.sales_crm_threads where dispatch_id=j.dispatch_id for update;
 for m in select value from jsonb_array_elements(p_result->'messages') where value->>'status'='retrieved' loop
  -- Examine only the leading authored portion. Matching is conservative and never grants consent.
  own_text:=lower(regexp_replace(m->>'text',E'\\r\\n?',E'\n','g'));
  own_text:=(regexp_split_to_array(own_text,E'(^|\n)>'))[1];
  own_text:=(regexp_split_to_array(own_text,E'\n(on .+wrote:|.*님.*작성:|[-]+original message[-]+|[-]+forwarded message[-]+|보낸 사람:|from:)'))[1];
  signal:=case when own_text ~ '(수신[[:space:]]*거부|메일.{0,12}보내지[[:space:]]*마|연락.{0,12}(중단|하지[[:space:]]*마)|unsubscribe|do not (email|contact)|stop (emailing|contacting)|remove me from)' then 'stop' when (m->>'truncated')::boolean then 'limited' else 'reply' end;
  select sent_at into received from public.mail_index where id=m->>'id';
  insert into private.sales_crm_replies(dispatch_id,message_id,text,signal,received_at) values(c.dispatch_id,m->>'id',m->>'text',signal,received) on conflict do nothing;
  if signal='stop' then
   insert into private.sales_contact_suppressions(recipient,dispatch_id,message_id,reason) values(c.recipient,c.dispatch_id,m->>'id','회신 본문에 연락 중단 표현 감지 · 오분류 가능성은 별도 예외 검토, 재발송은 차단') on conflict do nothing;
   update private.sales_crm_threads set stage='연락 중단',next_action='연락 중단 표현 감지 · 후속 발송 차단. 의사·계약 상태를 추정하지 않습니다.',updated_at=now() where recipient=c.recipient;
   with cancelled as(update private.sales_dispatch_jobs set state='cancelled',reason='연락 중단 회신 감지 · 후속 발송 차단',finished_at=now() where recipient=c.recipient and state='queued' returning id)
   insert into private.sales_dispatch_events(job_id,state,note) select id,'cancelled','연락 중단 회신 감지 · 후속 발송 차단' from cancelled;
  else
   update private.sales_crm_threads set stage=case when stage='연락 중단' then stage else '회신 확인' end,
    next_action=case when stage='연락 중단' then next_action when signal='limited' then '원문 일부만 확보 · 시스템 추가 검증 필요. 후속 발송 미실행.' else '회신 원문 저장 · 시스템이 요청 범위·다음 제안을 검증할 대상. 구매 의향·미팅·수주 확정 아님. 후속 발송 미실행.' end,updated_at=now() where dispatch_id=c.dispatch_id;
  end if;
  update private.sales_crm_threads set last_reply_at=greatest(last_reply_at,received),updated_at=now() where dispatch_id=c.dispatch_id;
 end loop;
 update private.sales_reply_jobs set state='done',finished_at=now(),result=p_result where id=p_id;
end $$;
-- Stops apply across new execution versions. Already in-flight provider calls cannot be recalled.
alter function private.sales_dispatch_blocker(public.sales_execution_packages) rename to sales_dispatch_blocker_before_replies;
create function private.sales_dispatch_blocker(p public.sales_execution_packages) returns text language plpgsql stable set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements(p.payload->'messages') m join private.sales_contact_suppressions s on s.recipient=lower(btrim(m->>'recipient'))) then return '연락 중단 회신 감지 · 발송 차단';end if;
 return private.sales_dispatch_blocker_before_replies(p);
end $$;
alter function public.sales_execution_get(uuid) rename to sales_execution_get_before_replies;
create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.sales_execution_get_before_replies(p_id);if result is null then return null;end if;
 return result||jsonb_build_object('crm',jsonb_build_object('scope','제공사 접수 후 동일 주소·대화·답장 참조를 대조합니다. 최근 30일, 건별 24시간 최대 3회·한 번에 5개 원문. 발신 진위·구매 의향·계약 확정은 별도 검증. 자동 후속 발송 없음.',
 'threads',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from (
 select c.dispatch_id,c.recipient,c.stage,c.next_action,c.last_reply_at,c.created_at,
 case when c.stage='연락 중단' then '연락 중단 · 후속 발송 차단'
 when c.sent_at<=now()-interval '30 days' then '30일 자동 조회 범위 종료 · 장기 후속 실행안 연결 개발 중'
 when not exists(select 1 from private.sales_sender_readiness where id and can_read and email=c.mailbox) then '계정 읽기 연결 복구 후 시스템이 자동 재확인'
 when (select count(*) from private.sales_reply_jobs j where j.dispatch_id=c.dispatch_id and j.created_at>now()-interval '24 hours')>=3 then '24시간 조회 한도 · 다음 허용 시각에 자동 재확인'
 when jsonb_array_length(private.sales_reply_input(c.dispatch_id)->'messages')=0 then '현재 색인에 미처리 회신 없음 · 메일 동기화 후 다시 대조'
 else '원문 자동 대조 대상 · 실패는 최소 15분 간격으로 재시도, 지원하지 않는 형식은 다음 날 재확인' end read_note,
 (select max(j.finished_at) from private.sales_reply_jobs j where j.dispatch_id=c.dispatch_id) checked_at,
 (select count(*) from private.sales_crm_replies r where r.dispatch_id=c.dispatch_id) reply_count,
 (select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select message_id,signal,text,received_at from private.sales_crm_replies where dispatch_id=c.dispatch_id order by received_at desc limit 5) r) replies
 from private.sales_crm_threads c where c.strategy_id=p_id order by c.created_at desc limit 100) x)));
end $$;
revoke all on function private.sales_crm_record(uuid),private.sales_crm_after_dispatch(),private.sales_reply_input(uuid),private.sales_reply_tick(),private.sales_dispatch_blocker(public.sales_execution_packages),private.sales_dispatch_blocker_before_replies(public.sales_execution_packages),public.sales_execution_get_before_replies(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sales_reply_claim(uuid,uuid),public.sales_reply_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_reply_claim(uuid,uuid),public.sales_reply_finish(uuid,jsonb) to service_role;
revoke all on function public.sales_execution_get(uuid) from public,anon;
grant execute on function public.sales_execution_get(uuid) to authenticated;

alter function private.sales_execution_summary() rename to sales_execution_summary_before_replies;
create function private.sales_execution_summary() returns jsonb language sql stable set search_path='' as $$
 select private.sales_execution_summary_before_replies()||jsonb_build_object('crm',jsonb_build_object('scope','최근 30일 제공사 접수 기록 · 도착·열람 미확인','accepted',count(*),'replied',count(*) filter(where last_reply_at is not null),'stopped',count(*) filter(where stage='연락 중단')),
 'note','실제 발송 연결은 미완료입니다. CRM은 제공사 접수·대조한 회신만 기록하며 준비 건수·구매 의향·수주와 구분합니다.') from private.sales_crm_threads where sent_at>now()-interval '30 days'
$$;
revoke all on function private.sales_execution_summary(),private.sales_execution_summary_before_replies() from public,anon,authenticated,service_role;
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
  perform public.notify(actor.id,'일일 보고','AI 영업 기획 브리핑',format('오늘 기획 검토 대기 %s건 · 자동 준비 중 %s건 · 복구 필요 %s건. 최근 30일 실행안: 검증 대기 %s건 · 재검토 %s건 · 보류 %s건. CRM 접수 %s건 · 대조 회신 %s건 · 연락 중단 %s건. 실제 발송 연결 전이며 접수는 도착·열람·수주 확인이 아닙니다.',ready,pending,failed,execution->>'needs_verification',execution->>'recheck',execution->>'held',execution->'crm'->>'accepted',execution->'crm'->>'replied',execution->'crm'->>'stopped'),'/sales');
 end loop;
end $$;
select cron.schedule('wkly_sales_replies','*/5 * * * *','select private.sales_reply_tick()');
notify pgrst,'reload schema';
commit;
