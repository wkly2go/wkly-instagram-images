-- 웹 문의 → 영업 대상 자동 등록 (2026-11-17 대표 지시 '영업대상화해')
-- 홈페이지 문의(web_inquiries) 가운데 아직 처리하지 않은(신규) 것을 영업 대상(sales_prospects · source '웹 문의')으로 올린다.
--  · 직접 문의: 모두
--  · 리포트 신청 중 기획 · 준비 · 입지 검토를 고른 것: 소식 수신에 동의한 경우만 (홈페이지에서 동의했거나 문의함에서 '[수신 동의]'로 기록한 것 · 동의 없는 영업 연락을 막음)
--  · 브랜드명이 없고 개인 메일(naver · gmail 등)이면 이름을 '개인 신청자 MM-DD'로 (메일 회사를 거래처로 오해하지 않게)
--  · 구독 · 그 밖의 자료 신청: 올리지 않음
-- 문의함에서 '제외'로 바꾸거나 수신 동의 표시를 되돌리면 그 대상은 연락하지 않도록 막는다. SQL 만 쓰며 AI · 외부 호출이 없다.
create or replace function private.sales_inquiry_prospects() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  insert into public.sales_prospects (source, source_key, name, entity_kind, organization, contact, evidence, event_data, source_updated_at, assessment, score, reasons, next_action)
  select '웹 문의', w.id::text,
    left(coalesce(nullif(trim(w.brand), ''), case when lower(split_part(w.email, '@', 2)) in ('naver.com', 'gmail.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'icloud.com', 'outlook.com', 'hotmail.com') or split_part(w.email, '@', 2) = '' then '개인 신청자 ' || to_char(w.submitted_at at time zone 'Asia/Seoul', 'MM-DD') else split_part(w.email, '@', 2) end), 120),
    '영업 기회', coalesce(nullif(trim(w.brand), ''), ''), trim(w.email),
    left((case when w.kind = '문의' then '홈페이지 문의' else '리포트 신청 · ' || coalesce(w.category, '') end)
      || ' · ' || coalesce(w.site_name, w.site) || ' · ' || to_char(w.submitted_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
      || coalesce(' · ' || nullif(trim(w.title), ''), '') || coalesce(' / ' || left(nullif(trim(w.detail), ''), 600), ''), 1500),
    jsonb_build_object('inquiry_id', w.id, 'kind', w.kind, 'category', w.category, 'site', w.site, 'submitted_at', w.submitted_at,
      'is_ad', coalesce(w.is_ad, false), 'utm_source', w.utm_source, 'utm_campaign', w.utm_campaign, 'newsletter', coalesce(w.newsletter, false)),
    w.submitted_at, '우선 검토', case when w.kind = '문의' then 90 else 70 end,
    case when w.kind = '문의' then '우리에게 직접 온 문의' else '리포트 신청(' || w.category || ') · 소식 수신 동의' end,
    case when w.kind = '문의' then '받은 문의에 답장 기획 (일정 · 규모 · 예산 확인)' else '신청한 리포트 주제에 맞춘 후속 제안 기획' end
  from public.web_inquiries w
  where not coalesce(w.is_test, false)
    and coalesce(w.status, '신규') = '신규'
    and w.submitted_at >= now() - interval '90 days'
    and nullif(trim(w.email), '') is not null
    and (w.kind = '문의'
      or (w.kind = '리포트 신청' and w.category in ('다음 팝업 기획', '첫 팝업 준비', '상권·입지 검토') and (w.newsletter is true or coalesce(w.memo, '') like '%[수신 동의]%')))
  on conflict (source, source_key) do nothing;
  get diagnostics v_n = row_count;
  update public.sales_prospects p set blocked = true, next_action = '문의함에서 제외 또는 수신 미동의 · 연락하지 않음'
  from public.web_inquiries w
  where p.source = '웹 문의' and p.source_key = w.id::text and (w.status = '제외' or (w.kind <> '문의' and not (w.newsletter is true or coalesce(w.memo, '') like '%[수신 동의]%'))) and not coalesce(p.blocked, false);
  return v_n;
end $$;
revoke all on function private.sales_inquiry_prospects() from public, anon, authenticated;

insert into private.sales_ops_steps (step, label, call, every_min, at_hours, at_minutes, at_dow, grace_min)
values ('inquiry_prospects', '웹 문의 → 영업 대상', 'private.sales_inquiry_prospects()', 10, null, null, null, 10)
on conflict (step) do nothing;
