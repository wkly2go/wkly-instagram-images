-- 영업 자동은 요청이 있을 때만 (대표 지시 2026-11-25 '영업 자동은 요청시에만 작업해')
-- 스스로 일을 찾아 하던 단계(자동 기획 하루 6회 · 수집 · 뉴스 · 브랜드 · 연락처 찾기 · AI 회신 초안 · 브리핑 등)는 끔.
-- 요청 · 승인을 받아 처리하는 단계(영업 대화 결과 받기 · 승인한 기획의 실행 묶음 · 승인한 발송 · 수신 거부 감지)와
-- 홈페이지 문의 응대 단계는 그대로 둠. 다시 켜려면 enabled = true · automatic = true.

update public.sales_strategy_settings set automatic = false where id;

update private.sales_ops_steps set enabled = false
where step in (
  'strategy_prepare',    -- 자동 기획 (하루 6회 · AI)
  'collect',             -- 08시 나라장터 · 영업 수집
  'news',                -- 뉴스 수집
  'news_brands',         -- 뉴스 속 브랜드 등록
  'brand_site',          -- 브랜드 공식 사이트 찾기
  'contact_discovery',   -- 회사 연락 창구 찾기
  'contact_evidence',    -- 연락처 근거 확보
  'followup_research',   -- 후속 조사
  'reply_drafts',        -- 회신 대응 초안 (AI)
  'method_review',       -- 주간 영업 방법 검토
  'brief',               -- 09시 영업 브리핑
  'strategy_brief',      -- 09시 기획 브리핑
  'g2b_watchdog',        -- 나라장터 수집 멈춤 복구 (수집을 껐으므로)
  'inquiry_prospects',   -- 웹 문의 → 영업 대상 자동 등록
  'interview_prospects'  -- 서면 인터뷰 → 영업 후보 자동 등록
);
