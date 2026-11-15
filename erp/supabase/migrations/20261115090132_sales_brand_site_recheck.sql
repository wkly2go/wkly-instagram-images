-- 자체 사이트 판정을 강화했다(사이트가 그 브랜드 이름으로 자신을 소개해야 함 · 매거진 · 블로그 주소 제외).
-- 예전 기준으로 찾은 사이트에는 잘못된 것이 섞여 있으므로 기록을 비우고 새 기준으로 다시 확인한다.
begin;
update public.sales_prospects set contact='',
 evidence=regexp_replace(evidence,' · 자체 사이트 확인: https://[^ ]+','','g'),
 next_action='자체 사이트 다시 확인 중',
 event_data=event_data-'site_checked'-'homepage'-'contact_page'-'public_emails',revision=revision+1
 where source='news_brand' and coalesce(event_data->>'homepage','')<>'';
commit;
