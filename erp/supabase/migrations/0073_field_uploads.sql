-- 취재 자료 올리기 (대표 지시 2026-10-31 "인트라넷에 취재 자료 구분없이 올리기가 좋은 거 같아,
--   에이전트와 사람 팀원이 모두 편리하게 사용 가능하도록")
--  - 사람: 인트라넷에서 파일만 끌어다 놓음 (장소 · 메모 · 프로젝트는 적고 싶으면만)
--  - 드라이브: #WKLY_2026 / 01. 매거진 촬영본 / 📥 취재 자료 (인트라넷 올리기) / YYMMDD_장소 / 원본
--  - 에이전트: 이 표에서 status='새 자료' 를 읽고 폴더 id 로 바로 엶 → 분류 · 기획에 쓰면 status · agent_note 를 고침
create table if not exists public.field_uploads (
  id uuid primary key default gen_random_uuid(),
  shot_on date not null default ((now() at time zone 'Asia/Seoul')::date),
  place text,
  memo text,
  project_id uuid references public.projects (id) on delete set null,
  folder_id text not null,
  folder_url text not null,
  file_count integer not null default 0,
  files jsonb not null default '[]'::jsonb,
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  status text not null default '새 자료' check (status in ('새 자료', '분류 완료', '사용 완료')),
  category text,
  agent_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.field_uploads is '취재 자료 올리기: 팀원이 인트라넷에서 구분 없이 올린 사진 · 영상 묶음 (드라이브 폴더 1곳 = 1줄). 에이전트는 status=새 자료 를 읽어 분류 · 기획에 씀';
comment on column public.field_uploads.files is '[{id, name, mime, size}] 드라이브 파일';
comment on column public.field_uploads.category is '에이전트가 정한 분류 (팝업 아이템 · 인터뷰 큐레이션 · 코스 추천 릴스 · 공간대관 · 현장 작업 영상 등)';

create index if not exists field_uploads_status_idx on public.field_uploads (status, created_at desc);

alter table public.field_uploads enable row level security;
create policy field_uploads_read on public.field_uploads for select to authenticated using (public.is_active_member());
create policy field_uploads_insert on public.field_uploads for insert to authenticated with check (public.is_active_member());
create policy field_uploads_update on public.field_uploads for update to authenticated using (public.is_active_member()) with check (public.is_active_member());

-- 올린 폴더 위치 (관리자가 바꿀 수 있게 설정값으로)
insert into public.app_settings (key, value, updated_at)
values ('field_upload_folder', to_jsonb('1T5tqg7cA5KXWRBk7qi0kO5Zg0Cn2J2gB'::text), now())
on conflict (key) do nothing;
