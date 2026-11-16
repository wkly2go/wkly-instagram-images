-- 2026-11-16 대표 지시: 민간 영업 발굴을 더 고도화 · 민간 자료가 많이 필요하다.
-- ① 뉴스 검색어를 3묶음(24개)으로 늘려 3시간마다 번갈아 수집한다: 기본 팝업 · 매장 소식 / 지역 · 론칭 · 협업 / 업종별 팝업.
-- ② 브랜드마다 영업 준비 점수를 매긴다(보도 건수 · 최근성 · 자체 사이트 · 문의 창구 · 공개 메일). 기획은 점수 높은 브랜드부터 쓴다.
-- ③ 행사 참가 브랜드는 이름 앞의 '[행사명]'을 떼고 사이트를 찾는다. 그렇게 못 찾았던 곳은 다시 찾는다.
begin;
do $$
declare def text;
 old_words text:='array[''팝업스토어 오픈'',''팝업스토어 예정'',''브랜드 팝업'',''플래그십스토어 오픈'',''브랜드 체험존'',''체험형 팝업'',''팝업 부스 운영'',''브랜드 쇼룸 오픈'']';
 new_words text:='(case (extract(hour from now() at time zone ''Asia/Seoul'')::integer/3)%3 when 0 then '||old_words||' when 1 then array[''성수 팝업'',''더현대 팝업'',''브랜드 론칭 행사'',''신제품 출시 팝업'',''콜라보 팝업'',''브랜드 전시 개최'',''쇼케이스 개최'',''브랜드 포토존''] else array[''팝업스토어 운영'',''플래그십 리뉴얼 오픈'',''브랜드 체험 공간'',''오프라인 매장 첫 오픈'',''브랜드 페스타'',''캐릭터 팝업'',''뷰티 팝업'',''식음료 팝업''] end)';
begin
 def:=pg_get_functiondef('private.sales_news_queue()'::regprocedure);
 if position('성수 팝업' in def)=0 then
  if position(old_words in def)=0 then raise exception 'Unexpected news keyword list'; end if;
  execute replace(def,old_words,new_words);
 end if;
 def:=pg_get_functiondef('private.sales_brand_site_tick()'::regprocedure);
 if position('regexp_replace(b.name' in def)=0 then
  if position('values(b.id,b.name)' in def)=0 then raise exception 'Unexpected site queue'; end if;
  execute replace(def,'values(b.id,b.name)','values(b.id,left(btrim(regexp_replace(b.name,''^\[[^\]]*\]\s*'','''')),40))');
 end if;
 def:=pg_get_functiondef('private.sales_strategy_queue(uuid,uuid,text,integer)'::regprocedure);
 if position('order by p.score desc,p.source_updated_at desc nulls last' in def)=0 then
  if position('order by p.source_updated_at desc nulls last,p.score desc,p.id' in def)=0 then raise exception 'Unexpected planner order'; end if;
  execute replace(def,'order by p.source_updated_at desc nulls last,p.score desc,p.id','order by p.score desc,p.source_updated_at desc nulls last,p.id');
 end if;
end $$;

create function private.sales_brand_score() returns trigger language plpgsql set search_path='' as $$
begin
 if new.source not in ('news_brand','행사 참여 브랜드') or new.reviewed_assessment is not null or new.blocked or new.assessment in ('보류','제외') then return new; end if;
 new.score:=least(95,50
  +4*least(greatest(coalesce(nullif(new.event_data->>'articles','')::integer,1),1),5)
  +case when new.source_updated_at>now()-interval '7 days' then 10 when new.source_updated_at>now()-interval '21 days' then 5 else 0 end
  +case when coalesce(new.event_data->>'homepage','')<>'' then 7 else 0 end
  +case when coalesce(new.event_data->>'contact_page','')<>'' then 8 else 0 end
  +case when private.sales_public_inquiry_email(new.event_data) is not null then 15 else 0 end);
 return new;
exception when invalid_text_representation then return new;
end $$;
create trigger sales_brand_score before insert or update on public.sales_prospects for each row execute function private.sales_brand_score();
revoke all on function private.sales_brand_score() from public,anon,authenticated;

delete from private.sales_brand_site_jobs j using public.sales_prospects p where p.id=j.prospect_id and p.source in ('news_brand','행사 참여 브랜드') and coalesce(p.event_data->>'homepage','')='' and (p.name ~ '^\[' or p.name ~ '[(（]');
update public.sales_prospects set event_data=event_data-'site_checked'-'homepage',revision=revision+1 where source in ('news_brand','행사 참여 브랜드') and coalesce(event_data->>'homepage','')='' and event_data ? 'site_checked' and (name ~ '^\[' or name ~ '[(（]');
update public.sales_prospects set revision=revision+1 where source in ('news_brand','행사 참여 브랜드') and reviewed_assessment is null and not blocked and assessment not in ('보류','제외');
commit;
