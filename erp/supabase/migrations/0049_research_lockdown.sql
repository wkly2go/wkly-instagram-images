-- 로그인하지 않은 사람(공개 키)이 유료 리서치 · 공공데이터 키를 쓰지 못하게 · 리서치 요청 표 보호
revoke execute on function public.research_deep_start(text, text, boolean) from anon, public;
revoke execute on function public.research_deep_poll(bigint) from anon, public;
revoke execute on function public.public_data_get(text, jsonb, text) from anon, public;
revoke execute on function public.seoul_data_get(text, text, text) from anon, public;
revoke execute on function public.research_keys_status() from anon, public;
grant execute on function public.research_deep_start(text, text, boolean) to authenticated, service_role;
grant execute on function public.research_deep_poll(bigint) to authenticated, service_role;
grant execute on function public.public_data_get(text, jsonb, text) to authenticated, service_role;
grant execute on function public.seoul_data_get(text, text, text) to authenticated, service_role;
grant execute on function public.research_keys_status() to authenticated, service_role;
alter table public.research_requests enable row level security;
create policy research_requests_member on public.research_requests for select to authenticated using ((select public.is_active_member()));
