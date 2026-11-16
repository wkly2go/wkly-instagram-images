-- 위쪽 바 기념일 · 이벤트 디자인 (대표 지시 2026-11-16 '직원들 생일이면 생일축하 이벤트 디자인 · 크리스마스 한달전에는 크리스마스디자인')
--   인사 기록(생일 · 입사일)은 본인 · 관리자만 보므로, 오늘(한국 시각) 생일 · 입사 기념일인 사람의 '이름'만 돌려준다.
--   생일 날짜 · 나이 · 다른 날의 생일은 돌려주지 않는다. 2월 29일생은 평년에는 2월 28일에 축하.
--   회사 기념일(창립일 등)은 app_settings 'topbar_events' (관리자 set_app_setting) 에 [{ "date": "MM-DD", "title": "...", "since": 2025 }]
create or replace function public.topbar_events()
returns jsonb
language sql stable security definer set search_path = '' as $$
  with today as (select (now() at time zone 'Asia/Seoul')::date d),
  md as (
    select d,
      to_char(d, 'MM-DD') as k,
      (extract(month from d) = 2 and extract(day from d) = 28
        and not (extract(year from d)::int % 4 = 0 and (extract(year from d)::int % 100 <> 0 or extract(year from d)::int % 400 = 0))) as leap_fallback
    from today
  ),
  people as (
    select p.id, p.name, h.birthday, h.joined_on
    from public.profiles p join public.hr_records h on h.profile_id = p.id
    where p.active and not coalesce(p.is_agent, false)
  )
  select case when not public.is_active_member() then '{}'::jsonb else jsonb_build_object(
    'date', (select d from today),
    'birthdays', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
      from people x, md
      where x.birthday is not null
        and (to_char(x.birthday, 'MM-DD') = md.k or (md.leap_fallback and to_char(x.birthday, 'MM-DD') = '02-29'))
    ), '[]'::jsonb),
    'anniversaries', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'years', extract(year from md.d)::int - extract(year from x.joined_on)::int) order by x.name)
      from people x, md
      where x.joined_on is not null and x.joined_on < md.d
        and (to_char(x.joined_on, 'MM-DD') = md.k or (md.leap_fallback and to_char(x.joined_on, 'MM-DD') = '02-29'))
    ), '[]'::jsonb),
    'custom', coalesce((select s.value from public.app_settings s where s.key = 'topbar_events' and jsonb_typeof(s.value) = 'array'), '[]'::jsonb)
  ) end
$$;
revoke all on function public.topbar_events() from public, anon;
grant execute on function public.topbar_events() to authenticated;
comment on function public.topbar_events() is '위쪽 바 이벤트: 오늘 생일 · 입사 기념일인 팀원 이름과 회사 기념일 목록 (날짜 · 나이는 노출 안 함)';
