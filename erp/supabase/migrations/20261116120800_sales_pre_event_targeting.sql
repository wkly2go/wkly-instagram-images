-- 2026-11-16 대표 지시: '이미 보도자료가 발행된 곳은 대행사가 결정난 곳이다. 다시 검토해' · '기획된 영업 자료는 모두 삭제하고 다시 시작해'.
-- ① 브랜드 영업 점수: 이미 보도된(오픈·진행·종료) 행사는 낮추고, 예정·모집·선정·런칭·진출 소식과 개최 3주 이상 남은 박람회 참가사를 올린다.
-- ② 영업 방법 신호를 '행사 전 · 대행사 미정' 기준으로 고친다. 이미 보도된 행사는 그 대행사에 제작 협력을 제안하는 쪽으로 돌린다.
-- ③ 저장된 대상 점수를 새 기준으로 다시 계산한다. (기획안 삭제는 운영 데이터 정리로 따로 실행)
begin;
create or replace function private.sales_brand_score() returns trigger language plpgsql set search_path='' as $$
declare kst date:=(now() at time zone 'Asia/Seoul')::date;starts date;
begin
 if new.source not in ('news_brand','행사 참여 브랜드') or new.reviewed_assessment is not null or new.blocked or new.assessment in ('보류','제외') then return new; end if;
 starts:=substring(new.evidence from '행사기간 (\d{4}-\d{2}-\d{2})')::date;
 new.score:=greatest(5,least(95,50
  +4*least(greatest(coalesce(nullif(new.event_data->>'articles','')::integer,1),1),5)
  +case when new.source_updated_at>now()-interval '7 days' then 10 when new.source_updated_at>now()-interval '21 days' then 5 else 0 end
  +case when coalesce(new.event_data->>'homepage','')<>'' then 7 else 0 end
  +case when coalesce(new.event_data->>'contact_page','')<>'' then 8 else 0 end
  +case when private.sales_public_inquiry_email(new.event_data) is not null then 15 else 0 end
  -- 행사 전 · 대행사 미정일 가능성
  +case
    when new.source='행사 참여 브랜드' and starts is not null and starts>=kst+21 then 20
    when new.source='행사 참여 브랜드' and (new.end_date<kst or (starts is not null and starts<kst)) then -30
    when new.source='news_brand' and new.evidence ~ '(오픈 예정|개최 예정|진행 예정|출시 예정|런칭 예정|론칭 예정|팝업 예정|입점 모집|참가 모집|대행사 (선정|모집)|운영사 (선정|모집)|한국 (첫 )?진출|국내 (첫 )?진출|첫 매장)' then 15
    when new.source='news_brand' then -25
    else 0 end));
 return new;
exception when invalid_text_representation or datetime_field_overflow then return new;
end $$;

update public.sales_methods set signal='매장·쇼룸·플래그십 오픈 예정 소식(오픈 전). 이미 오픈이 보도된 매장은 대행사가 정해진 것으로 보고 다음 시즌만 낮은 우선순위로',updated_at=now() where name='신규 매장·플래그십 오픈 후속';
update public.sales_methods set signal='팝업 개최 예정 소식(개최 전 · 대행사 미정). 이미 보도된 팝업은 이 방법이 아니라 그 대행사에 제작 협력 제안',updated_at=now() where name='팝업 오픈 브랜드 후속 제안';
update public.sales_methods set signal='개최 3주 이상 남은 박람회·전시회의 참가기업 모집·참가사 목록 (끝난 행사는 다음 회차 부스로만)',updated_at=now() where name='박람회·전시 참가사 부스 제안';
update public.sales_methods set signal='이미 보도된 행사·팝업·캠페인을 맡은 대행사·기획사(공간 제작·설치·운영 협력), 대행사 선정 공고',updated_at=now() where name='대행사·기획사 협력 제안';

update public.sales_prospects set score=score where source in ('news_brand','행사 참여 브랜드') and not blocked;
commit;
