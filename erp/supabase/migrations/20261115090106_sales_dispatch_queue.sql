-- Approval-bound queue only. No provider transport, credentials or send scheduler is enabled.
begin;
create table private.sales_dispatch_jobs(
 id uuid primary key default gen_random_uuid(),
 package_id uuid not null references public.sales_execution_packages(id),
 strategy_id uuid not null references public.sales_strategies(id),
 recipient text not null check(recipient=lower(btrim(recipient))),
 fingerprint text not null,message jsonb not null,
 state text not null default 'queued' check(state in ('queued','claimed','accepted','rejected','unknown','cancelled','expired')),
 reason text not null default '승인한 실행안의 발송 대기',
 scheduled_at timestamptz not null,expires_at timestamptz not null,
 claim_token uuid,claimed_at timestamptz,finished_at timestamptz,provider_id text,
 created_at timestamptz not null default now(),
 unique(package_id,recipient),check(expires_at>scheduled_at)
);
-- An uncertain provider outcome must never be retried through a new package version.
create unique index sales_dispatch_once on private.sales_dispatch_jobs(strategy_id,recipient) where state in ('queued','claimed','accepted','unknown');
create index sales_dispatch_due on private.sales_dispatch_jobs(state,scheduled_at);
create table private.sales_dispatch_events(
 id bigint generated always as identity primary key,job_id uuid not null references private.sales_dispatch_jobs(id),
 state text not null,note text not null,created_at timestamptz not null default now()
);
revoke all on private.sales_dispatch_jobs,private.sales_dispatch_events from public,anon,authenticated,service_role;

create function private.sales_dispatch_blocker(p public.sales_execution_packages) returns text language plpgsql stable set search_path='' as $$
declare material jsonb; msg jsonb; proof jsonb; seen text[]:='{}'; recipient text; deadline timestamptz;
begin
 if p.status<>'승인' or p.approved_at is null or not exists(select 1 from public.profiles where id=p.approved_by and active and role='admin' and not is_agent) then return '유효한 대표 승인 없음';end if;
 if exists(select 1 from public.sales_execution_packages where strategy_id=p.strategy_id and version>p.version) then return '새 실행안 버전으로 대체됨';end if;
 material:=private.sales_execution_material(p.strategy_id);
 if material is null or material->>'fingerprint' is distinct from p.fingerprint then return '근거·대상·문안·일정 변경';end if;
 if jsonb_typeof(material->'blockers') is distinct from 'array' or jsonb_array_length(material->'blockers')<>0 then return '시스템 검증 미완료';end if;
 if not coalesce((p.payload->>'transport_enabled')::boolean,false) or coalesce(p.payload->>'sender','') !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then return '발신 계정·전송 연결 미검증';end if;
 if coalesce((p.payload->'schedule'->>'per_recipient_limit')::integer,0)<>1 then return '수신자별 1회 제한 필요';end if;
 deadline:=(p.payload->'schedule'->>'expires_at')::timestamptz;
 if deadline is null or deadline<=now() or (p.payload->'schedule'->>'at')::timestamptz is null or deadline<=(p.payload->'schedule'->>'at')::timestamptz then return '승인 일정 만료 또는 형식 오류';end if;
 if jsonb_typeof(p.payload->'messages') is distinct from 'array' or jsonb_array_length(p.payload->'messages') not between 1 and 100 then return '수신 대상 범위 확인 필요';end if;
 for msg in select value from jsonb_array_elements(p.payload->'messages') loop
  recipient:=lower(btrim(msg->>'recipient'));
  if recipient is null or recipient !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' or recipient=any(seen) then return '수신 주소 형식·중복 확인 필요';end if;
  seen:=array_append(seen,recipient);
  if msg->>'channel' is distinct from 'email' or length(btrim(coalesce(msg->>'subject',''))) not between 1 and 200 or msg->>'subject' ~ '[[:cntrl:]]' or length(btrim(coalesce(msg->>'body',''))) not between 1 and 50000 then return '연락 문안·채널 검증 필요';end if;
  proof:=p.payload->'recipient_verification'->recipient;
  if proof->>'status' is distinct from 'verified' or length(btrim(coalesce(proof->>'evidence','')))=0 or length(btrim(coalesce(proof->>'purpose','')))=0 or (proof->>'valid_until')::timestamptz is null or (proof->>'valid_until')::timestamptz<deadline then return '수신 자격·목적별 근거 검증 필요';end if;
  if exists(select 1 from public.brand_contacts where opt_out and lower(btrim(email))=recipient) then return '수신 거부 대상';end if;
 end loop;
 return null;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return '검증 자료 형식 오류';
end $$;

create function private.sales_dispatch_enqueue() returns trigger language plpgsql security definer set search_path='' as $$
declare blocker text; msg jsonb; job_id uuid;
begin
 if new.status<>'승인' then
  with cancelled as (update private.sales_dispatch_jobs set state='cancelled',reason='승인 보류 또는 실행안 변경 · 미발송',finished_at=now() where package_id=new.id and state='queued' returning id)
  insert into private.sales_dispatch_events(job_id,state,note) select id,'cancelled','승인 보류 또는 실행안 변경 · 미발송' from cancelled;
  return new;
 end if;
 if old.status='승인' then return new;end if;
 blocker:=private.sales_dispatch_blocker(new);
 if blocker is not null then raise exception '발송 대기열 등록 불가: %',blocker using errcode='PT409';end if;
 for msg in select value from jsonb_array_elements(new.payload->'messages') loop
  if exists(select 1 from private.sales_dispatch_jobs where strategy_id=new.strategy_id and recipient=lower(btrim(msg->>'recipient')) and state in ('queued','claimed','accepted','unknown')) then raise exception '기존 발송 대기·접수·결과 확인 건이 있어 중복 실행할 수 없습니다.' using errcode='PT409';end if;
  insert into private.sales_dispatch_jobs(package_id,strategy_id,recipient,fingerprint,message,scheduled_at,expires_at)
   values(new.id,new.strategy_id,lower(btrim(msg->>'recipient')),new.fingerprint,msg,(new.payload->'schedule'->>'at')::timestamptz,(new.payload->'schedule'->>'expires_at')::timestamptz) returning id into job_id;
  insert into private.sales_dispatch_events(job_id,state,note) values(job_id,'queued','대표가 확인한 버전·수신자·문안으로 대기열 등록');
 end loop;
 return new;
end $$;
create trigger sales_dispatch_enqueue after update of status on public.sales_execution_packages for each row execute function private.sales_dispatch_enqueue();

create function public.sales_dispatch_claim(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.sales_dispatch_jobs; p public.sales_execution_packages; blocker text;
begin
 select * into job from private.sales_dispatch_jobs where id=p_id;
 if job.id is null then return null;end if;
 -- Same lock order as package decisions/refreshes.
 perform 1 from public.sales_strategies where id=job.strategy_id for update;
 select * into p from public.sales_execution_packages where id=job.package_id for update;
 select * into job from private.sales_dispatch_jobs where id=p_id for update;
 if job.state<>'queued' or job.scheduled_at>now() then return null;end if;
 blocker:=case when job.expires_at<=now() then '승인 일정 만료' else private.sales_dispatch_blocker(p) end;
 if blocker is not null or job.fingerprint is distinct from p.fingerprint then
  update private.sales_dispatch_jobs set state=case when expires_at<=now() then 'expired' else 'cancelled' end,reason=coalesce(blocker,'승인 버전 변경'),finished_at=now() where id=p_id returning * into job;
  insert into private.sales_dispatch_events(job_id,state,note) values(p_id,job.state,job.reason);return null;
 end if;
 update private.sales_dispatch_jobs set state='claimed',reason='전송 처리 중 · 결과 확인 전',claim_token=gen_random_uuid(),claimed_at=now() where id=p_id returning * into job;
 insert into private.sales_dispatch_events(job_id,state,note) values(p_id,'claimed',job.reason);
 return jsonb_build_object('id',job.id,'token',job.claim_token,'fingerprint',job.fingerprint,'sender',p.payload->'sender','message',job.message,'attachments',p.payload->'attachments','expires_at',job.expires_at);
end $$;

create function public.sales_dispatch_finish(p_id uuid,p_token uuid,p_outcome text,p_provider_id text default null) returns void language plpgsql security definer set search_path='' as $$
declare job private.sales_dispatch_jobs; note text;
begin
 select * into job from private.sales_dispatch_jobs where id=p_id for update;
 if job.id is null or p_token is null or job.claim_token is distinct from p_token then raise exception '전송 처리 권한 없음' using errcode='42501';end if;
 if p_outcome is null or p_outcome not in ('accepted','rejected','unknown') then raise exception '전송 결과 형식 오류';end if;
 if p_outcome='accepted' and (length(btrim(coalesce(p_provider_id,''))) not between 1 and 200 or p_provider_id ~ '[[:cntrl:]]') then raise exception '제공사 접수 식별자 필요';end if;
 if job.state=p_outcome and job.provider_id is not distinct from p_provider_id then return;end if;
 if job.state not in ('claimed','unknown') then raise exception '전송 결과가 이미 확정되었습니다.' using errcode='PT409';end if;
 note:=case p_outcome when 'accepted' then '제공사 접수 확인 · 수신함 도착·열람 확인 아님' when 'rejected' then '제공사 미접수 확인 · 자동 재발송 없음' else '전송 결과 불명 · 중복 방지를 위해 자동 재발송 중단' end;
 update private.sales_dispatch_jobs set state=p_outcome,reason=note,provider_id=p_provider_id,finished_at=now() where id=p_id;
 insert into private.sales_dispatch_events(job_id,state,note) values(p_id,p_outcome,note);
end $$;

create function private.sales_dispatch_watchdog() returns void language plpgsql security definer set search_path='' as $$
declare job record; next_state text; note text;
begin
 for job in select id,state from private.sales_dispatch_jobs where (state='claimed' and claimed_at<now()-interval '5 minutes') or (state='queued' and expires_at<=now()) order by created_at limit 100 for update skip locked loop
  next_state:=case job.state when 'claimed' then 'unknown' else 'expired' end;
  note:=case job.state when 'claimed' then '처리 시간 초과 · 결과 자동 대조 필요 · 재발송 금지' else '승인 일정 만료 · 미발송' end;
  update private.sales_dispatch_jobs set state=next_state,reason=note,finished_at=now() where id=job.id;
  insert into private.sales_dispatch_events(job_id,state,note) values(job.id,next_state,note);
 end loop;
end $$;
select cron.schedule('wkly_sales_dispatch_watchdog','*/2 * * * *','select private.sales_dispatch_watchdog()');

alter function public.sales_execution_get(uuid) rename to sales_execution_get_before_dispatch;
revoke all on function public.sales_execution_get_before_dispatch(uuid) from public,anon,authenticated;
create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.sales_execution_get_before_dispatch(p_id);
 if result is null then return null;end if;
 return result||jsonb_build_object('dispatch',jsonb_build_object('connected',false,'note','대기열 검증 기능 구현 · 실제 발송 처리기는 아직 미연결',
  'jobs',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]') from (select id,package_id,recipient,state,reason,scheduled_at,finished_at,created_at from private.sales_dispatch_jobs where strategy_id=p_id order by created_at desc limit 100) x)));
end $$;
revoke all on function private.sales_dispatch_blocker(public.sales_execution_packages),private.sales_dispatch_enqueue(),private.sales_dispatch_watchdog() from public,anon,authenticated,service_role;
revoke all on function public.sales_dispatch_claim(uuid),public.sales_dispatch_finish(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sales_dispatch_claim(uuid),public.sales_dispatch_finish(uuid,uuid,text,text) to service_role;
revoke all on function public.sales_execution_get(uuid) from public,anon;
grant execute on function public.sales_execution_get(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
