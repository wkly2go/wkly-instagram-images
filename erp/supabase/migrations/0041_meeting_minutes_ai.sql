-- 0041 · 회의록 AI (대표 지시 2026-10-18 "회의록 작성 ai에이전트가 회의 내용을 듣고 정리" · 방법 B)
-- 회의를 녹음해 올리면 서버 함수 meeting-minutes 가 Gemini 로 화자를 나눠 받아쓰고 회의록 초안으로 정리.
-- Gemini 키는 Vault 'GEMINI_API_KEY' (research_secret, 서버만 읽음). 녹음 원본은 30일 뒤 자동 삭제.
create table if not exists public.meeting_recordings (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text,
  attendees text,
  audio_path text,
  mime text,
  duration_sec integer,
  status text not null default '업로드' check (status in ('업로드', '처리 중', '완료', '실패')),
  transcript text,
  minutes text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meeting_recordings_owner_idx on public.meeting_recordings (created_by, created_at desc);
alter table public.meeting_recordings enable row level security;
create policy meeting_recordings_select on public.meeting_recordings for select to authenticated using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
create policy meeting_recordings_insert on public.meeting_recordings for insert to authenticated with check ((select public.is_active_member()) and created_by = (select auth.uid()));
create policy meeting_recordings_delete on public.meeting_recordings for delete to authenticated using (created_by = (select auth.uid()) or (select public.is_admin()));
grant select, insert, delete on public.meeting_recordings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-audio', 'meeting-audio', false, 209715200, array['audio/webm','audio/ogg','audio/mp4','audio/m4a','audio/x-m4a','audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/aac','video/webm','video/mp4'])
on conflict (id) do nothing;
-- 녹음은 본인 폴더(<user id>/...)에만 올리고, 본인 · 관리자만 열람
create policy meeting_audio_insert on storage.objects for insert to authenticated with check (bucket_id = 'meeting-audio' and (select public.is_active_member()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy meeting_audio_select on storage.objects for select to authenticated using (bucket_id = 'meeting-audio' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));
create policy meeting_audio_delete on storage.objects for delete to authenticated using (bucket_id = 'meeting-audio' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));
