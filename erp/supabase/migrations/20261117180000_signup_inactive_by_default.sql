-- 보안 보강 (2026-11-17): 공개 가입으로 생긴 계정은 '비활성'으로 시작한다.
-- 배경: Supabase Auth 의 공개 가입이 켜져 있으면 누구나 공개 키로 가입 · 메일 확인 뒤
--       기본값(active = true · role = member)으로 팀원 권한(is_active_member)을 얻을 수 있었다.
-- 관리자가 만든 계정(admin-create-user 함수 · app_metadata.wkly_admin_created = true · 서버만 쓸 수 있음)과
-- 맨 처음 계정만 활성. 비활성 계정은 is_active_member() 를 통과하지 못해 업무 자료를 볼 수 없고,
-- 관리자가 '팀원 관리'에서 켜야만 쓸 수 있다 (profiles_guard 가 본인 활성화를 막음).
-- 공개 가입 자체는 Supabase 대시보드 › Authentication › Sign In / Providers 에서 대표가 끈다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_first boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, name, role, active)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      ''
    ),
    case when v_first then 'admin' else 'member' end,
    v_first or coalesce((new.raw_app_meta_data ->> 'wkly_admin_created') = 'true', false)
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;
