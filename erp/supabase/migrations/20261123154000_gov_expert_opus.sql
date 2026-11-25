-- 투자유치 전문 AI 는 다시 Opus (2026-11-23 대표 지시 '오퍼스로 돌려' · 같은 날 '내 비서만 오퍼스 · 나머지는 소넷' 뒤의 예외)
--  - 전문 AI = ai_agents.tools 에 gov_suggest 가 있는 계정 · '꼼꼼' = Opus
-- 자료만 바꿈 · 다시 실행해도 결과가 같음
update public.ai_agents set model = '꼼꼼', updated_at = now() where 'gov_suggest' = any (tools) and model <> '꼼꼼';
update public.agent_roster set model = 'claude-opus-5-5' where code = 'GOV' and model <> 'claude-opus-5-5';
