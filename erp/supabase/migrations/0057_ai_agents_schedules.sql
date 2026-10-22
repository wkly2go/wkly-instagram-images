-- 인트라넷에서 AI 팀원 만들기 · 업무 지시 · 예약 (대표 지시 2026-10-23
--  "인트라넷에서 ai 에이전트를 만들고 업무 지시를 하고 일정이나 예약을 만들 수 있게, 회사 업무는 모두 인트라넷에서")
--  - ai_agents: AI 팀원마다 역할 · 지침 · 쓸 수 있는 도구 · 담당자 (계정은 admin-create-user 함수가 is_agent 로 만듦)
--  - agent_schedules: '내일 15시에 …' · '평일 9시마다 …' 같은 예약 → 때가 되면 그 AI 에게 지시로 넘김 (1분마다 확인)
--  - 지시는 기존 agent_instructions 로 바로 처리 (agent-chat 함수)

create table if not exists public.ai_agents (
  profile_id   uuid primary key references public.profiles (id) on delete cascade,
  role         text not null default '' check (char_length(role) <= 200),
  instructions text not null default '' check (char_length(instructions) <= 6000),
  tools        text[] not null default '{}',          -- 비어 있으면 기본 도구 전부
  owner_id     uuid references public.profiles (id) on delete set null,
  model        text not null default '기본' check (model in ('기본', '꼼꼼')),
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.ai_agents enable row level security;
create policy ai_agents_select on public.ai_agents for select to authenticated using ((select public.is_active_member()));
create policy ai_agents_admin on public.ai_agents for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()) and exists (select 1 from public.profiles p where p.id = profile_id and p.is_agent));
create or replace trigger ai_agents_updated before update on public.ai_agents for each row execute function public.set_updated_at();

create table if not exists public.agent_schedules (
  id                  uuid primary key default gen_random_uuid(),
  agent_id            uuid not null references public.profiles (id) on delete cascade,
  title               text not null check (char_length(btrim(title)) between 1 and 100),
  instruction         text not null check (char_length(btrim(instruction)) between 1 and 2000),
  repeat              text not null default '한 번' check (repeat in ('한 번', '매일', '평일', '매주', '매월')),
  run_at              timestamptz,                      -- 한 번
  time_of_day         time,                             -- 반복 (한국 시각)
  weekdays            smallint[] not null default '{}', -- 매주: 0 일 … 6 토
  month_day           smallint check (month_day between 1 and 31),
  enabled             boolean not null default true,
  next_run_at         timestamptz,
  last_run_at         timestamptz,
  last_instruction_id uuid references public.agent_instructions (id) on delete set null,
  runs                integer not null default 0,
  created_by          uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (repeat <> '한 번' or run_at is not null),
  check (repeat = '한 번' or time_of_day is not null),
  check (repeat <> '매주' or cardinality(weekdays) > 0),
  check (repeat <> '매월' or month_day is not null)
);
create index if not exists agent_schedules_due_idx on public.agent_schedules (next_run_at) where enabled;
alter table public.agent_schedules enable row level security;
create policy agent_schedules_select on public.agent_schedules for select to authenticated using ((select public.is_active_member()));
create policy agent_schedules_insert on public.agent_schedules for insert to authenticated
  with check (
    (select public.is_active_member()) and created_by = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = agent_id and p.is_agent and p.active)
  );
create policy agent_schedules_update on public.agent_schedules for update to authenticated
  using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())))
  with check (exists (select 1 from public.profiles p where p.id = agent_id and p.is_agent));
create policy agent_schedules_delete on public.agent_schedules for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

-- 다음 실행 시각 (한국 시각 기준) : p_after 보다 뒤의 첫 시각
create or replace function private.schedule_next(s public.agent_schedules, p_after timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  d    date := (p_after at time zone 'Asia/Seoul')::date;
  t    timestamptz;
  i    int;
begin
  if s.repeat = '한 번' then
    return case when s.run_at > p_after then s.run_at else null end;
  end if;
  for i in 0..62 loop
    t := ((d + i) + s.time_of_day) at time zone 'Asia/Seoul';
    if t > p_after and (
      s.repeat = '매일'
      or (s.repeat = '평일' and extract(isodow from d + i) < 6)
      or (s.repeat = '매주' and extract(dow from d + i)::smallint = any (s.weekdays))
      or (s.repeat = '매월' and extract(day from d + i) = least(s.month_day, extract(day from (date_trunc('month', d + i) + interval '1 month - 1 day'))::int))
    ) then
      return t;
    end if;
  end loop;
  return null;
end $$;

create or replace function private.agent_schedule_prepare()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.repeat is distinct from old.repeat or new.run_at is distinct from old.run_at or new.time_of_day is distinct from old.time_of_day
     or new.weekdays is distinct from old.weekdays or new.month_day is distinct from old.month_day or (new.enabled and not old.enabled) then
    new.next_run_at := private.schedule_next(new, now());
    if new.next_run_at is null and new.repeat = '한 번' then new.enabled := false; end if;
  end if;
  return new;
end $$;
create or replace trigger agent_schedules_prepare before insert or update on public.agent_schedules
  for each row execute function private.agent_schedule_prepare();

-- 1분마다: 때가 된 예약을 그 AI 에게 지시로 넘김 → agent_instructions 트리거가 바로 처리
create or replace function private.run_agent_schedules()
returns void language plpgsql security definer set search_path = '' as $$
declare
  s     public.agent_schedules%rowtype;
  v_ins uuid;
  v_by  uuid;
begin
  for s in
    select * from public.agent_schedules
    where enabled and next_run_at is not null and next_run_at <= now()
    order by next_run_at limit 20
    for update skip locked
  loop
    v_by := null;
    -- 지시한 사람: 만든 사람(활성) → 없으면 AI 담당자 → 관리자
    select p.id into v_by from public.profiles p where p.id = s.created_by and p.active and not p.is_agent;
    if v_by is null then select a.owner_id into v_by from public.ai_agents a join public.profiles p on p.id = a.owner_id and p.active where a.profile_id = s.agent_id; end if;
    if v_by is null then select p.id into v_by from public.profiles p where p.role = 'admin' and p.active and not p.is_agent order by p.created_at limit 1; end if;
    v_ins := null;
    if exists (select 1 from public.profiles p where p.id = s.agent_id and p.is_agent and p.active) then
      insert into public.agent_instructions (agent_id, instruction, created_by)
      values (s.agent_id, left(format(E'[예약 · %s] %s\n\n%s', s.repeat, s.title, s.instruction), 2000), v_by)
      returning id into v_ins;
    end if;
    update public.agent_schedules
       set last_run_at = now(),
           last_instruction_id = coalesce(v_ins, last_instruction_id),
           runs = runs + case when v_ins is null then 0 else 1 end,
           next_run_at = private.schedule_next(s, now()),
           enabled = (s.repeat <> '한 번') and private.schedule_next(s, now()) is not null
     where id = s.id;
  end loop;
end $$;
revoke all on function private.run_agent_schedules() from public, anon, authenticated;
select cron.schedule('wkly_agent_schedules', '* * * * *', 'select private.run_agent_schedules()');

-- 기존 AI 팀원(총괄)도 설정 줄을 만들어 둠 (역할만, 지침은 함수 안 기본값)
insert into public.ai_agents (profile_id, role, created_by)
select p.id, coalesce(p.title, 'AI 팀원'), null from public.profiles p where p.is_agent
on conflict (profile_id) do nothing;

alter publication supabase_realtime add table public.agent_schedules;
