-- WKLY ERP 0015: AI 팀원 실시간 응답
--   - AI 팀원과의 1:1 대화, 채팅방에서 '@AI이름' 언급, 'AI 팀원에게 지시' 패널 → agent-chat 함수를 바로 호출
--   - 함수 주소는 push 설정(function_url)의 send-push 자리에서 agent-chat 으로 바꿔 사용, 같은 비밀값으로 확인

create or replace function private.agent_call(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c private.push_config;
begin
  select * into c from private.push_config where id = 1;
  if c.function_url is null then
    return;
  end if;
  perform net.http_post(
    url := replace(c.function_url, '/send-push', '/agent-chat'),
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.hook_secret),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'agent_call: %', sqlerrm;
end;
$$;

-- 채팅: 보낸 사람이 사람이고, AI 와의 1:1 방이거나 '@AI이름' 이 들어 있을 때만
create or replace function private.agent_on_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[];
begin
  if new.user_id is null or exists (select 1 from public.profiles p where p.id = new.user_id and p.is_agent) then
    return null;
  end if;
  select r.members into v_members from public.chat_rooms r where r.id = new.room_id;
  if exists (
    select 1 from public.profiles a
    where a.is_agent and a.active
      and ((v_members is not null and a.id = any (v_members)) or strpos(new.content, '@' || a.name) > 0)
  ) then
    perform private.agent_call(jsonb_build_object('type', 'chat', 'message_id', new.id));
  end if;
  return null;
end;
$$;

drop trigger if exists chat_messages_agent on public.chat_messages;
create trigger chat_messages_agent
  after insert on public.chat_messages
  for each row execute function private.agent_on_chat_message();

-- 지시 패널: 사람이 남긴 지시만 (메일 확인으로 넘긴 것은 아침 정기 실행이 처리)
create or replace function private.agent_on_instruction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = '대기' and new.instruction not like '[메일%' then
    perform private.agent_call(jsonb_build_object('type', 'instruction', 'id', new.id));
  end if;
  return null;
end;
$$;

drop trigger if exists agent_instructions_realtime on public.agent_instructions;
create trigger agent_instructions_realtime
  after insert on public.agent_instructions
  for each row execute function private.agent_on_instruction();
