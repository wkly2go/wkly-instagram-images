-- 콘텐츠·배포 › 인스타그램 버전을 인트라넷에서 바로 게시 (2026-11-17 · 대표 지시 '인스타그램 연결하고 개발 완료해' 후속)
-- 승인된 인스타그램 버전 + 연결 광고 캠페인의 JPG 이미지(1~10장) → 함수 instagram-publish 가 게시 → 발행 주소 · 게시물 ID 를 자동 기록.
-- 게시는 활성 관리자가 화면에서 직접 누를 때만 (예약 · 자동 게시 없음). 같은 콘텐츠는 한 번만 게시.
create table if not exists private.growth_ig_publish (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.growth_items(id),
  revision integer not null,
  requested_by uuid not null references public.profiles(id),
  state text not null default 'started' check (state in ('started', 'published', 'failed')),
  media_id text,
  permalink text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists growth_ig_publish_once on private.growth_ig_publish (item_id) where state = 'published';
create unique index if not exists growth_ig_publish_running on private.growth_ig_publish (item_id) where state = 'started';
alter table private.growth_ig_publish enable row level security;

-- 게시할 수 있는지 확인하고 게시할 내용(제목 · 본문 · 태그 · 이미지 경로)을 돌려줌. p_claim 이면 게시 작업을 잡음.
create or replace function public.growth_ig_publish_prepare(p_item uuid, p_revision integer, p_user uuid, p_claim boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  it public.growth_items;
  v jsonb;
  assets jsonb;
  job uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user and active and role = 'admin' and not is_agent) then
    raise exception '활성 관리자만 인스타그램에 게시할 수 있습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_item::text, 7));
  select * into it from public.growth_items where id = p_item;
  if it.id is null or it.kind <> 'content' then raise exception '콘텐츠를 찾지 못했습니다.'; end if;
  if it.revision <> p_revision then raise exception '다른 작업에서 변경되었습니다. 다시 불러와 주세요.' using errcode = '40001'; end if;
  select z into v from jsonb_array_elements(it.document -> 'versions') z where z ->> 'channel' = '인스타그램';
  if v is null or v ->> 'status' <> '승인' then raise exception '인스타그램 버전을 승인 상태로 저장한 뒤 게시할 수 있습니다.'; end if;
  if v ->> 'rights' <> 'true' then raise exception '이미지 · 문구 사용 권리 확인이 필요합니다.'; end if;
  if btrim(coalesce(v ->> 'body', '')) = '' then raise exception '인스타그램 본문이 비어 있습니다.'; end if;
  if coalesce(v ->> 'external_id', '') <> '' or exists (select 1 from private.growth_ig_publish where item_id = p_item and state = 'published') then
    raise exception '이미 인스타그램에 게시한 콘텐츠입니다.';
  end if;
  if it.campaign_id is null then raise exception '이미지가 있는 광고 캠페인을 연결해 주세요.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'path', a.path, 'mime', a.mime) order by a.created_at, a.id), '[]'::jsonb)
    into assets from public.marketing_assets a where a.campaign_id = it.campaign_id and a.deleted_at is null;
  if jsonb_array_length(assets) = 0 then raise exception '연결 캠페인에 이미지가 없습니다.'; end if;
  if jsonb_array_length(assets) > 10 then raise exception '인스타그램은 한 게시물에 이미지 10장까지 올릴 수 있습니다.'; end if;
  if exists (select 1 from jsonb_array_elements(assets) e where e ->> 'mime' <> 'image/jpeg') then
    raise exception '인스타그램은 JPG 이미지만 받습니다. 화면의 ''JPG로 바꾸기''를 먼저 눌러 주세요.';
  end if;
  if p_claim then
    update private.growth_ig_publish set state = 'failed', error = '시간 초과', finished_at = now()
      where item_id = p_item and state = 'started' and started_at < now() - interval '10 minutes';
    if exists (select 1 from private.growth_ig_publish where item_id = p_item and state = 'started') then
      raise exception '게시가 진행 중입니다. 잠시 뒤 다시 확인해 주세요.';
    end if;
    insert into private.growth_ig_publish (item_id, revision, requested_by) values (p_item, p_revision, p_user) returning id into job;
  end if;
  return jsonb_build_object('job', job, 'title', v ->> 'title', 'body', v ->> 'body', 'tags', v ->> 'tags', 'assets', assets);
end $$;

-- 게시 결과 기록: 성공이면 인스타그램 버전을 '발행'으로 바꾸고 발행 주소 · 게시물 ID 를 적음 (새 저장 버전 · 이력 남김)
create or replace function public.growth_ig_publish_finish(p_job uuid, p_media text, p_permalink text, p_error text)
returns public.growth_items language plpgsql security definer set search_path = '' as $$
declare
  j private.growth_ig_publish;
  it public.growth_items;
  versions jsonb;
  saved public.growth_items;
begin
  select * into j from private.growth_ig_publish where id = p_job for update;
  if j.id is null or j.state <> 'started' then raise exception '게시 작업을 찾지 못했습니다.'; end if;
  if p_error is not null or coalesce(p_media, '') = '' then
    update private.growth_ig_publish set state = 'failed', error = left(coalesce(p_error, '게시물 ID 없음'), 500), finished_at = now() where id = p_job;
    return null;
  end if;
  if p_permalink is not null and not public.growth_safe_url(p_permalink) then p_permalink := null; end if;
  update private.growth_ig_publish set state = 'published', media_id = left(p_media, 100), permalink = p_permalink, finished_at = now() where id = p_job;
  perform pg_advisory_xact_lock(hashtextextended(j.item_id::text, 1));
  select * into it from public.growth_items where id = j.item_id for update;
  select jsonb_agg(case when z ->> 'channel' = '인스타그램'
      then z || jsonb_build_object('status', '발행', 'publication_url', coalesce(p_permalink, ''), 'external_id', left(p_media, 300))
      else z end order by n)
    into versions from jsonb_array_elements(it.document -> 'versions') with ordinality t(z, n);
  update public.growth_items
     set document = jsonb_set(document, '{versions}', versions), status = '발행 기록', revision = revision + 1,
         updated_by = j.requested_by, updated_at = clock_timestamp()
   where id = j.item_id returning * into saved;
  insert into public.growth_revisions values (saved.id, saved.revision, to_jsonb(saved), now());
  return saved;
end $$;

revoke all on table private.growth_ig_publish from public, anon, authenticated;
revoke all on function public.growth_ig_publish_prepare(uuid, integer, uuid, boolean) from public, anon, authenticated;
revoke all on function public.growth_ig_publish_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.growth_ig_publish_prepare(uuid, integer, uuid, boolean) to service_role;
grant execute on function public.growth_ig_publish_finish(uuid, text, text, text) to service_role;
