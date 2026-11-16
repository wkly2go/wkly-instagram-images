-- 개인 비서 이름 · 지침을 주인이 고침 (대표 지시 2026-11-16 "비서 이름과 지침 변경 할 수 있게")
create or replace function public.my_assistant_settings(p_name text default null, p_instructions text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_agent uuid;
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
begin
  if v_me is null or not public.is_active_member() then raise exception '로그인한 팀원만 쓸 수 있습니다.' using errcode = '42501'; end if;
  v_agent := private.assistant_ensure(v_me);
  if p_name is not null then
    if v_name is null or char_length(v_name) > 20 then raise exception '이름은 1~20자로 적어 주세요.' using errcode = '22023'; end if;
    if v_name ~ '[@<>]' then raise exception '이름에 @ < > 는 쓸 수 없습니다.' using errcode = '22023'; end if;
    if exists (select 1 from public.profiles p where p.id <> v_agent and lower(p.name) = lower(v_name)) then
      raise exception '이미 쓰는 이름입니다. 다른 이름을 골라 주세요.' using errcode = '22023';
    end if;
    update public.profiles set name = v_name where id = v_agent;
  end if;
  if p_instructions is not null then
    if char_length(p_instructions) > 4000 then raise exception '지침은 4,000자까지 적을 수 있습니다.' using errcode = '22023'; end if;
    update public.ai_agents set instructions = btrim(p_instructions) where profile_id = v_agent;
  end if;
  return (select jsonb_build_object('agent_id', v_agent, 'name', p.name, 'instructions', a.instructions)
          from public.profiles p join public.ai_agents a on a.profile_id = p.id where p.id = v_agent);
end $$;
revoke all on function public.my_assistant_settings(text, text) from public, anon;
grant execute on function public.my_assistant_settings(text, text) to authenticated;
