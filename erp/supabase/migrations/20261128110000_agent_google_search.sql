-- 구글 검색을 AI 에이전트에게 (2026-11-28 대표 지시 '구글 api 를 사용하는게 성능 향상에 도움이 된다면 사용하도록 설정해')
--  금고의 GEMINI_API_KEY 로 제미나이의 'Google 검색 근거(grounding)'를 불러 실제 구글 결과(제목 · 출처 · 요약)를 돌려준다.
--  Claude 웹 검색은 구글 순위와 다를 수 있어, 검색 노출 AI 가 우리 홈페이지의 구글 순위를 재는 데 특히 쓴다.
--  요금: 무료 범위 안(구글 검색 근거는 제미나이 3 이상 모델 합쳐 한 달 5,000회 무료 · 2026-11-28 가격표) → 하루 100회로 막음(한 달 약 3,000회).
--  설정 app_settings 'google_search' {enabled, model, daily_cap}. 기록 private.google_search_log(질문 · 성공 여부 · 출처 수 · 질문 글만 · 답은 저장 안 함).
--  에이전트는 api_agents.rpcs 에 'agent_google_search' 가 있는 것만 부를 수 있음(실행기가 확인).
--  **2026-11-28 운영: 적용 직후 시험에서 열쇠의 구글 프로젝트가 선불 크레딧 소진(402) → 무료 원칙상 충전하지 않고 설정 enabled false,
--  네 에이전트의 rpcs · 지시문 한 줄은 되돌림(아래 update 는 적용 당시 기록). 다시 켜려면 enabled true + rpcs 에 추가.**

create table if not exists private.google_search_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  query text not null,
  ok boolean not null,
  sources int not null default 0,
  note text
);
create index if not exists google_search_log_at on private.google_search_log (at);

insert into public.app_settings (key, value, updated_at)
values ('google_search', jsonb_build_object('enabled', true, 'model', 'gemini-3.5-flash-lite', 'daily_cap', 100), now())
on conflict (key) do nothing;

-- 실제 검색 (서버 안에서만) — 질문 → 구글 검색 근거 답 · 출처 목록
create or replace function private.google_search(p_query text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  v_cfg jsonb;
  v_key text;
  v_used int;
  v_q text := btrim(coalesce(p_query, ''));
  v_res record;
  v_json jsonb;
  v_text text;
  v_sources jsonb;
  v_queries jsonb;
begin
  select value into v_cfg from public.app_settings where key = 'google_search';
  if v_cfg is null or coalesce(v_cfg->>'enabled', 'false') <> 'true' then
    return jsonb_build_object('error', '구글 검색이 꺼져 있습니다.');
  end if;
  if length(v_q) < 2 or length(v_q) > 300 then
    return jsonb_build_object('error', '검색어는 2~300자로 주세요.');
  end if;
  select count(*) into v_used from private.google_search_log
   where at >= ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul');
  if v_used >= coalesce((v_cfg->>'daily_cap')::int, 100) then
    return jsonb_build_object('error', format('오늘 구글 검색 한도(%s회)를 다 썼습니다. 내일 다시 쓰거나 웹 검색을 쓰세요.', coalesce(v_cfg->>'daily_cap', '100')));
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GEMINI_API_KEY';
  if v_key is null then return jsonb_build_object('error', '구글 열쇠가 없습니다.'); end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');
  select * into v_res from extensions.http((
    'POST',
    'https://generativelanguage.googleapis.com/v1beta/models/' || coalesce(v_cfg->>'model', 'gemini-3.5-flash-lite') || ':generateContent?key=' || v_key,
    array[]::extensions.http_header[],
    'application/json',
    jsonb_build_object(
      'contents', jsonb_build_array(jsonb_build_object('role', 'user', 'parts', jsonb_build_array(jsonb_build_object('text',
        '구글에서 아래를 검색하고, 구글 검색 결과에 나온 순서대로 상위 10개를 한국어로 정리하라. 줄마다 "순위. 제목 — 사이트 주소(도메인) — 한 줄 요약". '
        || '검색 결과에 없는 내용은 지어내지 말 것. 검색어: ' || v_q)))),
      'tools', jsonb_build_array(jsonb_build_object('google_search', jsonb_build_object())),
      'generationConfig', jsonb_build_object('temperature', 0)
    )::text
  )::extensions.http_request);

  if v_res.status <> 200 then
    insert into private.google_search_log (query, ok, note) values (left(v_q, 300), false, 'http ' || v_res.status || ' ' || left(coalesce(v_res.content, ''), 200));
    return jsonb_build_object('error', '구글 검색을 하지 못했습니다(' || v_res.status || ').');
  end if;
  v_json := v_res.content::jsonb;
  select string_agg(p->>'text', '') into v_text from jsonb_array_elements(coalesce(v_json#>'{candidates,0,content,parts}', '[]'::jsonb)) p;
  select coalesce(jsonb_agg(jsonb_build_object('title', c#>>'{web,title}', 'url', c#>>'{web,uri}')), '[]'::jsonb) into v_sources
    from jsonb_array_elements(coalesce(v_json#>'{candidates,0,groundingMetadata,groundingChunks}', '[]'::jsonb)) c;
  v_queries := coalesce(v_json#>'{candidates,0,groundingMetadata,webSearchQueries}', '[]'::jsonb);
  insert into private.google_search_log (query, ok, sources) values (left(v_q, 300), true, jsonb_array_length(v_sources));
  return jsonb_build_object(
    'engine', 'Google 검색 (제미나이 근거)',
    'query', v_q,
    'google_queries', v_queries,
    'answer', left(coalesce(v_text, ''), 6000),
    'sources', v_sources,
    'note', 'sources 의 title 은 출처 사이트(도메인), url 은 구글이 주는 이동 주소입니다. 순위는 answer 의 순서를 쓰세요.',
    'left_today', coalesce((v_cfg->>'daily_cap')::int, 100) - v_used - 1);
exception when others then
  insert into private.google_search_log (query, ok, note) values (left(v_q, 300), false, left(sqlerrm, 200));
  return jsonb_build_object('error', '구글 검색 중 오류가 났습니다.');
end $$;
revoke all on function private.google_search(text) from public, anon, authenticated;

-- 에이전트용 (열쇠 확인 뒤 검색)
create or replace function public.agent_google_search(p_token text, p_query text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
begin
  perform public.agent_token_check(p_token, 'task');
  return private.google_search(p_query);
end $$;
revoke all on function public.agent_google_search(text, text) from public, anon, authenticated;
grant execute on function public.agent_google_search(text, text) to service_role;

-- 쓰게 할 에이전트: 검색 노출 · 트렌드 · 거래처 리포트 · 인테리어 리서치 (지시문 끝에 한 줄)
update public.api_agents
   set rpcs = rpcs || array['agent_google_search'],
       instructions = instructions || E'\n\n[구글 검색] intranet 도구의 agent_google_search(p_query) 로 실제 구글 검색 결과(순위 · 출처)를 받을 수 있다. 구글 순위 · 구글에서의 노출을 확인할 때는 이것을 먼저 쓰고, 웹 검색은 보충으로 쓴다. 회사 전체 하루 100회 한도를 나눠 쓰니 한 번 실행에 10회를 넘기지 않는다.',
       updated_at = now()
 where code in ('SEO', 'TREND', 'CLIENT', 'INT-RES') and not ('agent_google_search' = any(rpcs));
