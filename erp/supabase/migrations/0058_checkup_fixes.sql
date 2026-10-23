-- 0058 시스템 점검 결과 수정 (2026-10-23)
-- 1) 결제 공유 보기: 만든 사람 권한 보기 → 본인 권한 보기 + 계좌 칸을 비우는 함수
-- 2) 리서치 함수 검색 경로 고정
-- 3) 권한 검사에서 auth.uid() 를 한 번만 계산
-- 4) 색인 없는 연결(외래 키)에 색인 추가
-- 5) 같은 알림 반복은 하나로 묶기 + 쌓인 알림 정리

create or replace function public.payments_shared_rows() returns setof public.payments
language sql stable security definer set search_path = public as $$
  select id, direction, project_id, client_id, budget_line_id, approval_id, category, title, payee, contract_type, stage, amount, vat, tax_invoice, tax_invoice_date, status, is_estimate, requested_date, due_date, paid_date, advance_by, null::text, null::text, null::text, memo, created_by, created_at, updated_at
  from public.payments where public.is_active_member()
$$;
revoke execute on function public.payments_shared_rows() from public, anon;
grant execute on function public.payments_shared_rows() to authenticated;
create or replace view public.payments_shared with (security_invoker = true) as select * from public.payments_shared_rows();

alter function public.research_secret(text) set search_path = public, vault;
alter function public.research_keys_status() set search_path = public, vault;
alter function public.research_deep_start(text, text, boolean) set search_path = public, extensions;
alter function public.research_deep_poll(bigint) set search_path = public, extensions;

alter policy hr_records_select on public.hr_records using (((profile_id = (select auth.uid())) and is_active_member()) or is_admin());
alter policy leave_records_delete on public.leave_records using (is_admin() or ((profile_id = (select auth.uid())) and (status = '신청')));
alter policy leave_records_insert on public.leave_records with check (is_admin() or ((profile_id = (select auth.uid())) and (status = '신청') and is_active_member()));
alter policy agent_instructions_delete on public.agent_instructions using (is_admin() or ((created_by = (select auth.uid())) and (status = '대기')));
alter policy agent_instructions_insert on public.agent_instructions with check (is_active_member() and (created_by = (select auth.uid())) and (status = '대기') and (response is null) and exists (select 1 from profiles a where a.id = agent_instructions.agent_id and a.is_agent and a.active));
alter policy agent_directives_write on public.agent_directives using (is_admin() or exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_agent)) with check (is_admin() or exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_agent));
alter policy agent_prompt_edits_write on public.agent_prompt_edits using (is_admin() or exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_agent)) with check (is_admin() or exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_agent));
alter policy agent_actions_select on public.agent_actions using (is_admin() or (requester_id = (select auth.uid())) or exists (select 1 from agent_roster r where r.code = agent_actions.lead_code and r.owner_id = (select auth.uid())));
alter policy meeting_minutes_author_write on public.meeting_minutes using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

do $$ declare r record; begin
  for r in
    select c.conrelid::regclass tbl, c.conname,
      (select string_agg(quote_ident(a.attname), ',' order by k.ord) from unnest(c.conkey) with ordinality k(att, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att) cols
    from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
  loop
    execute format('create index if not exists %I on %s (%s)', left(r.conname, 55) || '_ix', r.tbl, r.cols);
  end loop;
end $$;

create or replace function private.notifications_merge_repeat() returns trigger language plpgsql security definer set search_path = public as $$
declare hit bigint;
begin
  -- 같은 사람 · 같은 종류 · 같은 제목의 안 읽은 알림이 하루 안에 있으면 새로 쌓지 않고 그 알림을 맨 위로 올림
  select id into hit from public.notifications
   where user_id = new.user_id and kind = new.kind and title = new.title and read_at is null
     and created_at > now() - interval '24 hours'
   order by created_at desc limit 1;
  if hit is not null then
    update public.notifications set created_at = now(), body = coalesce(new.body, body), link = coalesce(new.link, link) where id = hit;
    return null;
  end if;
  return new;
end $$;
create or replace trigger notifications_merge_repeat before insert on public.notifications for each row execute function private.notifications_merge_repeat();

update public.notifications set read_at = now() where read_at is null and created_at < now() - interval '3 days';
update public.notifications n set read_at = now() from (
  select id, row_number() over (partition by user_id, kind, title order by created_at desc) rn from public.notifications where read_at is null) d
where n.id = d.id and d.rn > 1;
