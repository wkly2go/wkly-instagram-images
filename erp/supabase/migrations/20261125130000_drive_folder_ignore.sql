-- 인트라넷에서 지운 프로젝트의 드라이브 폴더는 자동 가져오기(gdrive importFolders)가 다시 만들지 않게 (2026-11-25)
-- 지운 프로젝트의 폴더 id 를 app_settings 'drive_folder_ignore' {ids: [...]} 에 남김 (최근 500개). 드라이브 폴더는 그대로 둠.
create or replace function private.project_deleted_drive_ignore()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  fid text := substring(coalesce(old.drive_url, '') from '/folders/([A-Za-z0-9_-]{10,})');
  cur jsonb;
begin
  if fid is null then return old; end if;
  select value into cur from public.app_settings where key = 'drive_folder_ignore';
  cur := coalesce(cur->'ids', '[]'::jsonb);
  if not cur ? fid then
    insert into public.app_settings (key, value, updated_at)
    values ('drive_folder_ignore', jsonb_build_object('ids', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements_text(jsonb_build_array(fid) || cur) x limit 500) s)), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return old;
end;
$$;

create trigger projects_deleted_drive_ignore
  after delete on public.projects
  for each row execute function private.project_deleted_drive_ignore();

-- 자동 가져오기(설명 '드라이브 폴더에서 자동으로 가져옴')가 지운 프로젝트의 폴더로 다시 만들려 하면 거절 → gdrive 는 그 폴더를 건너뜀
create or replace function private.project_import_ignore_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  fid text := substring(coalesce(new.drive_url, '') from '/folders/([A-Za-z0-9_-]{10,})');
begin
  if fid is not null and new.description = '드라이브 폴더에서 자동으로 가져옴'
     and exists (select 1 from public.app_settings where key = 'drive_folder_ignore' and value->'ids' ? fid) then
    raise exception '지운 프로젝트의 드라이브 폴더라 다시 가져오지 않습니다.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger projects_import_ignore_guard
  before insert on public.projects
  for each row execute function private.project_import_ignore_guard();
