-- 2026-11-16 대표 지시 '100%까지 개발 진행' · 영업 목표 '승인된 실행 패키지의 이메일 · 적격 DM · CRM 자동화'.
-- Instagram DM 은 '적격'한 경우만 보낸다: 상대가 먼저 우리 계정에 DM 을 보냈고, 그 뒤 24시간 안(Meta 표준 메시지 창)이며, 그만 보내 달라고 하지 않은 경우.
-- ① 받은 DM 은 Meta 웹후크(sales-instagram 함수 · 서명 확인)로 들어와 저장되고, 보낸 사람은 영업 대상('Instagram DM')으로 자동 등록된다.
-- ② 실행 묶음을 만들 때 그 대상에게 답장 가능한 시간이 남아 있으면 기획안의 첫 연락 문장으로 DM 한 통을 묶음에 넣는다(대표 승인 필요).
--    묶음 만료 시각은 답장 가능 시간 끝을 넘지 않는다.
-- ③ 대표가 승인하면 기존 발송 대기열(sales_dispatch_jobs)로 들어가고, 보내기 직전에 24시간 창 · 수신 거부를 다시 확인한다.
-- ④ 연결 정보(접근 토큰 · 앱 시크릿)는 금고(vault)에만 저장한다. 화면에서 관리자가 직접 넣고, 다시 보여 주지 않는다. 웹후크 확인 토큰은 시스템이 만든다.
-- 발송 스위치 · 수신자 범위는 그대로이며 Instagram 계정이 연결되기 전에는 아무것도 보내지 않는다.
begin;

create table if not exists private.sales_dm_inbound(
 mid text primary key,
 ig_user text not null check(ig_user ~ '^[0-9]{5,30}$'),
 username text,
 body text not null default '',
 received_at timestamptz not null,
 opt_out boolean not null default false,
 stored_at timestamptz not null default now()
);
create index if not exists sales_dm_inbound_user on private.sales_dm_inbound(ig_user,received_at desc);
alter table private.sales_dm_inbound enable row level security;
revoke all on private.sales_dm_inbound from public,anon,authenticated;

-- 시스템이 만드는 웹후크 확인 토큰 (Meta 앱 설정에 붙여 넣는 값 · 비밀 열쇠가 아님)
do $$
begin
 if not exists(select 1 from vault.secrets where name='INSTAGRAM_VERIFY_TOKEN') then
  perform vault.create_secret(replace(gen_random_uuid()::text,'-',''),'INSTAGRAM_VERIFY_TOKEN','Instagram 웹후크 확인 토큰 (sales-instagram 함수)');
 end if;
end $$;

-- 상대의 마지막 DM 기준 답장 가능 시간 끝 (없거나 수신 거부면 null)
create or replace function private.sales_dm_window(p_ig_user text) returns timestamptz language sql stable set search_path='' as $$
 select case when bool_or(opt_out) then null else max(received_at)+interval '24 hours' end
 from private.sales_dm_inbound where ig_user=p_ig_user
$$;

create or replace function public.sales_dm_receive(p_events jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare e jsonb;n integer:=0;who text;txt text;stop boolean;at timestamptz;
begin
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>100 then raise exception 'Invalid events';end if;
 for e in select value from jsonb_array_elements(p_events) loop
  who:=e->>'ig_user';txt:=left(coalesce(e->>'text',''),2000);
  continue when who is null or who !~ '^[0-9]{5,30}$' or coalesce(e->>'mid','')='' or length(e->>'mid')>300;
  at:=least(now(),coalesce(to_timestamp((e->>'timestamp')::bigint/1000.0),now()));
  stop:=txt ~* '(수신 ?거부|연락 ?(하지|그만)|보내지 ?마|그만 ?보내|스팸|unsubscribe|^\s*stop\s*$)';
  insert into private.sales_dm_inbound(mid,ig_user,username,body,received_at,opt_out)
   values(e->>'mid',who,nullif(left(e->>'username',60),''),txt,at,stop) on conflict(mid) do nothing;
  if not found then continue;end if;
  n:=n+1;
  insert into public.sales_prospects(source,source_key,name,entity_kind,contact,evidence,event_data,source_updated_at,blocked,next_action)
   values('Instagram DM',who,coalesce('@'||nullif(left(e->>'username',60),''),'Instagram '||who),'미분류','ig:'||who,
    'Instagram DM 문의 · '||left(txt,300),jsonb_build_object('ig_user',who,'last_inbound_at',at),at,stop,
    case when stop then '수신 거부 · 연락하지 않음' else '받은 DM 24시간 안에 답장 기획' end)
   on conflict(source,source_key) do update set
    evidence=left('Instagram DM 문의 · '||left(txt,300)||' / '||public.sales_prospects.evidence,1500),
    event_data=public.sales_prospects.event_data||jsonb_build_object('last_inbound_at',at),
    source_updated_at=at,
    blocked=public.sales_prospects.blocked or stop,
    next_action=case when public.sales_prospects.blocked or stop then '수신 거부 · 연락하지 않음' else '받은 DM 24시간 안에 답장 기획' end;
 end loop;
 return n;
end $$;
revoke all on function public.sales_dm_receive(jsonb) from public,anon,authenticated;
grant execute on function public.sales_dm_receive(jsonb) to service_role;

-- 실행 묶음에 적격 DM 추가
do $$
begin
 if to_regprocedure('private.sales_execution_material_before_dm(uuid)') is null then
  alter function private.sales_execution_material(uuid) rename to sales_execution_material_before_dm;
 end if;
end $$;
create or replace function private.sales_execution_material(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare m jsonb:=private.sales_execution_material_before_dm(p_id);payload jsonb;t jsonb;who text;win timestamptz;earliest timestamptz;body text;msgs jsonb:='[]';proofs jsonb:='{}';blockers jsonb;sched jsonb;
begin
 if m is null then return null;end if;
 payload:=m->'payload';blockers:=m->'blockers';sched:=payload->'schedule';
 body:=btrim(coalesce(payload#>>'{plan,first_message}',''));
 for t in select value from jsonb_array_elements(coalesce(payload->'targets','[]')) loop
  select p.source_key into who from public.sales_prospects p where p.id::text=t->>'source_id' and p.source='Instagram DM' and not p.blocked;
  continue when who is null;
  win:=private.sales_dm_window(who);
  continue when win is null or win<=now();
  continue when exists(select 1 from jsonb_array_elements(msgs) x where x->>'recipient'='ig:'||who);
  if length(body) not between 1 and 1000 then blockers:=blockers||jsonb_build_array('Instagram 답장 문안(첫 연락 문장)이 비었거나 1,000자를 넘습니다.');continue;end if;
  msgs:=msgs||jsonb_build_object('channel','instagram','recipient','ig:'||who,'company',coalesce(t->>'company',t->>'name',''),'person',null,'subject',null,'body',body,'source_ids',jsonb_build_array(t->>'source_id'));
  proofs:=proofs||jsonb_build_object('ig:'||who,jsonb_build_object('status','verified','rule','DM 답장','evidence','상대가 먼저 보낸 Instagram DM (24시간 답장 창 안)','purpose','받은 문의에 대한 답장','valid_until',win));
  earliest:=least(coalesce(earliest,win),win);
 end loop;
 if jsonb_array_length(msgs)=0 then return m;end if;
 if earliest<=coalesce((sched->>'at')::timestamptz,now()) then
  blockers:=blockers||jsonb_build_array('Instagram 답장 가능 시간(상대 DM 후 24시간)이 예정 시각 전에 끝납니다.');
 elsif (sched->>'expires_at')::timestamptz is null or (sched->>'expires_at')::timestamptz>earliest then
  sched:=coalesce(sched,'{}')||jsonb_build_object('expires_at',earliest);
 end if;
 payload:=payload||jsonb_build_object('messages',coalesce(payload->'messages','[]')||msgs,'schedule',sched,'recipient_verification',coalesce(payload->'recipient_verification','{}')||proofs,'instagram_dm',true);
 return jsonb_build_object('payload',payload,'blockers',blockers,'fingerprint',encode(sha256(convert_to(jsonb_build_array(payload,blockers)::text,'UTF8')),'hex'));
end $$;

-- 발송 전 검증: Instagram 채널 허용 (ig:숫자 · 본문 1~1,000자)
do $$
declare def text;
begin
 def:=pg_get_functiondef('private.sales_dispatch_blocker_before_readiness(public.sales_execution_packages)'::regprocedure);
 if position('^ig:[0-9]{5,30}$' in def)=0 then
  if position('  if recipient is null or recipient !~ ' in def)=0 or position('  if msg->>''channel'' is distinct from ''email'' or length' in def)=0 then raise exception 'Unexpected dispatch blocker';end if;
  def:=replace(def,'  if recipient is null or recipient !~ ','  if recipient ~ ''^ig:[0-9]{5,30}$'' and msg->>''channel''=''instagram'' then null; elsif recipient is null or recipient !~ ');
  def:=replace(def,'  if msg->>''channel'' is distinct from ''email'' or length','  if msg->>''channel''=''instagram'' then if recipient !~ ''^ig:[0-9]{5,30}$'' or length(btrim(coalesce(msg->>''body'',''''))) not between 1 and 1000 then return ''연락 문안·채널 검증 필요'';end if; elsif msg->>''channel'' is distinct from ''email'' or length');
  execute def;
 end if;
end $$;

-- 보내기 직전: Instagram 은 24시간 창 · 수신 거부를 다시 확인
do $$
begin
 if to_regprocedure('public.sales_dispatch_claim_before_dm(uuid)') is null then
  alter function public.sales_dispatch_claim(uuid) rename to sales_dispatch_claim_before_dm;
 end if;
end $$;
create or replace function public.sales_dispatch_claim(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.sales_dispatch_jobs;win timestamptz;
begin
 select * into job from private.sales_dispatch_jobs where id=p_id;
 if job.id is not null and job.state='queued' and job.message->>'channel'='instagram' and job.scheduled_at<=now() then
  win:=private.sales_dm_window(substr(job.recipient,4));
  if win is null or win<=now() then
   update private.sales_dispatch_jobs set state='cancelled',reason=case when win is null then 'Instagram 수신 거부 또는 받은 DM 없음 · 미발송' else 'Instagram 답장 가능 시간(24시간) 지남 · 미발송' end,finished_at=now() where id=p_id and state='queued' returning * into job;
   if job.id is not null then insert into private.sales_dispatch_events(job_id,state,note) values(p_id,'cancelled',job.reason);end if;
   return null;
  end if;
 end if;
 return public.sales_dispatch_claim_before_dm(p_id);
end $$;
revoke all on function public.sales_dispatch_claim(uuid),public.sales_dispatch_claim_before_dm(uuid) from public,anon,authenticated;
grant execute on function public.sales_dispatch_claim(uuid) to service_role;

-- 연결 정보: 관리자만 저장 (금고) · 서버 함수만 읽음
create or replace function public.instagram_secret_set(p_name text,p_value text) returns void language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.is_admin() then raise exception '관리자만 연결할 수 있습니다.' using errcode='42501';end if;
 if p_name not in ('INSTAGRAM_ACCESS_TOKEN','INSTAGRAM_APP_SECRET') then raise exception 'not allowed';end if;
 select id into v_id from vault.secrets where name=p_name;
 if coalesce(btrim(p_value),'')='' then if v_id is not null then delete from vault.secrets where id=v_id;end if;return;end if;
 if length(p_value)>1000 or p_value ~ '\s' then raise exception '값 형식을 확인해 주세요.';end if;
 if v_id is null then perform vault.create_secret(p_value,p_name,'Instagram DM 연결 (sales-instagram · sales-dispatch 함수)');
 else perform vault.update_secret(v_id,p_value);end if;
end $$;
create or replace function public.instagram_secret_get(p_name text) returns text language sql stable security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where name=p_name and p_name in ('INSTAGRAM_ACCESS_TOKEN','INSTAGRAM_APP_SECRET','INSTAGRAM_VERIFY_TOKEN') limit 1
$$;
create or replace function public.sales_instagram_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.' using errcode='42501';end if;
 return jsonb_build_object(
  'token',exists(select 1 from vault.secrets where name='INSTAGRAM_ACCESS_TOKEN'),
  'app_secret',exists(select 1 from vault.secrets where name='INSTAGRAM_APP_SECRET'),
  'verify_token',(select decrypted_secret from vault.decrypted_secrets where name='INSTAGRAM_VERIFY_TOKEN' limit 1),
  'inbound',(select count(*) from private.sales_dm_inbound),
  'people',(select count(distinct ig_user) from private.sales_dm_inbound),
  'open_windows',(select count(*) from (select ig_user from private.sales_dm_inbound group by ig_user having not bool_or(opt_out) and max(received_at)>now()-interval '24 hours') x),
  'last_inbound',(select max(received_at) from private.sales_dm_inbound),
  'sent',(select count(*) from private.sales_dispatch_jobs where message->>'channel'='instagram' and state='accepted'));
end $$;
revoke all on function public.instagram_secret_set(text,text),public.instagram_secret_get(text),public.sales_instagram_status() from public,anon,authenticated;
grant execute on function public.instagram_secret_set(text,text),public.sales_instagram_status() to authenticated;
grant execute on function public.instagram_secret_get(text) to service_role;
revoke all on function private.sales_dm_window(text),private.sales_execution_material(uuid),private.sales_execution_material_before_dm(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
