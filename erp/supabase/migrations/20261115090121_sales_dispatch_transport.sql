-- Connects the approval-bound queue to the mail transport (2026-11-15 대표 허용: 승인한 실행 묶음 범위의 영업 메일 자동 발송).
-- Nothing is sent unless a package was approved, its checks still pass when the job is claimed, and the switch is on.
begin;
create table private.sales_dispatch_switch(id boolean primary key default true check(id),enabled boolean not null default false,changed_at timestamptz not null default now());
insert into private.sales_dispatch_switch default values;
alter table private.sales_dispatch_switch enable row level security;
revoke all on private.sales_dispatch_switch from public,anon,authenticated;
create function public.sales_dispatch_enabled() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select enabled from private.sales_dispatch_switch),false)$$;
revoke all on function public.sales_dispatch_enabled() from public,anon,authenticated;
grant execute on function public.sales_dispatch_enabled() to service_role;

-- Hands due jobs to the sender. Each job is posted at most once per ten minutes; the claim itself is what guarantees a single send.
alter table private.sales_dispatch_jobs add column handed_at timestamptz;
create function private.sales_dispatch_tick() returns integer language plpgsql security definer set search_path='' as $$
declare gateway_key text; job record; n integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sales_dispatch_tick',0)) then return 0; end if;
 if not public.sales_dispatch_enabled() then return 0; end if;
 select btrim(decrypted_secret) into gateway_key from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 if coalesce(gateway_key,'')='' then return 0; end if;
 for job in select id from private.sales_dispatch_jobs where state='queued' and scheduled_at<=now() and expires_at>now() and (handed_at is null or handed_at<now()-interval '10 minutes') order by scheduled_at,id limit 5 for update skip locked loop
  update private.sales_dispatch_jobs set handed_at=now() where id=job.id;
  perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-dispatch',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway_key,'apikey',gateway_key),body:=jsonb_build_object('id',job.id),timeout_milliseconds:=10000);
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function private.sales_dispatch_tick() from public,anon,authenticated;
select cron.schedule('wkly_sales_dispatch','* * * * *','select private.sales_dispatch_tick()');
commit;
