-- 콘텐츠 게시 예정일 · 주간 달력 (2026-11-27 마케팅 대시보드 — 참고 화면의 주간 달력처럼 미리 일정을 잡을 수 있게)
--  콘텐츠 문서(growth_items.document)는 저장 함수가 형식을 엄격히 검사하므로 건드리지 않고, 예정일만 따로 둔다.
--  예정일은 사람이 정한다 (자동 게시 · 예약 발행 없음 — 달력에 놓일 뿐).
create table if not exists public.growth_schedule (
  item_id uuid primary key references public.growth_items(id) on delete cascade,
  planned_on date not null,
  set_by uuid references public.profiles(id) default auth.uid(),
  set_at timestamptz not null default now()
);
alter table public.growth_schedule enable row level security;
drop policy if exists growth_schedule_read on public.growth_schedule;
create policy growth_schedule_read on public.growth_schedule for select to authenticated using ((select public.is_active_member()));
drop policy if exists growth_schedule_insert on public.growth_schedule;
create policy growth_schedule_insert on public.growth_schedule for insert to authenticated with check ((select public.is_active_member()));
drop policy if exists growth_schedule_update on public.growth_schedule;
create policy growth_schedule_update on public.growth_schedule for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
drop policy if exists growth_schedule_delete on public.growth_schedule;
create policy growth_schedule_delete on public.growth_schedule for delete to authenticated using ((select public.is_active_member()));
revoke all on public.growth_schedule from anon;
grant select, insert, update, delete on public.growth_schedule to authenticated;

-- 한 주(월~일) 달력: 예정일이 그 주인 콘텐츠 + 예정일 없이 그 주에 고친 콘텐츠 + 그 주 영상 편집, 그리고 예정일을 아직 안 잡은 진행 중 콘텐츠
create or replace function public.marketing_calendar(p_start date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with t as (
    select coalesce(p_start, (now() at time zone 'Asia/Seoul')::date - ((extract(isodow from (now() at time zone 'Asia/Seoul')::date))::int - 1)) s
  ), c as (
    select g.id, g.title, g.status, g.updated_at, s.planned_on,
           (select coalesce(jsonb_agg(v->>'channel'), '[]'::jsonb) from jsonb_array_elements(coalesce(g.document->'versions', '[]'::jsonb)) v where coalesce(v->>'body', '') <> '') channels
      from public.growth_items g left join public.growth_schedule s on s.item_id = g.id
     where g.kind = 'content'
  )
  select jsonb_build_object(
    'week_start', (select s from t),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day, x.title), '[]'::jsonb) from (
        select c.id::text as id, 'content' as type, c.title, c.status, c.planned_on as day, true as planned, c.channels
          from c, t where c.planned_on between t.s and t.s + 6
        union all
        select c.id::text, 'content', c.title, c.status, (c.updated_at at time zone 'Asia/Seoul')::date, false, c.channels
          from c, t where c.planned_on is null and (c.updated_at at time zone 'Asia/Seoul')::date between t.s and t.s + 6
        union all
        select j.id::text, 'video', j.title, j.status, (coalesce(j.finished_at, j.created_at) at time zone 'Asia/Seoul')::date, false, '["영상"]'::jsonb
          from public.video_edit_jobs j, t
         where j.status <> '취소' and (coalesce(j.finished_at, j.created_at) at time zone 'Asia/Seoul')::date between t.s and t.s + 6
        limit 80) x),
    'unplanned', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from (
        select c.id::text as id, c.title, c.status from c where c.planned_on is null and c.status in ('작성 중', '검수 중') order by c.updated_at desc limit 20) u)
  )
$$;
revoke all on function public.marketing_calendar(date) from public, anon;
grant execute on function public.marketing_calendar(date) to authenticated;
