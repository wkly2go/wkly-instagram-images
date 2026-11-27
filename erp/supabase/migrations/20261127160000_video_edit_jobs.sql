-- 영상 편집 요청 (2026-11-27 대표 지시 '인트라넷에서 명령을 내려 완성 · 폰으로도 · 완전 자동')
--  · 인트라넷(폰 · PC)에서 드라이브 촬영 폴더를 골라 요청 → 항상 켜 둔 맥의 작업 처리기가 편집 → 완성본은 드라이브 새 파일 + 미리보기
--  · 맥 작업 처리기는 열쇠(agent_tokens · scope video_worker)로 아래 agent_video_* 함수만 부른다
--  · 원본 영상은 인트라넷에 올리지 않는다 (드라이브에 있는 것을 맥이 읽음). 미리보기만 보관함 video-edits 에 둔다

create table if not exists public.video_edit_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  title text not null check (char_length(title) between 1 and 120),
  source_folder text not null check (char_length(source_folder) between 1 and 600),
  template text not null default 'cuts' check (template in ('cuts', 'walkthrough', 'detail')),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  target_seconds int not null default 20 check (target_seconds between 8 and 90),
  status text not null default '대기' check (status in ('대기', '편집 중', '완료', '실패', '취소')),
  parent_id uuid references public.video_edit_jobs(id),
  worker text,
  claimed_at timestamptz,
  finished_at timestamptz,
  plan jsonb,
  result_path text,
  preview_path text,
  duration_seconds numeric,
  error text
);
create index if not exists video_edit_jobs_status_idx on public.video_edit_jobs (status, created_at);

create table if not exists public.video_source_folders (
  path text primary key,
  files int not null default 0,
  seconds numeric,
  bytes bigint,
  newest_at timestamptz,
  seen_at timestamptz not null default now()
);

create table if not exists private.video_worker_state (
  worker text primary key,
  seen_at timestamptz not null default now(),
  info jsonb
);

alter table public.video_edit_jobs enable row level security;
alter table public.video_source_folders enable row level security;

drop policy if exists video_edit_jobs_read on public.video_edit_jobs;
create policy video_edit_jobs_read on public.video_edit_jobs for select to authenticated
  using ((select public.is_active_member()));
drop policy if exists video_edit_jobs_insert on public.video_edit_jobs;
create policy video_edit_jobs_insert on public.video_edit_jobs for insert to authenticated
  with check ((select public.is_active_member()) and created_by = (select auth.uid()) and status = '대기'
    and worker is null and plan is null and result_path is null and preview_path is null);
drop policy if exists video_source_folders_read on public.video_source_folders;
create policy video_source_folders_read on public.video_source_folders for select to authenticated
  using ((select public.is_active_member()));

revoke all on public.video_edit_jobs, public.video_source_folders from anon;
grant select, insert on public.video_edit_jobs to authenticated;
grant select on public.video_source_folders to authenticated;

-- 대기 중인 내 요청 취소 (관리자는 모두)
create or replace function public.video_edit_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.video_edit_jobs set status = '취소', finished_at = now()
   where id = p_id and status = '대기'
     and (created_by = auth.uid() or public.is_admin());
  if not found then raise exception '취소할 수 있는 요청이 아닙니다 (이미 편집을 시작했거나 내 요청이 아님).'; end if;
end $$;
revoke all on function public.video_edit_cancel(uuid) from public, anon;
grant execute on function public.video_edit_cancel(uuid) to authenticated;

-- 작업 처리기가 살아 있는지 (화면 안내용)
create or replace function public.video_worker_seen()
returns timestamptz language sql stable security definer set search_path = '' as $$
  select case when public.is_active_member() then (select max(seen_at) from private.video_worker_state) end
$$;
revoke all on function public.video_worker_seen() from public, anon;
grant execute on function public.video_worker_seen() to authenticated;

-- ── 맥 작업 처리기용 (열쇠 확인) ──
create or replace function public.agent_video_folders_save(p_token text, p_worker text, p_folders jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform public.agent_token_check(p_token, 'video_worker');
  if jsonb_typeof(p_folders) <> 'array' or jsonb_array_length(p_folders) > 2000 then raise exception '폴더 목록 형식이 맞지 않습니다.'; end if;
  insert into private.video_worker_state (worker, seen_at) values (left(coalesce(p_worker, 'mac'), 80), now())
    on conflict (worker) do update set seen_at = now();
  insert into public.video_source_folders (path, files, seconds, bytes, newest_at, seen_at)
  select left(f->>'path', 600), coalesce((f->>'files')::int, 0), (f->>'seconds')::numeric, (f->>'bytes')::bigint, (f->>'newest_at')::timestamptz, now()
    from jsonb_array_elements(p_folders) f where coalesce(f->>'path', '') <> ''
  on conflict (path) do update set files = excluded.files, seconds = excluded.seconds, bytes = excluded.bytes, newest_at = excluded.newest_at, seen_at = now();
  get diagnostics v_n = row_count;
  delete from public.video_source_folders where seen_at < now() - interval '2 days';
  return v_n;
end $$;

create or replace function public.agent_video_job_claim(p_token text, p_worker text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.video_edit_jobs; v_parent jsonb;
begin
  perform public.agent_token_check(p_token, 'video_worker');
  insert into private.video_worker_state (worker, seen_at) values (left(coalesce(p_worker, 'mac'), 80), now())
    on conflict (worker) do update set seen_at = now();
  -- 40분 넘게 '편집 중'이면 처리기가 멈춘 것으로 보고 다시 대기로
  update public.video_edit_jobs set status = '대기', worker = null, claimed_at = null
   where status = '편집 중' and claimed_at < now() - interval '40 minutes';
  select * into v_job from public.video_edit_jobs where status = '대기' order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update public.video_edit_jobs set status = '편집 중', worker = left(coalesce(p_worker, 'mac'), 80), claimed_at = now(), error = null where id = v_job.id;
  if v_job.parent_id is not null then
    select jsonb_build_object('plan', p.plan, 'instructions', p.instructions) into v_parent from public.video_edit_jobs p where p.id = v_job.parent_id;
  end if;
  return jsonb_build_object('id', v_job.id, 'title', v_job.title, 'source_folder', v_job.source_folder, 'template', v_job.template,
    'instructions', v_job.instructions, 'target_seconds', v_job.target_seconds, 'parent', v_parent);
end $$;

create or replace function public.agent_video_job_finish(p_token text, p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ok boolean := coalesce((p->>'ok')::boolean, false); v_job public.video_edit_jobs;
begin
  perform public.agent_token_check(p_token, 'video_worker');
  update public.video_edit_jobs set
    status = case when v_ok then '완료' else '실패' end, finished_at = now(),
    plan = coalesce(p->'plan', plan), result_path = left(p->>'result_path', 800), preview_path = left(p->>'preview_path', 300),
    duration_seconds = (p->>'duration_seconds')::numeric, error = left(p->>'error', 1000)
   where id = p_id and status = '편집 중' returning * into v_job;
  if not found then raise exception '편집 중인 요청이 아닙니다.'; end if;
  if v_job.created_by is not null then
    perform public.notify(v_job.created_by, '시스템',
      case when v_ok then '영상 편집 완료' else '영상 편집 실패' end, v_job.title, '/ads?tab=video');
  end if;
end $$;

-- 미리보기 올릴 자리 이름만 정해 줌 (실제 올리기 주소는 서버 함수 video-worker 가 만듦)
create or replace function public.agent_video_job_check(p_token text, p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform public.agent_token_check(p_token, 'video_worker');
  if not exists (select 1 from public.video_edit_jobs where id = p_id and status = '편집 중') then raise exception '편집 중인 요청이 아닙니다.'; end if;
  return 'previews/' || p_id::text || '.mp4';
end $$;

revoke all on function public.agent_video_folders_save(text, text, jsonb), public.agent_video_job_claim(text, text),
  public.agent_video_job_finish(text, uuid, jsonb), public.agent_video_job_check(text, uuid) from public;
grant execute on function public.agent_video_folders_save(text, text, jsonb), public.agent_video_job_claim(text, text),
  public.agent_video_job_finish(text, uuid, jsonb), public.agent_video_job_check(text, uuid) to anon, authenticated, service_role;

-- 미리보기 보관함 (비공개 · 60MB) — 팀원만 읽음, 올리기는 서버 함수가 준 주소로만
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-edits', 'video-edits', false, 62914560, array['video/mp4'])
on conflict (id) do nothing;
drop policy if exists video_edits_read on storage.objects;
create policy video_edits_read on storage.objects for select to authenticated
  using (bucket_id = 'video-edits' and (select public.is_active_member()));
