-- 2026-11-17 보안 점검: 현장 실측 페이지(/field/fossil-1103 · AR2610-11-1103)는 로그인 없이 누구나 쓰고 덮어쓸 수 있었음
-- 실측은 11/10 이 마지막 기록 → 보기는 그대로 두고, 로그인 안 한 사람(anon)의 쓰기 · 덮어쓰기만 막음
-- 다시 현장에서 써야 하면 팀원 로그인으로 쓰거나 별도 초대 경로를 만들 것 (anon 쓰기를 되살리지 말 것)

-- 표
drop policy if exists fs_insert on public.field_survey;
drop policy if exists fs_update on public.field_survey;
create policy fs_insert on public.field_survey for insert to authenticated
  with check (public.is_active_member() and project = 'AR2610-11-1103' and pg_column_size(data) < 200000);
create policy fs_update on public.field_survey for update to authenticated
  using (public.is_active_member() and project = 'AR2610-11-1103')
  with check (public.is_active_member() and project = 'AR2610-11-1103' and pg_column_size(data) < 200000);
revoke insert, update, delete on table public.field_survey from anon;

-- 합치기 함수(security definer)도 로그인 안 한 사람은 못 부름
revoke execute on function public.field_survey_merge(text, text, text, jsonb) from public, anon;
grant execute on function public.field_survey_merge(text, text, text, jsonb) to authenticated;

-- 사진 · 녹음 보관함
drop policy if exists fs_obj_insert on storage.objects;
drop policy if exists fs_obj_update on storage.objects;
create policy fs_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'field-survey' and (storage.foldername(name))[1] = 'AR2610-11-1103' and public.is_active_member());
create policy fs_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'field-survey' and (storage.foldername(name))[1] = 'AR2610-11-1103' and public.is_active_member())
  with check (bucket_id = 'field-survey' and (storage.foldername(name))[1] = 'AR2610-11-1103' and public.is_active_member());
