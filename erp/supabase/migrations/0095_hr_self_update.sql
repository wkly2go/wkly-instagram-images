-- 개인정보 관리: 본인이 연락처 · 주소 · 비상 연락처 · 급여 계좌만 직접 고침 (대표 지시 2026-11-06 "개인정보 관리 공간도 필요해 연차와 휴가관리등")
--   사원번호 · 직급 · 입사일 · 연차 조정 · 비고는 관리자만 (hr_records 수정 정책은 그대로 관리자만)
create or replace function public.hr_self_update(
  p_phone text, p_birthday date, p_address text, p_emergency text,
  p_bank text, p_account text, p_holder text
) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.is_active_member() then raise exception '팀원만 쓸 수 있습니다.'; end if;
  insert into public.hr_records as h (profile_id, phone, birthday, address, emergency_contact, bank_name, account_no, account_holder, updated_at, updated_by)
  values (uid, nullif(trim(p_phone), ''), p_birthday, nullif(trim(p_address), ''), nullif(trim(p_emergency), ''),
          nullif(trim(p_bank), ''), nullif(trim(p_account), ''), nullif(trim(p_holder), ''), now(), uid)
  on conflict (profile_id) do update set
    phone = excluded.phone, birthday = excluded.birthday, address = excluded.address, emergency_contact = excluded.emergency_contact,
    bank_name = excluded.bank_name, account_no = excluded.account_no, account_holder = excluded.account_holder,
    updated_at = now(), updated_by = uid;
end $$;
revoke all on function public.hr_self_update(text, date, text, text, text, text, text) from public, anon;
grant execute on function public.hr_self_update(text, date, text, text, text, text, text) to authenticated;
