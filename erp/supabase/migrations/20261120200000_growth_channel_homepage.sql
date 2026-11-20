-- 2026-11-20 콘텐츠·배포 채널에 '홈페이지' 추가 (대표 지시 '홈페이지도 포함해')
-- growth_save 의 채널 검사(3개 고정 · 세 이름)를 넓힌다: 예전 콘텐츠(3채널)는 그대로 저장되고, 새 콘텐츠 · 다시 저장한 콘텐츠는 4채널.
-- 함수 본문은 운영에 있는 것을 그대로 읽어 세 군데만 바꿔 다시 만든다(시그니처 그대로 · DROP 없음). 바뀌지 않으면 멈춤.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.growth_save(uuid,jsonb,integer)'::regprocedure);
  n := replace(d, $q$jsonb_array_length(x->'versions')<>3$q$, $q$jsonb_array_length(x->'versions') not in (3, 4)$q$);
  n := replace(n, $q$from jsonb_array_elements(x->'versions') z
  )<>3 then$q$, $q$from jsonb_array_elements(x->'versions') z
  )<>jsonb_array_length(x->'versions') then$q$);
  n := replace(n, $q$('네이버 블로그','인스타그램','유튜브')$q$, $q$('네이버 블로그','인스타그램','유튜브','홈페이지')$q$);
  if n = d or position($q$'홈페이지'$q$ in n) = 0 or position('not in (3, 4)' in n) = 0 or position(')<>jsonb_array_length' in n) = 0 then
    raise exception 'growth_save 본문이 예상과 달라 바꾸지 않았습니다.';
  end if;
  execute n;
end $$;
notify pgrst, 'reload schema';
