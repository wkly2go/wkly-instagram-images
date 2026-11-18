-- 2026-11-17 보안 점검: 팀원이 자기 이름을 다른 사람(대표 등) 이름으로 바꿔 AI · 팀원을 속일 수 있었음
-- 관리자가 아닌 사람은: 이메일 · 관리자(manager_id) · id 를 못 바꾸고, 이름은 다른 사람과 같게 못 바꾸며 '대표'를 넣을 수 없음
create or replace function public.profiles_identity_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
declare norm text;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.id is distinct from old.id or new.email is distinct from old.email or new.manager_id is distinct from old.manager_id then
    raise exception '이메일 · 관리자 지정은 관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if new.name is distinct from old.name then
    norm := lower(regexp_replace(coalesce(new.name, ''), '\s', '', 'g'));
    if norm = '' then raise exception '이름을 비울 수 없습니다.' using errcode = '22023'; end if;
    if norm like '%대표%' then raise exception '이름에 ''대표''는 넣을 수 없습니다. 관리자에게 부탁해 주세요.' using errcode = '42501'; end if;
    if exists (select 1 from public.profiles p where p.id <> new.id
               and lower(regexp_replace(coalesce(p.name, ''), '\s', '', 'g')) = norm) then
      raise exception '다른 사람과 같은 이름으로 바꿀 수 없습니다.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_identity_guard on public.profiles;
create trigger profiles_identity_guard before update on public.profiles
  for each row execute function public.profiles_identity_guard();
