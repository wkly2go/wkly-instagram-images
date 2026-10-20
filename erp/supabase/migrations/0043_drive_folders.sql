-- 0043 · 구글 드라이브 탭 (대표 지시 2026-10-20 "구글드라이브 오른쪽 탭에 넣어줘")
-- 관리자가 회사 공용 드라이브 폴더(이름 · 주소)를 등록 → 모든 팀원이 드라이브 탭에서 바로 엶
-- app_settings 'drive_folders' = [{"name": "...", "url": "https://drive.google.com/..."}] (최대 40개)
create or replace function public.set_app_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.is_admin() then
    raise exception '관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if p_key not in ('attendance_desktop_only', 'work_start', 'plan_deadline', 'google_cse_cx', 'drive_folders') then
    raise exception '알 수 없는 설정입니다.' using errcode = '22023';
  end if;
  if p_key in ('work_start', 'plan_deadline') and (jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception '시각은 HH:MM 형식이어야 합니다.' using errcode = '22023';
  end if;
  if p_key = 'google_cse_cx' and not (p_value = 'null'::jsonb or (jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[A-Za-z0-9:_-]{5,80}$')) then
    raise exception '검색엔진 ID 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if p_key = 'drive_folders' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 40 then
      raise exception '드라이브 폴더는 40개까지 등록할 수 있습니다.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_value) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(btrim(e ->> 'name'), '') = '' or length(e ->> 'name') > 60
         or coalesce(e ->> 'url', '') !~ '^https://(drive|docs)\.google\.com/[^\s<>"]{1,500}$'
    ) then
      raise exception '폴더 이름(60자 이내)과 구글 드라이브 주소(https://drive.google.com/…)를 확인해 주세요.' using errcode = '22023';
    end if;
  end if;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$function$;
