-- 현장 실측 체크리스트 (/field/fossil-1103) 저장소: 로그인 없이 쓰는 현장용 페이지라 이 표와 버킷만 공개 쓰기 허용
create table if not exists public.field_survey(
  project text not null,
  kind text not null check (kind in ('rec','photos','cq')),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(project,kind,id)
);
create index if not exists field_survey_proj_upd on public.field_survey(project,updated_at);
create or replace function public.field_survey_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists field_survey_touch on public.field_survey;
create trigger field_survey_touch before insert or update on public.field_survey for each row execute function public.field_survey_touch();
alter table public.field_survey enable row level security;
drop policy if exists fs_select on public.field_survey;
drop policy if exists fs_insert on public.field_survey;
drop policy if exists fs_update on public.field_survey;
create policy fs_select on public.field_survey for select to anon, authenticated using (project = 'AR2610-11-1103');
create policy fs_insert on public.field_survey for insert to anon, authenticated with check (project = 'AR2610-11-1103' and pg_column_size(data) < 200000);
create policy fs_update on public.field_survey for update to anon, authenticated using (project = 'AR2610-11-1103') with check (project = 'AR2610-11-1103' and pg_column_size(data) < 200000);
grant select, insert, update on public.field_survey to anon, authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('field-survey','field-survey',true,10485760,array['image/jpeg'])
on conflict (id) do nothing;
drop policy if exists fs_obj_insert on storage.objects;
drop policy if exists fs_obj_update on storage.objects;
drop policy if exists fs_obj_select on storage.objects;
create policy fs_obj_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'field-survey' and (storage.foldername(name))[1] = 'AR2610-11-1103');
create policy fs_obj_update on storage.objects for update to anon, authenticated using (bucket_id = 'field-survey') with check (bucket_id = 'field-survey' and (storage.foldername(name))[1] = 'AR2610-11-1103');
create policy fs_obj_select on storage.objects for select to anon, authenticated using (bucket_id = 'field-survey');
