-- 현장 실측 페이지 실시간 협업: 항목 안의 칸별로 최신 값만 합치는 저장 함수 + 실시간 알림 대상에 표 추가
create or replace function public.field_survey_merge(p_project text, p_kind text, p_id text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur jsonb; k text; nt bigint; ot bigint; parts text[]; i int;
begin
  if p_project <> 'AR2610-11-1103' or p_kind not in ('rec','photos','cq') then raise exception 'not allowed'; end if;
  if pg_column_size(p_data) > 200000 then raise exception 'too large'; end if;
  select data into cur from public.field_survey where project = p_project and kind = p_kind and id = p_id for update;
  if cur is null or p_kind <> 'rec' or p_data ? '_del' or cur ? '_del' then
    cur := p_data;
  else
    if jsonb_typeof(cur->'_t') is distinct from 'object' then cur := jsonb_set(cur, '{_t}', '{}'::jsonb, true); end if;
    for k in select jsonb_object_keys(coalesce(p_data->'_t', '{}'::jsonb)) loop
      nt := (p_data->'_t'->>k)::bigint;
      ot := coalesce((cur->'_t'->>k)::bigint, 0);
      if nt > ot then
        parts := string_to_array(k, '.');
        if (p_data #> parts) is null then
          cur := cur #- parts;
        else
          for i in 1 .. coalesce(array_length(parts,1),1) - 1 loop
            if jsonb_typeof(cur #> parts[1:i]) is distinct from 'object' then cur := jsonb_set(cur, parts[1:i], '{}'::jsonb, true); end if;
          end loop;
          cur := jsonb_set(cur, parts, p_data #> parts, true);
        end if;
        cur := jsonb_set(cur, array['_t', k], to_jsonb(nt), true);
      end if;
    end loop;
    cur := jsonb_set(cur, '{at}', to_jsonb(greatest(coalesce((cur->>'at')::bigint,0), coalesce((p_data->>'at')::bigint,0))), true);
  end if;
  insert into public.field_survey(project, kind, id, data) values (p_project, p_kind, p_id, cur)
  on conflict (project, kind, id) do update set data = excluded.data;
  return cur;
end $$;
revoke all on function public.field_survey_merge(text,text,text,jsonb) from public;
grant execute on function public.field_survey_merge(text,text,text,jsonb) to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='field_survey') then
    alter publication supabase_realtime add table public.field_survey;
  end if;
end $$;
