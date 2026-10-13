-- WKLY ERP 0007: 업무 일정표 · 연차 · 에이전트 직접 지시
--   1) tasks.start_date / tasks.phase : 업무 지시를 주 단위 일정표(간트)에 그리기 위한 시작일 · 단계(예: 디자인 기획)
--   2) leave_records : 휴가 신청 → 관리자 승인. 연차 발생일수는 인사기록 입사일로 화면에서 자동 계산
--   3) agent_instructions : ERP 에서 AI 팀원(WKLY 총괄)에게 직접 지시 → 에이전트가 처리하고 답을 남김

-- ---------------------------------------------------------------------
-- 1) 업무 일정
-- ---------------------------------------------------------------------
alter table public.tasks add column if not exists start_date date;
alter table public.tasks add column if not exists phase text;

alter table public.tasks drop constraint if exists tasks_phase_check;
alter table public.tasks add constraint tasks_phase_check
  check (phase is null or char_length(phase) <= 40);

alter table public.tasks drop constraint if exists tasks_period_check;
alter table public.tasks add constraint tasks_period_check
  check (start_date is null or due_date is null or start_date <= due_date);

create index if not exists tasks_start_date_idx on public.tasks (start_date);

-- ---------------------------------------------------------------------
-- 2) 휴가 (연차 · 반차 · 병가 · 경조사 · 기타)
-- ---------------------------------------------------------------------
create table if not exists public.leave_records (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind        text not null default '연차' check (kind in ('연차', '반차', '병가', '경조사', '기타')),
  start_date  date not null,
  end_date    date not null,
  days        numeric(4, 1) not null check (days > 0 and days <= 60),
  reason      text check (reason is null or char_length(reason) <= 500),
  status      text not null default '신청' check (status in ('신청', '승인', '반려')),
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint leave_records_period_check check (start_date <= end_date),
  constraint leave_records_half_check check (kind <> '반차' or (days = 0.5 and start_date = end_date))
);

create index if not exists leave_records_profile_idx on public.leave_records (profile_id, start_date);

alter table public.leave_records enable row level security;

-- 누가 언제 쉬는지는 팀 일정에 필요하므로 활성 팀원 모두 조회
drop policy if exists leave_records_select on public.leave_records;
create policy leave_records_select on public.leave_records
  for select to authenticated
  using (public.is_active_member());

-- 본인 신청(상태 '신청'), 관리자는 누구 것이든 바로 등록 가능
drop policy if exists leave_records_insert on public.leave_records;
create policy leave_records_insert on public.leave_records
  for insert to authenticated
  with check (public.is_admin() or (profile_id = auth.uid() and status = '신청' and public.is_active_member()));

-- 승인 · 반려 · 수정은 관리자만
drop policy if exists leave_records_update on public.leave_records;
create policy leave_records_update on public.leave_records
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 본인은 아직 결정 전인 신청만 취소, 관리자는 모두
drop policy if exists leave_records_delete on public.leave_records;
create policy leave_records_delete on public.leave_records
  for delete to authenticated
  using (public.is_admin() or (profile_id = auth.uid() and status = '신청'));

revoke all on public.leave_records from anon;
grant select, insert, update, delete on public.leave_records to authenticated;

-- 결정 시각·결정자 기록 + 알림 (신청 → 관리자들, 결정 → 본인)
create or replace function public.leave_records_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('승인', '반려') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
  end if;
  if tg_op = 'INSERT' and new.status in ('승인', '반려') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists leave_records_touch on public.leave_records;
create trigger leave_records_touch
  before insert or update on public.leave_records
  for each row execute function public.leave_records_touch();

create or replace function public.leave_records_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  r record;
begin
  select p.name into v_name from public.profiles p where p.id = new.profile_id;
  if tg_op = 'INSERT' and new.status = '신청' then
    for r in select p.id from public.profiles p where p.role = 'admin' and p.active and p.id <> new.profile_id loop
      perform public.notify(r.id, '승인',
        '휴가 신청 · ' || coalesce(v_name, '팀원') || ' ' || new.kind,
        to_char(new.start_date, 'MM.DD') || case when new.end_date > new.start_date then '~' || to_char(new.end_date, 'MM.DD') else '' end
          || ' · ' || new.days || '일',
        '/team?view=leave');
    end loop;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('승인', '반려')
        and new.profile_id is distinct from auth.uid() then
    perform public.notify(new.profile_id, '승인',
      '휴가 ' || new.status || ' · ' || new.kind,
      to_char(new.start_date, 'MM.DD') || ' · ' || new.days || '일',
      '/team?view=leave');
  end if;
  return null;
end;
$$;

drop trigger if exists leave_records_notify on public.leave_records;
create trigger leave_records_notify
  after insert or update on public.leave_records
  for each row execute function public.leave_records_notify();

revoke execute on function public.leave_records_touch() from public, anon, authenticated;
revoke execute on function public.leave_records_notify() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) 에이전트 직접 지시
-- ---------------------------------------------------------------------
create table if not exists public.agent_instructions (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.profiles (id) on delete cascade,
  instruction  text not null check (char_length(btrim(instruction)) between 1 and 2000),
  status       text not null default '대기' check (status in ('대기', '진행 중', '완료', '보류')),
  response     text check (response is null or char_length(response) <= 4000),
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists agent_instructions_agent_idx on public.agent_instructions (agent_id, status, created_at);

alter table public.agent_instructions enable row level security;

drop policy if exists agent_instructions_select on public.agent_instructions;
create policy agent_instructions_select on public.agent_instructions
  for select to authenticated
  using (public.is_active_member());

-- 활성 팀원 누구나 AI 팀원에게만 지시 (본인 명의)
drop policy if exists agent_instructions_insert on public.agent_instructions;
create policy agent_instructions_insert on public.agent_instructions
  for insert to authenticated
  with check (
    public.is_active_member()
    and created_by = auth.uid()
    and status = '대기'
    and response is null
    and exists (select 1 from public.profiles a where a.id = agent_id and a.is_agent and a.active)
  );

-- 지시한 사람은 처리 전 지시를 취소, 관리자는 모두
drop policy if exists agent_instructions_delete on public.agent_instructions;
create policy agent_instructions_delete on public.agent_instructions
  for delete to authenticated
  using (public.is_admin() or (created_by = auth.uid() and status = '대기'));

revoke all on public.agent_instructions from anon;
grant select, insert, delete on public.agent_instructions to authenticated;

-- 에이전트: 처리할 지시 목록 (연결 프로필 앞으로 온 '대기' · '진행 중', 오래된 순)
create or replace function public.agent_instructions_pending(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  v_profile := public.agent_token_check(p_token, 'read');
  if v_profile is null then
    raise exception '이 토큰에는 연결된 AI 팀원 계정이 없습니다.'
      using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'instruction', i.instruction, 'status', i.status,
             'from', c.name, 'created_at', i.created_at)
           order by i.created_at)
    from public.agent_instructions i
    left join public.profiles c on c.id = i.created_by
    where i.agent_id = v_profile and i.status in ('대기', '진행 중')
  ), '[]'::jsonb);
end;
$$;

-- 에이전트: 처리 결과 남기기 → 지시한 사람에게 알림
create or replace function public.agent_instruction_respond(p_token text, p_id uuid, p_status text, p_response text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_row     public.agent_instructions;
begin
  v_profile := public.agent_token_check(p_token, 'task');
  if v_profile is null then
    raise exception '이 토큰에는 연결된 AI 팀원 계정이 없습니다.'
      using errcode = '42501';
  end if;
  if p_status not in ('진행 중', '완료', '보류') then
    raise exception 'status 는 진행 중 · 완료 · 보류 중 하나입니다.'
      using errcode = '22023';
  end if;
  if p_status in ('완료', '보류') and coalesce(btrim(p_response), '') = '' then
    raise exception '완료 · 보류에는 response(처리 결과)가 필요합니다.'
      using errcode = '22023';
  end if;

  update public.agent_instructions i
     set status = p_status,
         response = coalesce(nullif(left(btrim(p_response), 4000), ''), i.response),
         responded_at = now()
   where i.id = p_id and i.agent_id = v_profile
  returning * into v_row;

  if not found then
    raise exception '지시를 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if p_status in ('완료', '보류') and v_row.created_by is not null then
    perform public.notify(v_row.created_by, '할 일',
      'AI 지시 ' || p_status || ' · ' || left(v_row.instruction, 40),
      left(v_row.response, 120),
      '/?agent=1');
  end if;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

-- 에이전트는 anon 키 + 토큰으로 호출 (agent_submit · agent_snapshot 과 같은 방식)
revoke execute on function public.agent_instructions_pending(text), public.agent_instruction_respond(text, uuid, text, text) from public;
grant execute on function public.agent_instructions_pending(text), public.agent_instruction_respond(text, uuid, text, text) to anon, authenticated;

-- Realtime: 지시 상태 · 휴가 변경을 화면에 바로 반영
do $$
declare
  t text;
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['agent_instructions', 'leave_records'] loop
      if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
