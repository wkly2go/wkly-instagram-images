-- 0132 평면 · 3D 모델링(인트라넷 화면에서 그리기): 평면 자료 저장과 '수량 반영'
-- design.spaces: version 0 = 작업 중인 평면(덮어쓰기) · version n = n번째 모델로 수량에 반영한 평면(보존)
-- 수량 반영은 스케치업 '수량 보내기'와 같은 규칙: 새 모델 버전을 만들고, 모델 수량은 바꾸고, 직접 넣은 수량은 그대로 옮긴다.
begin;
create function public.design_apply_plan(p_project uuid, p_geometry jsonb, p_lines jsonb)
returns integer language plpgsql set search_path = '' as $$
declare v_old int; v_new int; bad text;
begin
  if not (select public.is_active_member()) then raise exception '권한이 없습니다.' using errcode = '42501'; end if;
  select model_version into v_old from design.projects where id = p_project for update;
  if not found then raise exception '설계를 시작하지 않은 프로젝트입니다.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception '반영할 수량이 없습니다. 가벽이나 부품을 먼저 그리세요.'; end if;
  select string_agg(distinct x->>'trade', ', ') into bad from jsonb_array_elements(p_lines) x
   where not exists (select 1 from design.trades t where t.code = x->>'trade');
  if bad is not null then raise exception '없는 공종입니다: %', bad; end if;
  select string_agg(distinct x->>'unit', ', ') into bad from jsonb_array_elements(p_lines) x
   where not exists (select 1 from design.units u where u.standard = x->>'unit');
  if bad is not null then raise exception '없는 단위입니다: %', bad; end if;
  v_new := v_old + 1;
  insert into design.placements (project_id, model_version, component_id, trade_code, item, spec, unit, qty, dims, material_id, location, source, sort, section, note)
  select project_id, v_new, component_id, trade_code, item, spec, unit, qty, dims, material_id, location, source, sort + 100000, section, note
    from design.placements where project_id = p_project and model_version = v_old and source = 'manual';
  insert into design.placements (project_id, model_version, trade_code, item, spec, unit, qty, dims, source, sort, section)
  select p_project, v_new, x->>'trade', left(x->>'item', 200), left(coalesce(x->>'spec', ''), 200), x->>'unit', (x->>'qty')::numeric,
         jsonb_build_object('count', coalesce((x->>'count')::int, 0), 'from', 'plan'), 'model', ord, nullif(x->>'section', '')
    from jsonb_array_elements(p_lines) with ordinality t(x, ord) where (x->>'qty')::numeric > 0;
  update design.projects set model_version = v_new, stage = case when stage in ('survey', 'plan') then 'model'::design.project_stage else stage end where id = p_project;
  insert into design.spaces (project_id, version, source, geometry, approved) values (p_project, v_new, 'manual', p_geometry, true)
    on conflict (project_id, version) do update set geometry = excluded.geometry, approved = true;
  return v_new;
end $$;
revoke all on function public.design_apply_plan(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.design_apply_plan(uuid, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
