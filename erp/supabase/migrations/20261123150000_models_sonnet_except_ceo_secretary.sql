-- 모델 지정 (2026-11-23 대표 지시 '내 비서만 오퍼스로 하고 나머지는 소넷으로 지정해')
--  - API 에이전트(api_agents)는 모두 Sonnet
--  - 채팅 AI 팀원(ai_agents): 대표의 개인 비서만 '꼼꼼'(= Opus) · 나머지는 '기본'(= Sonnet · agent-chat 의 MODEL_CHAT)
--  - 명단(agent_roster)의 모델 표시도 맞춤
--  - 새로 생기는 비서는 ai_agents.model 기본값 '기본'이라 Sonnet 으로 시작한다
-- 자료만 바꿈 · 다시 실행해도 결과가 같음 · 지우는 것 없음
update public.api_agents set model = 'claude-sonnet-5-5', updated_at = now() where model <> 'claude-sonnet-5-5';

update public.ai_agents a set model = '기본', updated_at = now()
where a.model <> '기본'
  and not (a.private and exists (select 1 from public.profiles o where o.id = a.owner_id and o.title = '대표' and o.active));

update public.ai_agents a set model = '꼼꼼', updated_at = now()
where a.model <> '꼼꼼' and a.private
  and exists (select 1 from public.profiles o where o.id = a.owner_id and o.title = '대표' and o.active);

update public.agent_roster set model = 'claude-sonnet-5-5' where model = 'claude-opus-5-5';
