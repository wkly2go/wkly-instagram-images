-- 2026-11-19 대표 지시 '트렌드 밈은 유튜브 틱톡 인스타그램에서 가장 조회수가 많고 실시간 이슈되는 영상을 소개하는 것으로 바꿔'
--
-- 리서치 › 트렌드·밈 = 지금 가장 많이 보는 영상 · 급상승 영상 소개 (예전엔 팝업 기사 · 밈 아이디어가 섞여 있었음)
-- ① 유튜브: 공식 무료 API(YouTube Data API v3 · videos.list chart=mostPopular · 한국)로 하루 두 번 순위를 받아
--    그날 한 건('[날짜] 유튜브 인기 동영상 TOP 25 · 한국')을 만들거나 고친다. AI 없음 · 비용 없음(하루 할당 10,000 중 2).
--    열쇠는 금고 YOUTUBE_API_KEY (대표가 구글 클라우드에서 무료 키를 만들어 Supabase › Vault 에 넣음). 없으면 조용히 건너뜀.
--    '급상승' = 48시간 안에 올라온 영상 중 시간당 조회수(조회수 ÷ 올린 뒤 지난 시간)가 큰 순.
-- ② 틱톡 · 인스타그램: 무료 공식 순위 API 가 없다 → 트렌드 리서치 AI(TREND)가 무료 웹 검색으로 찾고, 영상 주소 · 조회수 · 확인 시각을 적는다(지시 아래).

create or replace function private.trend_youtube_tick() returns text
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  r extensions.http_response;
  j jsonb;
  v jsonb;
  v_rows jsonb := '[]'::jsonb;
  today date := (now() at time zone 'Asia/Seoul')::date;
  v_ttl text;
  v_body text;
  v_summ text;
  hrs numeric;
  i int := 0;
  hit uuid;
begin
  select btrim(decrypted_secret) into k from vault.decrypted_secrets where name = 'YOUTUBE_API_KEY' limit 1;
  if k is null or k = '' then return 'no key'; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  r := extensions.http_get('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=KR&hl=ko&maxResults=25&key=' || k);
  if r.status <> 200 then return 'http ' || r.status; end if;
  j := r.content::jsonb;
  for v in select * from jsonb_array_elements(coalesce(j->'items', '[]'::jsonb)) loop
    i := i + 1;
    hrs := greatest(extract(epoch from (now() - (v->'snippet'->>'publishedAt')::timestamptz)) / 3600, 1);
    v_rows := v_rows || jsonb_build_object(
      'rank', i,
      'id', v->>'id',
      'title', replace(replace(v->'snippet'->>'title', '|', '/'), E'\n', ' '),
      'channel', replace(v->'snippet'->>'channelTitle', '|', '/'),
      'views', coalesce((v->'statistics'->>'viewCount')::bigint, 0),
      'hours', round(hrs),
      'per_hour', round(coalesce((v->'statistics'->>'viewCount')::numeric, 0) / hrs));
  end loop;
  if jsonb_array_length(v_rows) = 0 then return 'empty'; end if;

  v_body := '## 유튜브 인기 동영상 · 한국 (' || to_char(now() at time zone 'Asia/Seoul', 'MM.DD HH24:MI') || ' 기준)' || E'\n\n'
    || '| 순위 | 영상 | 채널 | 조회수 | 올린 지 | 시간당 조회 |' || E'\n' || '| --- | --- | --- | --- | --- | --- |' || E'\n'
    || (select string_agg(format('| %s | [%s](https://www.youtube.com/watch?v=%s) | %s | %s | %s | %s |',
          x->>'rank', left(x->>'title', 70), x->>'id', x->>'channel',
          to_char((x->>'views')::bigint, 'FM999,999,999,990'),
          case when (x->>'hours')::int < 48 then (x->>'hours') || '시간' else round((x->>'hours')::numeric / 24) || '일' end,
          to_char((x->>'per_hour')::bigint, 'FM999,999,990')), E'\n' order by (x->>'rank')::int)
        from jsonb_array_elements(v_rows) x)
    || E'\n\n## 실시간 급상승 (48시간 안에 올라온 영상 · 시간당 조회 순)\n\n'
    || coalesce((select string_agg(format('- [%s](https://www.youtube.com/watch?v=%s) · %s · 시간당 %s회', left(x->>'title', 70), x->>'id', x->>'channel',
          to_char((x->>'per_hour')::bigint, 'FM999,999,990')), E'\n')
        from (select x from jsonb_array_elements(v_rows) x where (x->>'hours')::int < 48 order by (x->>'per_hour')::bigint desc limit 5) s), '- (48시간 안에 올라온 순위 영상 없음)')
    || E'\n\n출처: YouTube Data API (인기 동영상 · 한국) · 하루 두 번 자동 갱신';
  v_summ := (select string_agg(format('%s위 %s — 조회 %s', x->>'rank', left(x->>'title', 40), to_char((x->>'views')::bigint, 'FM999,999,999,990')), E'\n' order by (x->>'rank')::int)
           from jsonb_array_elements(v_rows) x where (x->>'rank')::int <= 3);
  v_ttl := '[' || to_char(today, 'YYYY-MM-DD') || '] 유튜브 인기 동영상 TOP ' || jsonb_array_length(v_rows) || ' · 한국';

  select id into hit from public.research_items
   where kind = '트렌드·밈' and source_name = 'YouTube 인기 동영상' and (created_at at time zone 'Asia/Seoul')::date = today limit 1;
  if hit is null then
    insert into public.research_items (kind, title, summary, body, source_url, source_name, tags, status, section, biz)
    values ('트렌드·밈', v_ttl, v_summ, v_body, 'https://www.youtube.com/feed/explore', 'YouTube 인기 동영상', array['유튜브', '인기 영상', '급상승'], '새 자료', '콘텐츠', '공통');
  else
    update public.research_items set title = v_ttl, summary = v_summ, body = v_body, updated_at = now() where id = hit;
  end if;
  return 'ok ' || jsonb_array_length(v_rows);
exception when others then
  return 'error ' || left(sqlerrm, 200);
end $$;
revoke all on function private.trend_youtube_tick() from public, anon, authenticated;

-- 하루 두 번 (09:13 · 18:13 KST = 00:13 · 09:13 UTC · 정각 · 5분 단위를 피함)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'trend_youtube') then
    perform cron.unschedule('trend_youtube');
  end if;
  perform cron.schedule('trend_youtube', '13 0,9 * * *', 'select private.trend_youtube_tick()');
end $$;

-- 트렌드 리서치 AI(TREND)에게: 트렌드·밈 은 이제 '영상 순위 · 급상승 영상'만
insert into public.agent_directives (agent_code, team, directive, priority, active, set_by, reason)
values ('TREND', '공통 리서치',
'[대표 지시 · 2026-11-19 · 트렌드·밈 정의 변경] 리서치 종류 ''트렌드·밈''은 이제 유튜브 · 틱톡 · 인스타그램에서 지금 조회수가 가장 많은 영상과 실시간으로 급상승하는 영상을 소개하는 자료만 저장한다. '
'팝업 · 브랜드 기사 · 행사 소식은 ''트렌드·밈''에 넣지 말고 ''팝업 정보'' 또는 ''시장조사''로 저장한다. '
'유튜브 순위는 인트라넷이 공식 API로 하루 두 번 자동 저장하므로(제목 ''[날짜] 유튜브 인기 동영상 TOP 25 · 한국'') 다시 만들지 않는다. '
'너는 틱톡 · 인스타그램(릴스)을 맡는다: 하루 한 건 ''[YYYY-MM-DD] 틱톡 · 인스타그램 인기 · 급상승 영상''으로, 플랫폼별 5~10개를 표로 적는다 — 순위 | 플랫폼 | 영상 제목 · 내용 한 줄 | 만든 사람(계정) | 영상 주소(그 영상으로 바로 가는 주소) | 조회수 | 조회수를 확인한 곳과 시각 | 왜 뜨는지(형식 · 소리 · 챌린지) 한 줄. '
'근거는 무료 웹 검색으로 찾은 공개 자료만(틱톡 크리에이티브 센터 인기 영상 · 공식 계정 · 기사). 조회수를 직접 확인하지 못했으면 숫자를 지어내지 말고 ''[확인 필요]''로 적는다. 영상 주소가 없으면 그 줄은 넣지 않는다. '
'비극 · 정치 · 분쟁 · 선정적 영상은 제외하고(trend-jacking 3관문), 맨 아래에 더위클리 콘텐츠로 쓸 만한 형식 1~2개를 한 줄씩 적는다. 저장은 research_items.body 에 전부(구글 시트 · 문서 만들지 않음).',
1, true, '대표', '대표 지시 2026-11-19 ''트렌드 밈은 유튜브 틱톡 인스타그램에서 가장 조회수가 많고 실시간 이슈되는 영상을 소개하는 것으로 바꿔''');
