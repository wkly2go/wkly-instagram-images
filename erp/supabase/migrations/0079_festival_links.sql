-- 이번 주말 축제 카드에 링크 (대표 지시 2026-11-02 "게시물에 링크 넣어줘 · 노출하고 있는 페스티벌 모두")
--  관광공사 상세(detailCommon2)의 공식 홈페이지 주소를 받아 저장 · 없으면 축제명 네이버 검색
alter table public.tour_festivals add column if not exists link text;
alter table public.tour_festivals add column if not exists link_checked_at timestamptz;
comment on column public.tour_festivals.link is '축제 카드 링크: 공식 홈페이지 (없으면 네이버 검색)';

create or replace function public.tour_fill_links(p_limit int default 60)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare f record; r jsonb; hp text; url text; n int := 0;
begin
  for f in
    select contentid, title from tour_festivals
    where link_checked_at is null and event_end >= (now() at time zone 'Asia/Seoul')::date
    order by event_start
    limit p_limit
  loop
    hp := null;
    begin
      r := public.public_data_get('B551011/KorService2/detailCommon2',
             jsonb_build_object('MobileOS','ETC','MobileApp','WKLY','_type','json','contentId', f.contentid));
      hp := r #>> '{body,response,body,items,item,0,homepage}';
    exception when others then hp := null;
    end;
    -- homepage 는 <a href="...">...</a> 형태이기도 함 → 첫 http 주소만
    url := substring(coalesce(hp, '') from '(https?://[^"''<>\s]+)');
    if url is null or url = '' then
      url := 'https://search.naver.com/search.naver?query=' || replace(f.title, ' ', '+');
    end if;
    update tour_festivals set link = url, link_checked_at = now() where contentid = f.contentid;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 주말 축제 피드에 링크(u) 포함
create or replace function public.festival_weekend()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with d as (select (now() at time zone 'Asia/Seoul')::date t),
  w as (select case when extract(isodow from t) in (6,7) then t - (extract(isodow from t)::int - 6) else t + (6 - extract(isodow from t)::int) end sat from d)
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
    select jsonb_build_object('id',contentid,'t',title,'s',event_start,'e',event_end,'a',regexp_replace(coalesce(addr,''),'\s*\(.*\)$',''),'r',region,'img',image_url,
             'u', coalesce(link, 'https://search.naver.com/search.naver?query=' || replace(title, ' ', '+'))) x,
           row_number() over (order by (event_end - event_start) > 60, event_end, event_start desc) o
    from tour_festivals, w
    where region in ('도심','강남','홍대','용산','여의도','성수','잠실')
      and event_start <= w.sat + 1 and event_end >= w.sat
      and image_url is not null and image_url <> ''
      and coalesce(status,'') not in ('숨김','제외')
  ) q where o <= 3 $function$;
revoke execute on function public.tour_fill_links(int) from public, anon, authenticated;
-- 매일 06:40 (KST) 축제 동기화(06:20) 뒤에 새 축제 링크 채우기
select cron.schedule('tour_fill_links', '40 21 * * *', $$select public.tour_fill_links(80)$$);
