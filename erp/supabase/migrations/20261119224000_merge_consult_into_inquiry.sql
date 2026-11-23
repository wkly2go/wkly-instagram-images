-- 2026-11-19 대표 지시 '문의와 상담협의를 합쳐' → 이름은 '문의' (대표 선택)
-- '상담협의' 프로젝트를 모두 '문의'로 옮기고, 예전 화면 · AI 비서 · 서버 함수(홈페이지 문의 자동 프로젝트 등)가 '상담협의'를 보내도
-- 저장할 때 '문의'로 바꾼다(기획 → 문의 와 같은 트리거). 상태 제약은 그대로 둔다(DROP 없이 · 남아 있어도 트리거가 먼저 바꿈).
create or replace function private.project_status_alias()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('기획', '상담협의') then new.status := '문의'; end if;
  return new;
end $$;

update public.projects set status = '문의', updated_at = now() where status = '상담협의';
