-- 리서치 자료 종류 막기 (대표 지시 2026-11-12 "에이전트가 못 만들게 해 · 만들지 말라고 요청해")
--  - '촬영 요청' · 'SEO 개선' 자료는 삭제했고 다시 만들지 않음 → research_items 에 이 종류로 넣거나 바꾸면 거절
--  - 에이전트에는 agent_directives 로 따로 요청함 (콘텐츠 디자인·영상 GFX 등)
create or replace function public.research_items_block_kinds()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.kind in ('촬영 요청', 'SEO 개선') then
    raise exception '대표 지시(2026-11-12)로 ''%'' 자료는 만들지 않습니다. 필요한 내용은 할 일(tasks)로 남겨 주세요.', new.kind using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists research_items_block_kinds on public.research_items;
create trigger research_items_block_kinds before insert or update of kind on public.research_items
  for each row execute function public.research_items_block_kinds();
