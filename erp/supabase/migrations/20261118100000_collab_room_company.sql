-- 외부 협업방: 외부인에게 보이는 회사 이름 (2026-11-18)
-- 기본은 프로젝트 구분(아트리어 · 더위클리)으로 정하지만, 거래처가 우리를 다른 이름(예: 아트리어 일을 '더위클리'로 소개)으로 알 때 방마다 바꿈
alter table public.collab_rooms add column if not exists company text check (company is null or char_length(btrim(company)) between 1 and 40);
grant update (company) on public.collab_rooms to authenticated;
