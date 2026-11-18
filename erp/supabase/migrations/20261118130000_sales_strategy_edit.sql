-- 기획안 직접 고치기 (2026-11-18 대표 지시 '클릭하면 화면이 커지고 모든 내용을 보고 기획을 수정할 수 있게')
-- 관리자만 · 글 칸과 단계만 바꿈(근거 자료 · 대상 · 준비 자료는 그대로) · revision 을 올려 보던 화면이 예전 내용으로 승인하지 못하게 함
create or replace function public.sales_strategy_edit(p_id uuid, p_revision integer, p_patch jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare p public.sales_strategies; k text; next jsonb; steps jsonb := '[]'::jsonb; st jsonb;
  allowed text[] := array['title','category','customer','opportunity','offer','why_now','approach','effect','resources','stop_rule','first_message'];
begin
  if not public.is_admin() then raise exception '관리자만 기획안을 고칠 수 있습니다.' using errcode = '42501'; end if;
  select * into p from public.sales_strategies where id = p_id for update;
  if p.id is null or p.plan is null then raise exception '기획안을 찾지 못했습니다.'; end if;
  if p.revision is distinct from p_revision then raise exception '기획안이 그사이 바뀌었습니다. 최신 내용을 다시 열어 주세요.' using errcode = 'PT409'; end if;
  if p.status in ('기획 중', '생성 실패') then raise exception '아직 완성되지 않은 기획안은 고칠 수 없습니다.'; end if;
  next := p.plan;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k = 'steps' then
      if jsonb_typeof(p_patch->'steps') <> 'array' or jsonb_array_length(p_patch->'steps') > 12 then raise exception '단계는 12개까지입니다.'; end if;
      for st in select value from jsonb_array_elements(p_patch->'steps') loop
        if char_length(coalesce(st->>'action', '')) not between 1 and 300 or char_length(coalesce(st->>'output', '')) > 300 or coalesce((st->>'day')::integer, -1) not between 0 and 365 then
          raise exception '단계마다 할 일(300자) · 산출물 · 승인 뒤 날짜(0~365일)를 적어 주세요.';
        end if;
        steps := steps || jsonb_build_object('action', btrim(st->>'action'), 'output', btrim(coalesce(st->>'output', '')), 'day', (st->>'day')::integer);
      end loop;
      next := jsonb_set(next, '{steps}', steps);
    elsif k = any(allowed) then
      if jsonb_typeof(p_patch->k) <> 'string' or char_length(p_patch->>k) > 4000 then raise exception '%: 4,000자까지 적을 수 있습니다.', k; end if;
      if k = 'title' and char_length(btrim(p_patch->>k)) < 2 then raise exception '제목을 적어 주세요.'; end if;
      next := jsonb_set(next, array[k], to_jsonb(btrim(p_patch->>k)));
    else
      raise exception '고칠 수 없는 칸입니다: %', k;
    end if;
  end loop;
  if next = p.plan then return p.revision; end if;
  update public.sales_strategies set plan = next, revision = revision + 1 where id = p_id;
  return p.revision + 1;
end $$;
revoke all on function public.sales_strategy_edit(uuid, integer, jsonb) from public, anon;
grant execute on function public.sales_strategy_edit(uuid, integer, jsonb) to authenticated;
