-- 2026-11-20 서면 인터뷰지 사진 · 자료 올리기 칸 (인터뷰지 '남은 것' · 대표 지시 '너가 전부 작업하고')
-- 브랜드 담당자가 /i/<토큰> 화면에서 사진 · 자료(제품 사진 · 현장 사진 · 소개서 PDF 등)를 올리면
--   비공개 보관함 interview-files 의 <토큰>/ 폴더에 들어가고 → sales_interview_files 에 한 줄 → 담당자 알림 → 서면 인터뷰 화면 · 인터뷰 피드에서 내려받기.
-- 외부인은 로그인이 없으므로: 보관함 정책이 '열려 있는(열림 · 제출) 인터뷰지 토큰의 폴더'에만 넣기 · 지우기를 허락하고,
--   목록 기록은 security definer 함수 두 개(interview_file_add · interview_file_remove)로만. 표는 외부인이 못 본다.
-- 한도: 파일 하나 30MB · 인터뷰지 하나에 30개 · 사진 · PDF · 문서 · 발표 · 한글 · 압축 · 영상만.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('interview-files', 'interview-files', false, 31457280, array[
  'image/*', 'application/pdf', 'video/mp4', 'video/quicktime', 'application/zip', 'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp', 'application/vnd.hancom.hwpx', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.sales_interview_files (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.sales_interview_forms (id) on delete cascade,
  interview_id uuid not null references public.sales_interviews (id) on delete cascade,
  path text not null unique,
  name text not null,
  size bigint,
  mime text,
  created_at timestamptz not null default now()
);
create index if not exists sales_interview_files_interview_idx on public.sales_interview_files (interview_id, created_at desc);
alter table public.sales_interview_files enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_interview_files' and policyname = 'sales_interview_files_select') then
    create policy sales_interview_files_select on public.sales_interview_files for select using ((select public.is_active_member()));
    create policy sales_interview_files_delete on public.sales_interview_files for delete using ((select public.is_active_member()));
  end if;
end $$;
revoke all on table public.sales_interview_files from anon;
grant select, delete on table public.sales_interview_files to authenticated;

-- 이 토큰의 인터뷰지가 지금 자료를 받을 수 있나 (열림 · 제출 상태 · 30개 미만)
create or replace function public.interview_upload_open(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_token ~ '^[0-9a-f]{36}$', false) and exists (
    select 1 from public.sales_interview_forms f
    where f.token = p_token and f.status in ('열림', '제출')
      and (select count(*) from public.sales_interview_files x where x.form_id = f.id) < 30)
$$;
revoke all on function public.interview_upload_open(text) from public;
grant execute on function public.interview_upload_open(text) to anon, authenticated;
-- 지우기는 개수와 상관없이 열려 있기만 하면
create or replace function public.interview_form_open(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_token ~ '^[0-9a-f]{36}$', false) and exists (select 1 from public.sales_interview_forms f where f.token = p_token and f.status in ('열림', '제출'))
$$;
revoke all on function public.interview_form_open(text) from public;
grant execute on function public.interview_form_open(text) to anon, authenticated;

-- 보관함 정책: 외부인은 열린 인터뷰지 토큰 폴더에 넣기 · 지우기만 (목록 · 내려받기 없음) / 팀원은 읽기 · 지우기
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'interview_files_guest_insert') then
    create policy interview_files_guest_insert on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'interview-files' and public.interview_upload_open((storage.foldername(name))[1]));
    create policy interview_files_guest_delete on storage.objects for delete to anon, authenticated
      using (bucket_id = 'interview-files' and public.interview_form_open((storage.foldername(name))[1]));
    -- 지우기에는 읽기 권한도 필요함(보관함 API) · 그 토큰 폴더만 · 토큰을 아는 브랜드 담당자만 경로를 앎
    create policy interview_files_guest_select on storage.objects for select to anon, authenticated
      using (bucket_id = 'interview-files' and public.interview_form_open((storage.foldername(name))[1]));
    create policy interview_files_member_select on storage.objects for select to authenticated
      using (bucket_id = 'interview-files' and (select public.is_active_member()));
    create policy interview_files_member_delete on storage.objects for delete to authenticated
      using (bucket_id = 'interview-files' and (select public.is_active_member()));
  end if;
end $$;

-- 올린 파일 기록 (외부인 · 토큰으로): 보관함에 실제로 있는 그 토큰 폴더의 파일만 · 단계를 '자료 수령'으로 · 담당자 알림
create or replace function public.interview_file_add(p_token text, p_path text, p_name text, p_size bigint, p_mime text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.sales_interview_forms; iv public.sales_interviews; n int;
begin
  if not public.interview_upload_open(p_token) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_token or p_path like '%..%' then return jsonb_build_object('ok', false, 'reason', 'bad_path'); end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'interview-files' and o.name = p_path) then return jsonb_build_object('ok', false, 'reason', 'missing'); end if;
  select * into f from public.sales_interview_forms where token = p_token;
  insert into public.sales_interview_files (form_id, interview_id, path, name, size, mime)
  values (f.id, f.interview_id, p_path, left(coalesce(nullif(btrim(p_name), ''), '파일'), 160), p_size, left(p_mime, 120))
  on conflict (path) do nothing;
  select * into iv from public.sales_interviews where id = f.interview_id;
  if iv.stage in ('발송', '답장 없음', '확인 필요', '답변', '인터뷰지 발송') then
    update public.sales_interviews set stage = '자료 수령' where id = iv.id;
  end if;
  select count(*) into n from public.sales_interview_files where form_id = f.id;
  if iv.owner_id is not null then
    -- 같은 제목의 안 읽은 알림은 합쳐지므로(notifications_merge_repeat) 여러 장을 올려도 한 줄
    perform public.notify(iv.owner_id, '알람', left('인터뷰 자료 도착 · ' || iv.brand, 120), left(iv.brand || ' 담당자가 인터뷰지에 자료를 올렸습니다 (모두 ' || n || '개).', 300), '/sales?interview=' || iv.id);
  end if;
  return jsonb_build_object('ok', true, 'files', public.interview_form_files(f.id));
end $$;

create or replace function public.interview_file_remove(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.sales_interview_forms; v_path text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  select * into f from public.sales_interview_forms where token = p_token and status in ('열림', '제출');
  if not found then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  delete from public.sales_interview_files where id = p_id and form_id = f.id returning path into v_path;
  return jsonb_build_object('ok', true, 'path', v_path, 'files', public.interview_form_files(f.id));
end $$;

-- 화면에 보여 줄 목록 (이름 · 크기 · 종류만 · 경로는 지울 때만 씀)
create or replace function public.interview_form_files(p_form uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'size', size, 'mime', mime, 'path', path, 'at', created_at) order by created_at), '[]'::jsonb)
  from public.sales_interview_files where form_id = p_form
$$;
revoke all on function public.interview_form_files(uuid) from public, anon, authenticated;
revoke all on function public.interview_file_add(text, text, text, bigint, text) from public;
revoke all on function public.interview_file_remove(text, uuid) from public;
grant execute on function public.interview_file_add(text, text, text, bigint, text) to anon, authenticated;
grant execute on function public.interview_file_remove(text, uuid) to anon, authenticated;

-- 인터뷰지 열기에 올린 파일 목록도 함께 (기존 함수에 'files' 한 칸 더함 · 시그니처 그대로)
create or replace function public.interview_form_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.sales_interview_forms; b text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into f from public.sales_interview_forms where token = p_token;
  if not found or f.status = '작성 중' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if f.first_seen_at is null then update public.sales_interview_forms set first_seen_at = now() where id = f.id; end if;
  select brand into b from public.sales_interviews where id = f.interview_id;
  return jsonb_build_object('ok', true, 'brand', b, 'title', f.title, 'intro', f.intro, 'due_on', f.due_on, 'upload_on', f.upload_on,
    'closed', f.status = '닫힘', 'submitted_at', f.submitted_at, 'answers', f.answers, 'respondent', f.respondent, 'image_consent', f.image_consent,
    'files', public.interview_form_files(f.id),
    'questions', (select coalesce(jsonb_agg(q - 'use' order by ord), '[]'::jsonb) from jsonb_array_elements(f.questions) with ordinality as x(q, ord)));
end $$;
notify pgrst, 'reload schema';
