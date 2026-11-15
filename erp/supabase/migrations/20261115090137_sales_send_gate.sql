-- 승인 후 메일 발송의 마지막 연결. 지금까지 실행 묶음에는 '발신 계정 미연결 · 수신 자격 미검증' 차단이 고정으로
-- 붙어 있어 어떤 묶음도 승인 단계로 갈 수 없었다. 이를 실제 점검으로 바꾼다.
-- ① 발신: 발신 계정 진단이 '보내기 가능'일 때만 발신 주소와 전송 연결을 묶음에 적는다.
-- ② 수신: 대표가 고른 수신자 범위 규칙 안의 주소만 검증된 것으로 적는다. 규칙의 처음 값은 '미정'이며
--    그동안은 어떤 고객 주소도 통과하지 않는다. 대표가 지정한 사내 시험 주소만 예외다.
-- ③ 시험 발송: 지정된 시험 주소로 고정된 시험 문구만 보내는 별도 경로. 고객 발송 스위치와 무관하다.
begin;
create table private.sales_recipient_scope(id boolean primary key default true check(id),scope text not null default '미정' check(scope in ('미정','거래·문의','공개 창구 포함')),changed_at timestamptz not null default now(),changed_by uuid references public.profiles(id));
insert into private.sales_recipient_scope default values;
create table private.sales_test_recipients(email text primary key check(email=lower(btrim(email)) and email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'));
alter table private.sales_recipient_scope enable row level security;
alter table private.sales_test_recipients enable row level security;
revoke all on private.sales_recipient_scope,private.sales_test_recipients from public,anon,authenticated;

-- The sender last confirmed able to send. A check in progress keeps it, so an approved package is not invalidated mid-check.
alter table private.sales_sender_readiness add column sender_confirmed text;
create function private.sales_sender_confirmed() returns trigger language plpgsql set search_path='' as $$
begin
 if new.code='ready' and new.can_send and new.email is not null then new.sender_confirmed:=new.email;
 elsif new.code<>'checking' then new.sender_confirmed:=null; end if;
 return new;
end $$;
create trigger sales_sender_confirmed before update on private.sales_sender_readiness for each row execute function private.sales_sender_confirmed();

alter function private.sales_execution_material(uuid) rename to sales_execution_material_before_send_gate;
create function private.sales_execution_material(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare m jsonb:=private.sales_execution_material_before_send_gate(p_id); payload jsonb; blockers jsonb; sender text; rule text; proofs jsonb:='{}'; msg jsonb; r text; origin text; proof jsonb; outside integer:=0; until timestamptz;
begin
 if m is null then return null; end if;
 payload:=m->'payload';
 select coalesce(jsonb_agg(b),'[]'::jsonb) into blockers from jsonb_array_elements(m->'blockers') b
  where b#>>'{}' not in ('발신 계정·이메일 발송 권한과 전송 처리가 아직 연결되지 않았습니다.','시스템의 수신 자격·문안·제안 범위 검증이 완료되지 않았습니다.');
 select sender_confirmed into sender from private.sales_sender_readiness where id;
 if sender is not null then payload:=payload||jsonb_build_object('sender',sender,'transport_enabled',true);
 else blockers:=blockers||jsonb_build_array('발신 계정에 메일 보내기 권한이 없습니다. 드라이브 설정에서 구글 계정을 다시 연결해 주세요.'); end if;
 select scope into rule from private.sales_recipient_scope where id;rule:=coalesce(rule,'미정');
 until:=(payload->'schedule'->>'expires_at')::timestamptz+interval '1 day';
 for msg in select value from jsonb_array_elements(coalesce(payload->'messages','[]'::jsonb)) loop
  r:=lower(btrim(msg->>'recipient'));
  select t->>'email_origin' into origin from jsonb_array_elements(payload->'targets') t where lower(btrim(t->>'email'))=r order by t->>'source_id' limit 1;
  proof:=case
   when exists(select 1 from private.sales_test_recipients x where x.email=r) then jsonb_build_object('evidence','대표가 지정한 사내 시험 수신 주소','purpose','발송 기능 시험')
   when rule in ('거래·문의','공개 창구 포함') and origin in ('담당자 DB','거래처 DB') then jsonb_build_object('evidence','기존 거래처·담당자로 저장된 주소 ('||origin||')','purpose','기존 거래 관계에 따른 제안')
   when rule='공개 창구 포함' and origin='공식 사이트 공개 주소' then jsonb_build_object('evidence','브랜드 공식 사이트가 공개한 문의 주소','purpose','공개 문의 창구를 통한 제휴 제안')
  end;
  if proof is null then outside:=outside+1;
  else proofs:=proofs||jsonb_build_object(r,proof||jsonb_build_object('status','verified','rule',rule,'valid_until',until)); end if;
 end loop;
 if outside>0 then blockers:=blockers||jsonb_build_array(case when rule='미정' then '수신자 범위 규칙이 아직 정해지지 않았습니다. 기획실에서 대표님이 고르면 다시 판정합니다.' else '수신자 범위 규칙('||rule||') 밖의 대상이 '||outside||'곳 있습니다.' end); end if;
 payload:=payload||jsonb_build_object('recipient_verification',proofs,'recipient_scope',rule);
 return jsonb_build_object('payload',payload,'blockers',blockers,'fingerprint',encode(sha256(convert_to(jsonb_build_array(payload,blockers)::text,'UTF8')),'hex'));
end $$;
revoke all on function private.sales_execution_material(uuid),private.sales_execution_material_before_send_gate(uuid),private.sales_sender_confirmed() from public,anon,authenticated;

create function public.sales_recipient_scope_get() returns text language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.' using errcode='42501'; end if;
 return (select scope from private.sales_recipient_scope where id);
end $$;
create function public.sales_recipient_scope_set(p_scope text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 바꿀 수 있습니다.' using errcode='42501'; end if;
 if p_scope is null or p_scope not in ('미정','거래·문의','공개 창구 포함') then raise exception '범위 값을 확인해 주세요.'; end if;
 update private.sales_recipient_scope set scope=p_scope,changed_at=now(),changed_by=auth.uid() where id;
end $$;
revoke all on function public.sales_recipient_scope_get(),public.sales_recipient_scope_set(text) from public,anon;
grant execute on function public.sales_recipient_scope_get(),public.sales_recipient_scope_set(text) to authenticated;

-- Test sends: a fixed text to an address the 대표 named, nothing else.
create table private.sales_dispatch_tests(id uuid primary key default gen_random_uuid(),recipient text not null references private.sales_test_recipients(email),state text not null default 'queued' check(state in ('queued','claimed','accepted','rejected','unknown','expired')),
 token uuid,provider_id text,created_at timestamptz not null default now(),finished_at timestamptz);
alter table private.sales_dispatch_tests enable row level security;
revoke all on private.sales_dispatch_tests from public,anon,authenticated;
create function public.sales_dispatch_test_claim(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.sales_dispatch_tests; sender text;
begin
 select sender_confirmed into sender from private.sales_sender_readiness where id;
 update private.sales_dispatch_tests set state='expired',finished_at=now() where id=p_id and state='queued' and (created_at<now()-interval '10 minutes' or sender is null);
 update private.sales_dispatch_tests set state='claimed',token=gen_random_uuid() where id=p_id and state='queued' and exists(select 1 from private.sales_test_recipients x where x.email=recipient) returning * into t;
 if t.id is null then return null; end if;
 return jsonb_build_object('id',t.id,'token',t.token,'fingerprint','test','sender',sender,'test',true,'attachments','[]'::jsonb,'expires_at',t.created_at+interval '10 minutes',
  'message',jsonb_build_object('recipient',t.recipient,'subject','[WKLY 인트라넷] 영업 메일 전송 시험','body','WKLY 인트라넷의 영업 메일 전송 기능을 확인하는 시험 메일입니다.'||chr(10)||'대표님이 지정한 사내 시험 주소로만 보냅니다. 회신하실 필요는 없습니다.'||chr(10)||chr(10)||'더위클리 · 아트리어디자인스튜디오'));
end $$;
create function public.sales_dispatch_test_finish(p_id uuid,p_token uuid,p_outcome text,p_provider_id text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_outcome is null or p_outcome not in ('accepted','rejected','unknown') or (p_outcome='accepted' and (length(btrim(coalesce(p_provider_id,''))) not between 1 and 200 or p_provider_id ~ '[[:cntrl:]]')) then raise exception '전송 결과 형식 오류'; end if;
 update private.sales_dispatch_tests set state=p_outcome,provider_id=p_provider_id,finished_at=now() where id=p_id and token=p_token and state in ('claimed','unknown');
 if not found and not exists(select 1 from private.sales_dispatch_tests where id=p_id and token=p_token and state=p_outcome) then raise exception '전송 처리 권한 없음' using errcode='42501'; end if;
end $$;
create function private.sales_dispatch_test_start(p_recipient text) returns uuid language plpgsql security definer set search_path='' as $$
declare gateway text; job uuid;
begin
 if exists(select 1 from private.sales_dispatch_tests where recipient=lower(btrim(p_recipient)) and created_at>now()-interval '10 minutes') then raise exception '같은 주소로 10분 안에 다시 시험할 수 없습니다.'; end if;
 select btrim(decrypted_secret) into gateway from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 if coalesce(gateway,'')='' then raise exception '서버 연결 설정 필요'; end if;
 insert into private.sales_dispatch_tests(recipient) values(lower(btrim(p_recipient))) returning id into job;
 perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-dispatch',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,'apikey',gateway),body:=jsonb_build_object('id',job),timeout_milliseconds:=10000);
 return job;
end $$;
revoke all on function private.sales_dispatch_test_start(text) from public,anon,authenticated;
revoke all on function public.sales_dispatch_test_claim(uuid),public.sales_dispatch_test_finish(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sales_dispatch_test_claim(uuid),public.sales_dispatch_test_finish(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
