-- 영상 편집 작업 처리기 열쇠는 따로 둔다 (agent_tokens 의 scope 목록 제약을 건드리지 않으려고)
--  · 열쇠 글자는 맥에서 만들고 여기에는 지문(sha256)만 넣는다 — 저장소 · 대화에 열쇠가 남지 않음
create table if not exists private.video_worker_tokens (
  token_hash text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create or replace function private.video_worker_check(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or p_token !~ '^wkly_[0-9a-f]{48}$' then raise exception '유효하지 않은 열쇠입니다.' using errcode = '28000'; end if;
  update private.video_worker_tokens set last_used_at = now()
   where token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null;
  if not found then raise exception '유효하지 않은 열쇠입니다.' using errcode = '28000'; end if;
end $$;
revoke all on function private.video_worker_check(text) from public, anon, authenticated;

-- 앞 마이그레이션의 네 함수가 이 확인을 쓰게 바꿈 (본문은 그대로 · DROP 없음)
do $$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('agent_video_folders_save', 'agent_video_job_claim', 'agent_video_job_finish', 'agent_video_job_check')
  loop
    execute replace(pg_get_functiondef(r.oid), 'public.agent_token_check(p_token, ''video_worker'')', 'private.video_worker_check(p_token)');
  end loop;
end $$;
