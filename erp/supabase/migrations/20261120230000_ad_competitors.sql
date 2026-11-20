-- 2026-11-20 광고 자동 운영 3단계: 경쟁사 추적 (대표 지시 '경쟁사와 타 계정을 장점을 분석해서 효율성을 높이고 · 항상 업그레이드되는 시스템' · '개발 계속해')
-- 무료 공개 자료만 매일 자동으로 모음 (AI · 유료 도구 없음):
--   네이버 블로그 RSS (rss.blog.naver.com/<아이디>.xml) · 유튜브 최근 영상 + 조회수 (YouTube Data API · 금고 YOUTUBE_API_KEY · 경쟁사당 하루 3단위)
-- 메타 광고 라이브러리는 한국 일반 광고를 API 로 주지 않아(정치 · 사회 광고만) 화면에 '광고 라이브러리 열기' 링크만 둔다.
-- 인스타그램 남의 계정 게시물은 우리 연결 방식(Instagram 로그인)으로 읽을 수 없어 링크만.
-- 분석(게시 빈도 · 조회 · 많이 쓰는 낱말 · 우리와 차이 · 주제 제안)은 화면의 계산식(lib/competitorDigest.ts)이 한다.

create table if not exists public.ad_competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  brand text not null default 'wkly' check (brand in ('wkly', 'arterior', 'both')),
  is_self boolean not null default false,
  homepage text check (homepage is null or homepage ~ '^https?://'),
  naver_blog_id text check (naver_blog_id is null or naver_blog_id ~ '^[A-Za-z0-9_-]{2,40}$'),
  youtube_handle text check (youtube_handle is null or youtube_handle ~ '^@[A-Za-z0-9._-]{2,60}$'),
  youtube_channel_id text,
  instagram_handle text check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  note text not null default '' check (char_length(note) <= 500),
  active boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.ad_competitor_posts (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.ad_competitors(id) on delete cascade,
  source text not null check (source in ('naver_blog', 'youtube')),
  ext_id text not null,
  title text not null default '',
  url text not null default '',
  summary text not null default '',
  published_at timestamptz,
  views bigint,
  likes bigint,
  comments bigint,
  fetched_at timestamptz not null default now(),
  unique (competitor_id, source, ext_id)
);
create index if not exists ad_competitor_posts_recent on public.ad_competitor_posts (competitor_id, published_at desc);

alter table public.ad_competitors enable row level security;
alter table public.ad_competitor_posts enable row level security;
create policy ad_competitors_read on public.ad_competitors for select to authenticated using ((select public.is_active_member()));
create policy ad_competitors_admin_ins on public.ad_competitors for insert to authenticated with check ((select public.is_admin()));
create policy ad_competitors_admin_upd on public.ad_competitors for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy ad_competitors_admin_del on public.ad_competitors for delete to authenticated using ((select public.is_admin()));
create policy ad_competitor_posts_read on public.ad_competitor_posts for select to authenticated using ((select public.is_active_member()));
revoke all on public.ad_competitors, public.ad_competitor_posts from anon;
revoke insert, update, delete on public.ad_competitor_posts from authenticated;

-- CDATA 벗기기 · HTML 태그 · 공백 정리
create or replace function private.strip_cdata(t text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''), '^<!\[CDATA\[|\]\]>$', '', 'g'), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- 한 곳 받기: 네이버 블로그 RSS 최근 글 + 유튜브 최근 영상 15개 (조회수 갱신)
create or replace function private.ad_competitor_fetch(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ad_competitors; r extensions.http_response; it xml; k text; j jsonb; v jsonb;
        uploads text; ids text; blog int := 0; yt int := 0; err text := null;
begin
  select * into c from public.ad_competitors where id = p_id;
  if c.id is null then return jsonb_build_object('error', 'not found'); end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');
  -- 네이버 블로그
  if c.naver_blog_id is not null then
    begin
      r := extensions.http_get('https://rss.blog.naver.com/' || c.naver_blog_id || '.xml');
      if r.status = 200 then
        for it in select unnest(xpath('/rss/channel/item', r.content::xml)) loop
          insert into public.ad_competitor_posts (competitor_id, source, ext_id, title, url, summary, published_at, fetched_at)
          values (c.id, 'naver_blog',
            coalesce(substring(private.strip_cdata((xpath('/item/link/text()', it))[1]::text) from '/(\d{6,})'), md5(private.strip_cdata((xpath('/item/link/text()', it))[1]::text))),
            left(private.strip_cdata((xpath('/item/title/text()', it))[1]::text), 300),
            left(regexp_replace(private.strip_cdata((xpath('/item/link/text()', it))[1]::text), '\?.*$', ''), 500),
            left(private.strip_cdata((xpath('/item/description/text()', it))[1]::text), 300),
            (select x::timestamptz from (select nullif((xpath('/item/pubDate/text()', it))[1]::text, '') x) q),
            now())
          on conflict (competitor_id, source, ext_id) do update set title = excluded.title, summary = excluded.summary, fetched_at = now();
          blog := blog + 1;
        end loop;
      else err := '블로그 HTTP ' || r.status; end if;
    exception when others then err := '블로그: ' || left(sqlerrm, 120); end;
  end if;
  -- 유튜브 (핸들 → 채널 id 한 번 → 업로드 목록 → 조회수)
  if c.youtube_handle is not null then
    begin
      select btrim(decrypted_secret) into k from vault.decrypted_secrets where name = 'YOUTUBE_API_KEY' limit 1;
      if k is null or k = '' then raise exception '유튜브 키 없음'; end if;
      r := extensions.http_get('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=' || replace(c.youtube_handle, '@', '%40') || '&key=' || k);
      if r.status <> 200 then raise exception 'channels HTTP %', r.status; end if;
      j := r.content::jsonb;
      uploads := j #>> '{items,0,contentDetails,relatedPlaylists,uploads}';
      if uploads is null then raise exception '채널을 찾지 못함 (%)', c.youtube_handle; end if;
      update public.ad_competitors set youtube_channel_id = j #>> '{items,0,id}' where id = c.id;
      r := extensions.http_get('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=15&playlistId=' || uploads || '&key=' || k);
      if r.status <> 200 then raise exception 'playlist HTTP %', r.status; end if;
      select string_agg(x->'contentDetails'->>'videoId', ',') into ids from jsonb_array_elements(r.content::jsonb->'items') x;
      if ids is not null then
        r := extensions.http_get('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=' || ids || '&key=' || k);
        if r.status <> 200 then raise exception 'videos HTTP %', r.status; end if;
        for v in select * from jsonb_array_elements(r.content::jsonb->'items') loop
          insert into public.ad_competitor_posts (competitor_id, source, ext_id, title, url, summary, published_at, views, likes, comments, fetched_at)
          values (c.id, 'youtube', v->>'id', left(v#>>'{snippet,title}', 300), 'https://www.youtube.com/watch?v=' || (v->>'id'),
            left(regexp_replace(coalesce(v#>>'{snippet,description}', ''), '\s+', ' ', 'g'), 300), (v#>>'{snippet,publishedAt}')::timestamptz,
            (v#>>'{statistics,viewCount}')::bigint, (v#>>'{statistics,likeCount}')::bigint, (v#>>'{statistics,commentCount}')::bigint, now())
          on conflict (competitor_id, source, ext_id) do update set title = excluded.title, views = excluded.views, likes = excluded.likes, comments = excluded.comments, fetched_at = now();
          yt := yt + 1;
        end loop;
      end if;
    exception when others then err := concat_ws(' · ', err, '유튜브: ' || left(sqlerrm, 120)); end;
  end if;
  update public.ad_competitors set last_checked_at = now(), last_error = err where id = c.id;
  return jsonb_build_object('blog', blog, 'youtube', yt, 'error', err);
end $$;
revoke all on function private.ad_competitor_fetch(uuid) from public, anon, authenticated;

-- 매일 06:53 KST: 켜진 곳 최대 30곳 · 오래 안 본 순 · DB 가 바쁘면 쉼
create or replace function private.ad_competitor_tick()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not private.db_calm() then return 0; end if;
  for r in select id from public.ad_competitors where active and (naver_blog_id is not null or youtube_handle is not null)
           order by last_checked_at nulls first limit 30 loop
    perform private.ad_competitor_fetch(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.ad_competitor_tick() from public, anon, authenticated;

-- 화면 '지금 받기' (관리자 · 한 곳)
create or replace function public.ad_competitor_refresh(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then raise exception '관리자만 할 수 있습니다.'; end if;
  return private.ad_competitor_fetch(p_id);
end $$;
revoke all on function public.ad_competitor_refresh(uuid) from public, anon;
grant execute on function public.ad_competitor_refresh(uuid) to authenticated;

select cron.schedule('ad_competitors', '53 21 * * *', 'select private.ad_competitor_tick()');

notify pgrst, 'reload schema';
