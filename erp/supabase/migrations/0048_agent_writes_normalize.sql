-- AI 보고 · 할 일 · 자료가 정해진 값 밖의 말을 써서 통째로 거부되던 것 수정: 가까운 값으로 바꿔 저장
create or replace function private.agent_reports_normalize() returns trigger
language plpgsql set search_path = '' as $$
declare v text := coalesce(new.verdict, '');
begin
  if v = any (array['완료','변동 없음','일부 실패','실패','미실행','진행 중']) then return new; end if;
  new.verdict := case
    when v ~ '일부|부분' then '일부 실패'
    when v ~ '실패|오류|에러' then '실패'
    when v ~ '변동|없음|이상 ?없' then '변동 없음'
    when v ~ '미실행|중단|건너|생략|skip' then '미실행'
    when v ~ '진행|대기|보류|확인' then '진행 중'
    else '완료' end;
  if v <> '' then new.body := '판정: ' || v || E'\n' || coalesce(new.body, ''); end if;
  return new;
end $$;
create or replace trigger agent_reports_normalize before insert or update of verdict on public.agent_reports
  for each row execute function private.agent_reports_normalize();

create or replace function private.tasks_status_normalize() returns trigger
language plpgsql set search_path = '' as $$
declare v text := coalesce(new.status, '');
begin
  if v = any (array['할 일','진행 중','완료']) then return new; end if;
  new.status := case when v ~ '완료|끝|done' then '완료' when v ~ '진행|작업 ?중|검토' then '진행 중' else '할 일' end;
  return new;
end $$;
create or replace trigger tasks_status_normalize before insert or update of status on public.tasks
  for each row execute function private.tasks_status_normalize();

create or replace function private.research_items_normalize() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (new.kind = any (array['거래처 리포트','팝업','브랜드','트렌드','경쟁사','인터뷰','기타'])) then
    new.tags := array(select distinct x from unnest(coalesce(new.tags, '{}'::text[]) || new.kind) x where x is not null);
    new.kind := case when new.kind ~ '팝업' then '팝업' when new.kind ~ '브랜드' then '브랜드' when new.kind ~ '트렌드|뉴스|소재' then '트렌드'
                     when new.kind ~ '경쟁' then '경쟁사' when new.kind ~ '인터뷰|협업' then '인터뷰' else '기타' end;
  end if;
  if new.collected_by_agent is not null and not exists (select 1 from public.profiles p where p.id = new.collected_by_agent) then
    new.collected_by_agent := null;
  end if;
  return new;
end $$;
create or replace trigger research_items_normalize before insert or update of kind, collected_by_agent on public.research_items
  for each row execute function private.research_items_normalize();
