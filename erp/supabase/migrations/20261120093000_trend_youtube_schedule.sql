-- 2026-11-20 유튜브 인기 동영상: 대표가 금고에 YOUTUBE_API_KEY 를 넣음 → 추천 사용량으로
-- 하루 네 번(09:13 · 13:13 · 18:13 · 22:13 KST) · 한 번에 전체 TOP 25 + 분야별(음악 · 게임 · 엔터테인먼트) TOP 5
-- = 한 번에 4단위 · 하루 16단위 (무료 한도 10,000 의 0.2%). 같은 날 자료 한 건을 계속 고침.

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
  cat record;
  rc extensions.http_response;
  v_cat text := '';
  c_rows text;
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

  -- 분야별 인기 TOP 5 (음악 · 게임 · 엔터테인먼트 · 한 번에 1단위씩 · 실패한 분야는 조용히 건너뜀)
  for cat in select * from (values (10, '음악'), (20, '게임'), (24, '엔터테인먼트')) as t(id, name) loop
    begin
      rc := extensions.http_get('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=KR&hl=ko&maxResults=5&videoCategoryId=' || cat.id || '&key=' || k);
      if rc.status = 200 then
        select string_agg(format('%s. [%s](https://www.youtube.com/watch?v=%s) · %s · 조회 %s', o,
                 left(replace(replace(x->'snippet'->>'title', '|', '/'), E'\n', ' '), 70), x->>'id', x->'snippet'->>'channelTitle',
                 to_char(coalesce((x->'statistics'->>'viewCount')::bigint, 0), 'FM999,999,999,990')), E'\n' order by o)
          into c_rows from jsonb_array_elements(coalesce(rc.content::jsonb->'items', '[]'::jsonb)) with ordinality as e(x, o);
        if c_rows is not null then v_cat := v_cat || E'\n\n## 분야별 인기 · ' || cat.name || E'\n\n' || c_rows; end if;
      end if;
    exception when others then null;
    end;
  end loop;

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
    || v_cat
    || E'\n\n출처: YouTube Data API (인기 동영상 · 한국) · 하루 네 번 자동 갱신 (09 · 13 · 18 · 22시)';
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

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trend_youtube') then
    perform cron.unschedule('trend_youtube');
  end if;
  perform cron.schedule('trend_youtube', '13 0,4,9,13 * * *', 'select private.trend_youtube_tick()');
end $$;
