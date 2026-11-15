-- 0138 weekly vendor-candidate search from the public procurement award data (moved from the old arterior-interior project).
-- One-use run tokens stay private; the Edge Function g2b-vendors redeems one through a service-role-only RPC.
begin;
create table if not exists private.design_fn_run_tokens(token uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
alter table private.design_fn_run_tokens enable row level security;
revoke all on private.design_fn_run_tokens from public, anon, authenticated;
create or replace function public.design_run_token_use(p_token uuid) returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from private.design_fn_run_tokens where token = p_token and created_at > now() - interval '5 minutes';
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.design_run_token_use(uuid) from public, anon, authenticated;
grant execute on function public.design_run_token_use(uuid) to service_role;
create or replace function private.design_run_g2b_vendors(payload jsonb default '{}'::jsonb) returns bigint language plpgsql security definer set search_path = '' as $$
declare t uuid; req bigint;
begin
  delete from private.design_fn_run_tokens where created_at < now() - interval '1 hour';
  insert into private.design_fn_run_tokens default values returning token into t;
  select net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/g2b-vendors',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-run-token', t::text),
    body := payload, timeout_milliseconds := 120000) into req;
  return req;
end $$;
revoke all on function private.design_run_g2b_vendors(jsonb) from public, anon, authenticated;
select cron.schedule('design_g2b_vendors_weekly', '40 1 * * 1', $c$select private.design_run_g2b_vendors('{"days":7}'::jsonb)$c$);
notify pgrst, 'reload schema';
commit;
