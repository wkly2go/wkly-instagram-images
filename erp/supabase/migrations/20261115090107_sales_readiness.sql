-- Diagnostics do not change transport capability or grant outreach permission.
begin;
create table private.sales_sender_readiness(
 id boolean primary key default true check(id),run_id uuid,started_at timestamptz,checked_at timestamptz,valid_until timestamptz,
 code text not null default 'unverified' check(code in ('unverified','checking','ready','read_only','scope_unknown','identity_unverified','account_mismatch','not_connected','provider_error')),
 email text,can_send boolean not null default false,can_read boolean not null default false
);
insert into private.sales_sender_readiness(id) values(true);
revoke all on private.sales_sender_readiness from public,anon,authenticated,service_role;
create function public.sales_sender_check_begin() returns uuid language plpgsql security definer set search_path='' as $$
declare s private.sales_sender_readiness; run uuid:=gen_random_uuid();
begin
 select * into s from private.sales_sender_readiness where id for update;
 if (s.code='checking' and s.started_at>now()-interval '2 minutes') or (s.code<>'checking' and s.checked_at>now()-interval '1 minute') then return null;end if;
 update private.sales_sender_readiness set run_id=run,started_at=now(),code='checking',can_send=false,can_read=false,valid_until=null where id;
 return run;
end $$;
create function public.sales_sender_check_finish(p_run uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare ttl integer; v_code text:=p_result->>'code'; sender text:=nullif(lower(btrim(p_result->>'email')),''); v_send boolean;v_read boolean;
begin
 if jsonb_typeof(p_result) is distinct from 'object' or p_result-ARRAY['code','email','can_send','can_read','valid_for']<>'{}' or v_code is null or v_code not in ('ready','read_only','scope_unknown','identity_unverified','account_mismatch','not_connected','provider_error') then raise exception 'Invalid diagnostic result';end if;
 ttl:=(p_result->>'valid_for')::integer;v_send:=(p_result->>'can_send')::boolean;v_read:=(p_result->>'can_read')::boolean;
 if ttl is null or ttl not between 1 and 900 or v_send is null or v_read is null or (v_send is distinct from (v_code='ready')) or (v_code in ('ready','read_only') and (sender is null or length(sender)>254 or sender !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$')) or (v_code not in ('ready','read_only') and (sender is not null or v_send or v_read)) then raise exception 'Invalid diagnostic result';end if;
 update private.sales_sender_readiness set code=v_code,email=sender,can_send=v_send,can_read=v_read,checked_at=now(),valid_until=now()+make_interval(secs=>ttl)
 where id and run_id=p_run and p_run is not null and started_at>now()-interval '2 minutes' and sales_sender_readiness.code='checking';
 if not found then raise exception 'Diagnostic lease expired' using errcode='PT409';end if;
end $$;
create function private.sales_sender_status() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('code',case when code='checking' and started_at<=now()-interval '2 minutes' then 'stale' when code not in ('unverified','checking') and valid_until<=now() then 'stale' else code end,
 'email',email,'can_send',can_send and valid_until>now(),'can_read',can_read and valid_until>now(),'checked_at',checked_at,'valid_until',valid_until,'transport_connected',false)
 from private.sales_sender_readiness where id
$$;
create function private.sales_recipient_readiness(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 with targets as (select value t from jsonb_array_elements(private.sales_strategy_targets(p_id))),
 classified as(select current_target.t,case when current_target.t->>'status'='접촉 제외' then 'excluded' when coalesce(current_target.t->>'email','')='' then 'missing_contact'
 when exists(select 1 from targets other where other.t->>'email'=current_target.t->>'email' and coalesce(nullif(other.t->>'company_id',''),other.t->>'company','') is distinct from coalesce(nullif(current_target.t->>'company_id',''),current_target.t->>'company','')) then 'ambiguous_company'
 when coalesce(current_target.t->>'company_id','')='' then 'identity_unverified' else 'permission_unverified' end code from targets current_target)
 select coalesce(jsonb_agg(jsonb_build_object('source_id',t->>'source_id','company',t->>'company','person',t->>'person','email',t->>'email','origin',t->>'email_origin','code',code,
 'next_action',case code when 'excluded' then '접촉 중단 · 제외 상태 유지' when 'missing_contact' then '시스템의 공식 연락 창구 추가 확보 대상' when 'ambiguous_company' then '시스템의 회사·담당자 관계 대조 대상' when 'identity_unverified' then '시스템의 실명 회사·담당 역할 확인 대상' else '시스템의 수신 목적·요청 근거 확인 대상 · 공개 이메일만으로 발송하지 않음' end) order by t->>'source_id'),'[]') from classified
$$;
alter function private.sales_dispatch_blocker(public.sales_execution_packages) rename to sales_dispatch_blocker_before_readiness;
create function private.sales_dispatch_blocker(p public.sales_execution_packages) returns text language plpgsql stable set search_path='' as $$
declare blocker text;
begin
 blocker:=private.sales_dispatch_blocker_before_readiness(p);if blocker is not null then return blocker;end if;
 if not exists(select 1 from private.sales_sender_readiness s where s.id and s.code='ready' and s.can_send and s.valid_until>now() and s.email=lower(btrim(p.payload->>'sender'))) then return '발신 계정 진단 만료·불일치 또는 발송 권한 미확인';end if;
 return null;
end $$;
revoke all on function private.sales_dispatch_blocker(public.sales_execution_packages),private.sales_dispatch_blocker_before_readiness(public.sales_execution_packages) from public,anon,authenticated,service_role;
alter function public.sales_execution_get(uuid) rename to sales_execution_get_before_readiness;
revoke all on function public.sales_execution_get_before_readiness(uuid) from public,anon,authenticated;
create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; sender_status jsonb;
begin
 result:=public.sales_execution_get_before_readiness(p_id);if result is null then return null;end if;
 sender_status:=private.sales_sender_status();
 return result||jsonb_build_object('can_approve',coalesce((result->>'can_approve')::boolean,false) and sender_status->>'code'='ready' and coalesce((sender_status->>'can_send')::boolean,false) and sender_status->>'email'=lower(btrim(result->'payload'->>'sender')),
 'readiness',jsonb_build_object('sender',sender_status,'recipients',private.sales_recipient_readiness(p_id),'scope','현재 DB 자동 점검 · 실제 수신 자격 검증 완료를 의미하지 않음'));
end $$;
revoke all on function private.sales_sender_status(),private.sales_recipient_readiness(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sales_sender_check_begin(),public.sales_sender_check_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_sender_check_begin(),public.sales_sender_check_finish(uuid,jsonb) to service_role;
revoke all on function public.sales_execution_get(uuid) from public,anon;
grant execute on function public.sales_execution_get(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
