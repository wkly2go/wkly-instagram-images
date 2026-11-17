-- 광고 운영팀: 결재를 제목이 아니라 payload(type · week)로 찾는다.
-- 결재 제목은 저장할 때 '[AI 결재 요청]' 머리말이 지워지므로(approval_clean_title) 제목으로는 찾지 못해
-- 기획이 승인돼도 제작 작업이 모르고, 같은 결재가 두 번 올라갈 수 있었다.
do $do$
declare
  d text;
  procedure_missing constant text := '바꿀 자리를 찾지 못했습니다: ';
begin
  d := pg_get_functiondef('public.agent_ad_team_context(text,text)'::regprocedure);
  if position($s$a.title = v_plan_title$s$ in d) = 0 then raise exception '%', procedure_missing || 'context plan'; end if;
  d := replace(d, $s$a.title = v_plan_title$s$, $s$a.payload->>'type' = 'ad_plan' and a.payload->>'week' = v_week::text$s$);
  if position($s$a.title = v_assets_title$s$ in d) = 0 then raise exception '%', procedure_missing || 'context assets'; end if;
  d := replace(d, $s$a.title = v_assets_title$s$, $s$a.payload->>'type' = 'ad_assets' and a.payload->>'week' = v_week::text$s$);
  if position($s$a.title = '[AI 결재 요청] 광고 주간 기획 · ' || (v_week - 7)$s$ in d) = 0 then raise exception '%', procedure_missing || 'context last'; end if;
  d := replace(d, $s$a.title = '[AI 결재 요청] 광고 주간 기획 · ' || (v_week - 7)$s$, $s$a.payload->>'type' = 'ad_plan' and a.payload->>'week' = (v_week - 7)::text$s$);
  execute d;

  d := pg_get_functiondef('public.agent_ad_team_save(text,text,text,text,text,text,text)'::regprocedure);
  if position($s$a.title = '[AI 결재 요청] 광고 주간 기획 · ' || v_week$s$ in d) = 0 then raise exception '%', procedure_missing || 'save plan'; end if;
  d := replace(d, $s$a.title = '[AI 결재 요청] 광고 주간 기획 · ' || v_week$s$, $s$a.payload->>'type' = 'ad_plan' and a.payload->>'week' = v_week::text$s$);
  if position($s$a.title = v_ap_title and a.status$s$ in d) = 0 then raise exception '%', procedure_missing || 'save dedupe'; end if;
  d := replace(d, $s$a.title = v_ap_title and a.status$s$, $s$a.payload->>'type' = (case when p_kind = 'plan' then 'ad_plan' else 'ad_assets' end) and a.payload->>'week' = v_week::text and a.status$s$);
  execute d;
end $do$;
