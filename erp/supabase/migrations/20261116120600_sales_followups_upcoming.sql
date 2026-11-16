-- 2026-11-16 대표 지시 '수집과 기획 실행을 더 디벨롭해, 특히 실행이 부족해'.
-- ① 실행: 승인한 메일에 후속 연락 2회를 함께 묶는다(4·10영업일 뒤 오전 10시, 같은 메일 대화 안에서).
--    후속 문안은 실행 묶음에 들어가 미리보기와 함께 대표가 승인한다. 상대가 회신하거나, 수신 거부를 하거나,
--    대표가 묶음을 보류하거나, 첫 메일이 접수되지 않았으면 자동으로 취소한다. 발송 스위치가 꺼져 있으면 보내지 않는다.
-- ② 수집: 이미 열린 팝업보다 '열릴 예정'인 행사·모집 소식을 찾는 뉴스 검색어 묶음을 추가한다(3시간마다 4묶음 순환).
begin;
-- ② 뉴스 검색어 4번째 묶음: 오픈 예정 · 모집 · 대행사 선정
do $$
declare def text;
begin
 def:=pg_get_functiondef('private.sales_news_queue()'::regprocedure);
 if position('행사 대행사 선정' in def)=0 then
  if position(')%3 when 0 then' in def)=0 or position('else array[''팝업스토어 운영''' in def)=0 then raise exception 'Unexpected news queue';end if;
  def:=replace(def,')%3 when 0 then',')%4 when 0 then');
  def:=replace(def,'else array[''팝업스토어 운영''','when 2 then array[''팝업스토어 운영''');
  def:=replace(def,'''식음료 팝업''] end)','''식음료 팝업''] else array[''팝업 오픈 예정'',''팝업스토어 오픈 예정'',''다음달 팝업'',''연말 팝업 예정'',''신규 매장 오픈 예정'',''팝업 입점 모집'',''행사 대행사 선정'',''박람회 참가 기업 모집''] end)');
  if position('박람회 참가 기업 모집' in def)=0 then raise exception 'Unexpected news queue words';end if;
  execute def;
 end if;
end $$;

-- ① 영업일 계산: n영업일 뒤 오전 10시(한국 시간)
create or replace function private.sales_business_day(p_from timestamptz,p_days integer) returns timestamptz language plpgsql stable set search_path='' as $$
declare d date:=(p_from at time zone 'Asia/Seoul')::date;n integer:=0;
begin
 while n<p_days loop d:=d+1; if extract(isodow from d)<6 then n:=n+1;end if;end loop;
 return (d+time '10:00') at time zone 'Asia/Seoul';
end $$;

create or replace function private.sales_followup_texts(p_title text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_array(
  jsonb_build_object('seq',1,'after_business_days',4,'body',
   '담당자님께'||E'\n\n'||'앞서 보내드린 '''||left(p_title,80)||''' 수행 계획을 검토하실 시간이 있으셨는지 여쭙고자 다시 연락드립니다.'||E'\n\n'||
   '일정이 맞으시면 20~30분 온라인 미팅으로 진행 방식과 견적 조건을 설명드리겠습니다. 담당 부서가 따로 있으시면 안내 부탁드립니다.'||E'\n\n'||
   '원치 않으시면 회신으로 알려 주시기 바랍니다. 이후 연락드리지 않겠습니다.'||E'\n\n'||'더위클리 · 아트리어디자인스튜디오 드림'),
  jsonb_build_object('seq',2,'after_business_days',10,'body',
   '담당자님께'||E'\n\n'||''''||left(p_title,80)||''' 관련해 마지막으로 한 번 더 연락드립니다.'||E'\n\n'||
   '지금은 시기가 맞지 않으시더라도, 팝업·행사·공간 연출이 필요하실 때 회신 주시면 바로 일정과 견적을 준비하겠습니다. 이후에는 먼저 연락드리지 않겠습니다.'||E'\n\n'||'더위클리 · 아트리어디자인스튜디오 드림'))
$$;

-- 실행 묶음에 후속 문안 포함 (승인 대상 · 지문에 포함)
do $$
begin
 if to_regprocedure('private.sales_execution_material_before_followups(uuid)') is null then
  alter function private.sales_execution_material(uuid) rename to sales_execution_material_before_followups;
 end if;
end $$;
create or replace function private.sales_execution_material(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare m jsonb:=private.sales_execution_material_before_followups(p_id);payload jsonb;
begin
 if m is null then return null;end if;
 payload:=m->'payload';
 if coalesce((payload->>'test_run')::boolean,false) or not exists(select 1 from jsonb_array_elements(coalesce(payload->'messages','[]')) x where coalesce(x->>'channel','email')='email') then return m;end if;
 payload:=payload||jsonb_build_object('followups',private.sales_followup_texts(coalesce(nullif(payload->>'title',''),payload#>>'{messages,0,subject}','제안')),
  'schedule',coalesce(payload->'schedule','{}')||jsonb_build_object('followups','후속 2회 · 4·10영업일 뒤 오전 10시 · 같은 메일 대화 · 회신·수신 거부·보류 시 자동 취소'));
 return jsonb_build_object('payload',payload,'blockers',m->'blockers','fingerprint',encode(sha256(convert_to(jsonb_build_array(payload,m->'blockers')::text,'UTF8')),'hex'));
end $$;
revoke all on function private.sales_execution_material(uuid),private.sales_execution_material_before_followups(uuid),private.sales_followup_texts(text),private.sales_business_day(timestamptz,integer) from public,anon,authenticated,service_role;

create table if not exists private.sales_followups(
 id uuid primary key default gen_random_uuid(),
 dispatch_id uuid not null references private.sales_dispatch_jobs(id),
 seq integer not null check(seq in (1,2)),
 strategy_id uuid not null,package_id uuid not null,recipient text not null,sender text not null,
 subject text not null,body text not null,
 scheduled_at timestamptz not null,expires_at timestamptz not null,
 state text not null default 'queued' check(state in ('queued','claimed','accepted','rejected','unknown','cancelled')),
 reason text not null default '후속 연락 대기',claim_token uuid,handed_at timestamptz,claimed_at timestamptz,finished_at timestamptz,provider_id text,
 created_at timestamptz not null default now(),
 unique(dispatch_id,seq)
);
create index if not exists sales_followups_due on private.sales_followups(state,scheduled_at);
alter table private.sales_followups enable row level security;
revoke all on private.sales_followups from public,anon,authenticated,service_role;

-- 첫 메일이 접수되면 승인된 후속 문안으로 예약
create or replace function private.sales_followup_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.sales_execution_packages;f jsonb;
begin
 if new.state<>'accepted' or old.state='accepted' or coalesce(new.message->>'channel','email')<>'email' then return new;end if;
 select * into p from public.sales_execution_packages where id=new.package_id;
 if p.id is null or jsonb_typeof(p.payload->'followups') is distinct from 'array' then return new;end if;
 for f in select value from jsonb_array_elements(p.payload->'followups') loop
  insert into private.sales_followups(dispatch_id,seq,strategy_id,package_id,recipient,sender,subject,body,scheduled_at,expires_at)
  values(new.id,(f->>'seq')::integer,new.strategy_id,p.id,new.recipient,lower(p.payload->>'sender'),left('Re: '||coalesce(new.message->>'subject',''),200),f->>'body',
   private.sales_business_day(coalesce(new.finished_at,now()),(f->>'after_business_days')::integer),
   private.sales_business_day(coalesce(new.finished_at,now()),(f->>'after_business_days')::integer)+interval '5 hours')
  on conflict(dispatch_id,seq) do nothing;
 end loop;
 return new;
end $$;
revoke all on function private.sales_followup_schedule() from public,anon,authenticated,service_role;
drop trigger if exists sales_followup_schedule on private.sales_dispatch_jobs;
create trigger sales_followup_schedule after update of state on private.sales_dispatch_jobs for each row execute function private.sales_followup_schedule();

-- 보내도 되는지: 회신 · 수신 거부 · 보류 · 첫 메일 · 앞 순서 후속 확인
create or replace function private.sales_followup_block(f private.sales_followups) returns text language plpgsql stable set search_path='' as $$
begin
 if not exists(select 1 from private.sales_dispatch_jobs j where j.id=f.dispatch_id and j.state='accepted') then return '첫 메일 접수 미확인 · 후속 취소';end if;
 if not exists(select 1 from public.sales_execution_packages p where p.id=f.package_id and p.status='승인') then return '실행 묶음 보류·변경 · 후속 취소';end if;
 if exists(select 1 from private.sales_crm_threads c where c.dispatch_id=f.dispatch_id and (c.last_reply_at is not null or c.stage<>'접수 확인')) then return '상대 회신 확인 · 후속 자동 연락 중단';end if;
 if exists(select 1 from private.sales_contact_suppressions s where s.recipient=f.recipient) or exists(select 1 from public.brand_contacts b where b.opt_out and lower(btrim(b.email))=f.recipient) then return '수신 거부 · 후속 취소';end if;
 if f.seq=2 and not exists(select 1 from private.sales_followups x where x.dispatch_id=f.dispatch_id and x.seq=1 and x.state='accepted') then return '첫 후속 미발송 · 마지막 후속 취소';end if;
 if f.expires_at<=now() then return '후속 발송 시간 지남';end if;
 return null;
end $$;
revoke all on function private.sales_followup_block(private.sales_followups) from public,anon,authenticated,service_role;

create or replace function private.sales_followup_tick() returns integer language plpgsql security definer set search_path='' as $$
declare f private.sales_followups;why text;gateway_key text;n integer:=0;
begin
 if not pg_try_advisory_xact_lock(903161206) then return 0;end if;
 for f in select * from private.sales_followups where state='queued' and (expires_at<=now() or scheduled_at<=now()) order by scheduled_at limit 20 for update skip locked loop
  why:=private.sales_followup_block(f);
  if why is not null then update private.sales_followups set state='cancelled',reason=why,finished_at=now() where id=f.id;continue;end if;
  if not public.sales_dispatch_enabled() then continue;end if;
  if f.handed_at is not null and f.handed_at>now()-interval '10 minutes' then continue;end if;
  if gateway_key is null then select btrim(decrypted_secret) into gateway_key from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;end if;
  exit when coalesce(gateway_key,'')='';
  update private.sales_followups set handed_at=now() where id=f.id;
  perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-dispatch',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway_key,'apikey',gateway_key),body:=jsonb_build_object('id',f.id),timeout_milliseconds:=10000);
  n:=n+1;exit when n>=5;
 end loop;
 return n;
end $$;
revoke all on function private.sales_followup_tick() from public,anon,authenticated,service_role;

create or replace function public.sales_followup_claim(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.sales_followups;why text;thread text;
begin
 select * into f from private.sales_followups where id=p_id for update;
 if f.id is null or f.state<>'queued' or f.scheduled_at>now() or not public.sales_dispatch_enabled() then return null;end if;
 why:=private.sales_followup_block(f);
 if why is not null then update private.sales_followups set state='cancelled',reason=why,finished_at=now() where id=p_id;return null;end if;
 select m.thread_id into thread from private.sales_dispatch_jobs j join public.mail_index m on m.id=j.provider_id where j.id=f.dispatch_id;
 update private.sales_followups set state='claimed',reason='후속 전송 처리 중',claim_token=gen_random_uuid(),claimed_at=now() where id=p_id returning * into f;
 return jsonb_build_object('id',f.id,'token',f.claim_token,'fingerprint','followup-'||f.dispatch_id||'-'||f.seq,'sender',f.sender,
  'message',jsonb_build_object('recipient',f.recipient,'subject',f.subject,'body',f.body,'channel','email','in_reply_to',f.dispatch_id::text,'thread_id',thread),
  'attachments','[]'::jsonb,'expires_at',f.expires_at,'followup',true);
end $$;
create or replace function public.sales_followup_finish(p_id uuid,p_token uuid,p_outcome text,p_provider_id text default null) returns void language plpgsql security definer set search_path='' as $$
declare f private.sales_followups;
begin
 select * into f from private.sales_followups where id=p_id for update;
 if f.id is null or p_token is null or f.claim_token is distinct from p_token then raise exception '전송 처리 권한 없음' using errcode='42501';end if;
 if p_outcome not in ('accepted','rejected','unknown') then raise exception '전송 결과 형식 오류';end if;
 if f.state=p_outcome then return;end if;
 if f.state<>'claimed' then raise exception '전송 결과가 이미 확정되었습니다.' using errcode='PT409';end if;
 update private.sales_followups set state=p_outcome,provider_id=p_provider_id,finished_at=now(),
  reason=case p_outcome when 'accepted' then '후속 '||f.seq||'회 제공사 접수' when 'rejected' then '후속 미접수 · 자동 재발송 없음' else '후속 결과 불명 · 재발송 중단' end where id=p_id;
end $$;
revoke all on function public.sales_followup_claim(uuid),public.sales_followup_finish(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sales_followup_claim(uuid),public.sales_followup_finish(uuid,uuid,text,text) to service_role;

insert into private.sales_ops_steps(step,label,call,every_min,grace_min) values('followups','후속 연락 (승인된 문안)','private.sales_followup_tick()',5,5) on conflict(step) do nothing;
notify pgrst,'reload schema';
commit;
