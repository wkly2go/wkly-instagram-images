-- 서면 인터뷰 3단계 (2026-11-18 · 대표 지시 '제작은 광고 컨텐츠에서' · '전체 적용')
--  · 광고·콘텐츠 '인터뷰 피드' 제작 대기열: 인터뷰 한 줄에서 만든 콘텐츠(growth_items)를 content_id 로 잇는다
--  · 인터뷰 답을 받은 브랜드(예산 · 파트너 기준 · 향후 계획을 직접 답함)를 영업 후보(sales_prospects, 출처 '서면 인터뷰')로 올린다
--    한 번만 넣고(같은 인터뷰는 다시 넣지 않음) 불가 · 보류는 넣지 않는다. 메일은 보내지 않는다.

alter table public.sales_interviews add column if not exists content_id uuid references public.growth_items (id) on delete set null;
comment on column public.sales_interviews.content_id is '광고·콘텐츠에서 이 인터뷰로 만든 콘텐츠 (인터뷰 피드)';

create or replace function private.sales_interview_prospects()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.sales_prospects
    (source, source_key, name, entity_kind, organization, contact, source_url, evidence, event_data, source_updated_at,
     assessment, score, reasons, next_action)
  select '서면 인터뷰', s.id::text, left(s.brand, 120), '영업 기회', left(s.brand, 200), coalesce(s.emails[1], ''), '',
         left(concat_ws(' · ', '더위클리 서면 인터뷰', nullif(trim(s.event_name), ''), nullif(trim(s.venue), ''),
           '예산 ' || coalesce(nullif(trim(s.sales_info ->> 'budget'), ''), nullif(trim(s.answers ->> 'Q3'), ''), '미응답'),
           case when coalesce(trim(s.sales_info ->> 'partner'), '') <> '' then '파트너 기준 ' || trim(s.sales_info ->> 'partner') end,
           case when coalesce(trim(s.sales_info ->> 'next_plan'), '') <> '' then '차기 계획 ' || trim(s.sales_info ->> 'next_plan') end,
           case when coalesce(trim(s.answers ->> 'Q10'), '') <> '' then '향후 계획 답 ' || left(trim(s.answers ->> 'Q10'), 700) end), 1500),
         jsonb_build_object('interview_id', s.id, 'category', s.sales_info ->> 'category', 'region', s.sales_info ->> 'region',
           'budget', coalesce(nullif(trim(s.sales_info ->> 'budget'), ''), nullif(trim(s.answers ->> 'Q3'), ''))),
         coalesce(s.answered_at, s.updated_at), '우선 검토',
         case when coalesce(s.sales_info ->> 'budget', s.answers ->> 'Q3', '') ~ '5,?000만원 이상' then 90
              when coalesce(s.sales_info ->> 'budget', s.answers ->> 'Q3', '') ~ '(3,?000|5,?000)만원 이하' then 80
              else 70 end,
         '서면 인터뷰에서 예산 · 파트너 선정 기준 · 향후 계획을 직접 답한 브랜드',
         '인터뷰 피드 게시 뒤 감사 인사와 함께 다음 팝업 기획 · 제작 제안 (향후 계획 · 파트너 기준 참고)'
  from public.sales_interviews s
  where s.answers <> '{}'::jsonb and s.stage not in ('불가', '보류')
  on conflict (source, source_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function private.sales_interview_prospects() from public, anon, authenticated;

insert into private.sales_ops_steps (step, label, call, every_min, grace_min, enabled)
values ('interview_prospects', '서면 인터뷰 → 영업 후보', 'private.sales_interview_prospects()', 10, 10, true)
on conflict (step) do update
  set label = excluded.label, call = excluded.call, every_min = excluded.every_min, grace_min = excluded.grace_min;
