-- 광고 준비 자료는 실제 광고 캠페인·지출 표와 분리한다.
-- 팀원: 조회, 활성 관리자: 작성. 이미지는 비공개 저장소에 보관한다.
begin;

create table public.marketing_campaigns (
  id uuid primary key,
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 65536),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index marketing_campaigns_updated_idx on public.marketing_campaigns (updated_at desc, id);

create table public.marketing_assets (
  id uuid primary key,
  campaign_id uuid not null references public.marketing_campaigns(id),
  name text not null check (char_length(name) between 1 and 255),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  size bigint not null check (size between 1 and 8388608),
  path text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index marketing_assets_campaign_idx on public.marketing_assets (campaign_id, created_at) where deleted_at is null;
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_assets enable row level security;
create policy marketing_campaigns_read on public.marketing_campaigns for select to authenticated using ((select public.is_active_member()));
create policy marketing_assets_read on public.marketing_assets for select to authenticated using (deleted_at is null and (select public.is_active_member()));
revoke all on public.marketing_campaigns, public.marketing_assets from anon, authenticated;
grant select on public.marketing_campaigns, public.marketing_assets to authenticated;

-- 모든 쓰기는 권한·입력·버전을 검증하는 함수로 제한한다.
create function public.marketing_save_campaign(p_id uuid, p_document jsonb, p_expected_revision integer)
returns public.marketing_campaigns
language plpgsql security definer set search_path = '' as $$
declare
  prior public.marketing_campaigns;
  saved public.marketing_campaigns;
  k text;
  limit_chars integer;
  start_day date;
  end_day date;
  daily numeric;
  total numeric;
  current_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_admin() then raise exception '캠페인 작성은 활성 관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0 then raise exception '캠페인 ID와 저장 버전을 확인해 주세요.'; end if;
  if p_document is null or jsonb_typeof(p_document) <> 'object' or octet_length(p_document::text) > 65536 then raise exception '캠페인 정보가 올바르지 않거나 너무 큽니다.'; end if;
  if p_document - array['title','brand','goal','platform','landingUrl','sourceUrl','audience','offer','headline','primaryText','description','cta','startDate','endDate','dailyBudget','totalBudget','reviews','textAdConfirmed','seasonNote','status'] <> '{}'::jsonb then raise exception '허용하지 않는 캠페인 입력 항목입니다.'; end if;
  foreach k in array array['title','brand','goal','platform','landingUrl','sourceUrl','audience','offer','headline','primaryText','description','cta','startDate','endDate','seasonNote','status'] loop
    if jsonb_typeof(p_document->k) is distinct from 'string' then raise exception '캠페인 글자 항목을 확인해 주세요: %', k; end if;
    limit_chars := case k when 'title' then 160 when 'landingUrl' then 4096 when 'sourceUrl' then 4096 when 'headline' then 300 when 'primaryText' then 10000 when 'cta' then 80 when 'seasonNote' then 3000 else 2000 end;
    if char_length(p_document->>k) > limit_chars then raise exception '입력 가능한 글자 수를 초과했습니다: %', k; end if;
  end loop;
  if btrim(p_document->>'title') = '' then raise exception '캠페인 이름을 적어 주세요.'; end if;
  if p_document->>'brand' not in ('wkly','arterior') or p_document->>'goal' not in ('leads','traffic','awareness') or p_document->>'platform' not in ('meta','naver','google') or p_document->>'status' not in ('draft','ready') then raise exception '브랜드·목표·채널·준비 상태를 확인해 주세요.'; end if;
  foreach k in array array['landingUrl','sourceUrl'] loop
    if btrim(p_document->>k) <> '' and btrim(p_document->>k) !~* '^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$' then raise exception '연결 주소는 계정정보가 없는 http 또는 https 주소로 입력해 주세요.'; end if;
  end loop;
  foreach k in array array['startDate','endDate'] loop
    if p_document->>k <> '' then
      if p_document->>k !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '날짜 형식을 확인해 주세요.'; end if;
      begin
        if to_char((p_document->>k)::date, 'YYYY-MM-DD') <> p_document->>k then raise exception '날짜를 확인해 주세요.'; end if;
      exception when datetime_field_overflow or invalid_datetime_format then raise exception '실제 존재하는 날짜를 입력해 주세요.';
      end;
    end if;
  end loop;
  start_day := nullif(p_document->>'startDate','')::date;
  end_day := nullif(p_document->>'endDate','')::date;
  if end_day < start_day then raise exception '종료일은 시작일과 같거나 이후여야 합니다.'; end if;
  foreach k in array array['dailyBudget','totalBudget'] loop
    if not (p_document ? k) then raise exception '예산 미정은 null로 입력해 주세요.'; end if;
    if jsonb_typeof(p_document->k) <> 'null' then
      if jsonb_typeof(p_document->k) <> 'number' or p_document->>k !~ '^[0-9]+$' then raise exception '예산은 1원 이상의 정수로 입력해 주세요.'; end if;
      if (p_document->>k)::numeric < 1 or (p_document->>k)::numeric > 9007199254740991 then raise exception '예산 입력 범위를 확인해 주세요.'; end if;
    end if;
  end loop;
  daily := (p_document->>'dailyBudget')::numeric;
  total := (p_document->>'totalBudget')::numeric;
  if daily > total or daily * (end_day - start_day + 1) > total then raise exception '일 예산과 운영일수에 비해 총예산이 부족합니다.'; end if;
  if jsonb_typeof(p_document->'reviews') is distinct from 'object' or (p_document->'reviews') - array['content','rights','budget'] <> '{}'::jsonb then raise exception '검토 상태를 확인해 주세요.'; end if;
  foreach k in array array['content','rights','budget'] loop
    if jsonb_typeof(p_document->'reviews'->k) is distinct from 'boolean' then raise exception '검토 상태를 확인해 주세요.'; end if;
  end loop;
  if jsonb_typeof(p_document->'textAdConfirmed') is distinct from 'boolean' then raise exception '텍스트 광고 확인 값을 확인해 주세요.'; end if;

  -- 같은 캠페인의 저장·소재 변경을 한 행 잠금으로 직렬화한다.
  select * into prior from public.marketing_campaigns where id = p_id for update;
  if (prior.id is null and p_expected_revision <> 0) or (prior.id is not null and prior.revision <> p_expected_revision) then raise exception '다른 작업에서 캠페인이 변경됐습니다. 새로 불러온 뒤 수정해 주세요.' using errcode = '40001'; end if;
  if prior.id is not null then
    foreach k in array array['title','brand','goal','platform','landingUrl','sourceUrl','audience','offer','headline','primaryText','description','cta','seasonNote','textAdConfirmed'] loop
      if prior.document->k is distinct from p_document->k then p_document := jsonb_set(p_document,'{reviews,content}','false'); end if;
    end loop;
    foreach k in array array['brand','platform','landingUrl','sourceUrl','textAdConfirmed'] loop
      if prior.document->k is distinct from p_document->k then p_document := jsonb_set(p_document,'{reviews,rights}','false'); end if;
    end loop;
    foreach k in array array['brand','platform','startDate','endDate','dailyBudget','totalBudget'] loop
      if prior.document->k is distinct from p_document->k then p_document := jsonb_set(p_document,'{reviews,budget}','false'); end if;
    end loop;
    if p_document->'reviews' <> '{"content":true,"rights":true,"budget":true}'::jsonb then p_document := jsonb_set(p_document,'{status}','"draft"'); end if;
  end if;
  if p_document->>'status' = 'ready' then
    if start_day is null or end_day is null or start_day < current_day or daily is null or total is null then raise exception '시작일·종료일·예산을 확인해 주세요. 지난 시작일로 준비 완료할 수 없습니다.'; end if;
    foreach k in array array['landingUrl','headline','primaryText','cta'] loop
      if btrim(p_document->>k) = '' then raise exception '광고 주소·제목·본문·행동 유도 문구를 작성해 주세요.'; end if;
    end loop;
    if p_document->'reviews' <> '{"content":true,"rights":true,"budget":true}'::jsonb then raise exception '문구·소재 권리·예산 검토를 모두 완료해 주세요.'; end if;
    if not ((p_document->>'platform' = 'naver' and (p_document->>'textAdConfirmed')::boolean) or exists(select 1 from public.marketing_assets where campaign_id = p_id and deleted_at is null)) then raise exception '이미지 소재를 올리거나 네이버 텍스트 광고임을 확인해 주세요.'; end if;
  end if;
  if prior.id is null then
    insert into public.marketing_campaigns(id, document, created_by, updated_by) values(p_id, p_document, auth.uid(), auth.uid()) returning * into saved;
  else
    update public.marketing_campaigns set document = p_document, revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp() where id = p_id returning * into saved;
  end if;
  return saved;
exception when unique_violation then raise exception '다른 작업에서 같은 캠페인을 저장했습니다. 목록을 새로 불러와 주세요.' using errcode = '40001';
end;
$$;

create function public.marketing_add_asset(p_id uuid, p_campaign_id uuid, p_name text, p_mime text, p_size bigint, p_path text)
returns public.marketing_assets
language plpgsql security definer set search_path = '' as $$
declare
  c public.marketing_campaigns;
  saved public.marketing_assets;
  stored jsonb;
  extension text;
begin
  if not public.is_admin() then raise exception '소재 관리는 활성 관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  select * into c from public.marketing_campaigns where id = p_campaign_id for update;
  if c.id is null then raise exception '캠페인을 먼저 저장해 주세요.'; end if;
  extension := case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
  if p_id is null or extension is null or p_size is null or p_size < 1 or p_size > 8388608 or p_name is null or char_length(btrim(p_name)) not between 1 and 255 or p_path is distinct from p_campaign_id::text || '/' || p_id::text || '.' || extension then raise exception '이미지 파일 정보를 확인해 주세요.'; end if;
  select * into saved from public.marketing_assets where id = p_id;
  if saved.id is not null then
    if saved.campaign_id = p_campaign_id and saved.name = p_name and saved.mime = p_mime and saved.size = p_size and saved.path = p_path and saved.deleted_at is null then return saved; end if;
    raise exception '같은 소재 ID에 다른 파일이 있거나 이미 삭제된 소재입니다.';
  end if;
  select metadata into stored from storage.objects where bucket_id = 'marketing-assets' and name = p_path;
  if stored is null or stored->>'mimetype' is distinct from p_mime or stored->>'size' is distinct from p_size::text then raise exception '저장소의 파일 정보와 일치하지 않습니다. 다시 올려 주세요.'; end if;
  insert into public.marketing_assets(id,campaign_id,name,mime,size,path,created_by) values(p_id,p_campaign_id,p_name,p_mime,p_size,p_path,auth.uid()) returning * into saved;
  update public.marketing_campaigns set document = jsonb_set(jsonb_set(jsonb_set(document,'{status}','"draft"'),'{reviews,content}','false'),'{reviews,rights}','false'), revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp() where id = p_campaign_id;
  return saved;
end;
$$;

create function public.marketing_archive_asset(p_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  a public.marketing_assets;
begin
  if not public.is_admin() then raise exception '소재 관리는 활성 관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  select * into a from public.marketing_assets where id = p_id;
  if a.id is null then raise exception '삭제할 소재를 찾을 수 없습니다.'; end if;
  perform 1 from public.marketing_campaigns where id = a.campaign_id for update;
  select * into a from public.marketing_assets where id = p_id for update;
  if a.deleted_at is null then
    update public.marketing_assets set deleted_at = clock_timestamp() where id = p_id;
    update public.marketing_campaigns set document = jsonb_set(jsonb_set(jsonb_set(document,'{status}','"draft"'),'{reviews,content}','false'),'{reviews,rights}','false'), revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp() where id = a.campaign_id;
  end if;
  return a.path;
end;
$$;

revoke all on function public.marketing_save_campaign(uuid,jsonb,integer), public.marketing_add_asset(uuid,uuid,text,text,bigint,text), public.marketing_archive_asset(uuid) from public, anon, authenticated;
grant execute on function public.marketing_save_campaign(uuid,jsonb,integer), public.marketing_add_asset(uuid,uuid,text,text,bigint,text), public.marketing_archive_asset(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('marketing-assets','marketing-assets',false,8388608,array['image/jpeg','image/png','image/webp']);
create policy marketing_objects_read on storage.objects for select to authenticated using (
  bucket_id = 'marketing-assets' and (select public.is_active_member()) and
  ((select public.is_admin()) or exists(select 1 from public.marketing_assets a where a.path = storage.objects.name and a.deleted_at is null))
);
create policy marketing_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'marketing-assets' and (select public.is_admin()) and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' and
  exists(select 1 from public.marketing_campaigns c where c.id::text = (storage.foldername(storage.objects.name))[1])
);
-- 연결된 소재는 먼저 archive RPC로 해제해야 파일을 지울 수 있다.
create policy marketing_objects_delete on storage.objects for delete to authenticated using (
  bucket_id = 'marketing-assets' and (select public.is_admin()) and
  not exists(select 1 from public.marketing_assets a where a.path = storage.objects.name and a.deleted_at is null)
);

notify pgrst, 'reload schema';
commit;
