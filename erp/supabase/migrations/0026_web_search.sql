-- WKLY ERP 0026: 인트라넷 구글 검색 — 관리자가 Google 프로그래머블 검색 ID(cx)를 넣으면 검색 결과를 인트라넷 오른쪽 창 안에 표시
create or replace function public.set_app_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if p_key not in ('attendance_desktop_only', 'work_start', 'plan_deadline', 'google_cse_cx') then
    raise exception '알 수 없는 설정입니다.' using errcode = '22023';
  end if;
  if p_key in ('work_start', 'plan_deadline') and (jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception '시각은 HH:MM 형식이어야 합니다.' using errcode = '22023';
  end if;
  if p_key = 'google_cse_cx' and not (p_value = 'null'::jsonb or (jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[A-Za-z0-9:_-]{5,80}$')) then
    raise exception '검색엔진 ID 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
