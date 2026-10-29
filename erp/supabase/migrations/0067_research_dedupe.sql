-- 0067 자료실 중복 정리 (대표 지시 2026-10-29 "중복되는 것들 확인")
--   - 같은 종류 + 같은 제목(띄어쓰기 · 대소문자 무시)이 90일 안에 다시 들어오면 막음 (에이전트가 같은 공고를 두 번 올리던 것)
--   - 이미 들어간 중복은 지우지 않고 나중 것을 '보관'으로
--   같은 기사 주소라도 종류가 다르면(뉴스 다이제스트 · 트렌드 · 콘텐츠 소재) 다른 자료로 둠

create or replace function private.research_title_key(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(coalesce(p, ''), '\s+', '', 'g'))
$$;

create or replace function private.research_no_dup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.research_items r
     where r.kind = new.kind
       and private.research_title_key(r.title) = private.research_title_key(new.title)
       and r.created_at > now() - interval '90 days'
  ) then
    raise exception '이미 같은 자료가 있습니다: %', new.title using errcode = '23505';
  end if;
  return new;
end $$;

create or replace trigger research_items_no_dup before insert on public.research_items
  for each row execute function private.research_no_dup();

update public.research_items r set status = '보관'
 where r.status <> '보관'
   and exists (
     select 1 from public.research_items o
      where o.kind = r.kind
        and private.research_title_key(o.title) = private.research_title_key(r.title)
        and (o.created_at, o.id::text) < (r.created_at, r.id::text)
   );
