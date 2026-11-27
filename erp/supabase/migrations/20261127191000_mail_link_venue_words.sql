-- 메일 → 프로젝트 자동 연결: 행사장 · 지역 · 흔한 행사 낱말 제외 · 낱말 경계 확인 (대표 지시 2026-11-27 '메일이 구분 안돼고 있어 수정하고 바로잡아')
-- 원인: '포켓몬 킨텍스 팝업'의 '킨텍스'로 킨텍스에서 열린 다른 행사(K-뷰티엑스포) 메일이 붙음 · 'BUILD' 'Live' 같은 영어 낱말이 building · delivery 속에서 걸림(157 · 46통)
--       · '파트너' '라이브' '코엑스' '박람회' 같은 흔한 낱말 · '플릭스'가 넷플릭스 속에서 걸림.
-- 고침: 제외 낱말 추가 · 한글 낱말은 앞에 한글이 붙어 있으면 다른 낱말의 일부로 봄 · 영어 낱말은 앞뒤가 글자가 아닐 때만.
-- 바로잡기: 지금 연결을 private.mail_link_backup_20261127 에 남기고 → 모두 비운 뒤 보낸 순서대로 다시 맞춤(손으로 고친 연결은 mail_apply_overrides 로 지켜짐).
create or replace function public.match_projects_loose(p_text text)
 returns uuid[]
 language sql
 stable security definer
 set search_path to ''
as $function$
  with stop(w) as (select unnest(array['팝업','행사','인테리어','브랜드','프로젝트','제작','운영','사업','공간','문의','설계','견적','이벤트','전시','전시팝업','사무실','이전','개발','채널','홍보','노출','광고','방어','뉴스레터','라이브러리','파이프라인','디자인자동화','시공','소품','계획','정비사업','연말','파티','대행사','플래그십','커피','뷰티플랫폼','스토어','사인물','교내','로비','부스','외부','간판','경영업무','캐러셀','릴스','파트너스','크루','제휴','공간대관','부정클릭','검색','입찰','제안','마감재','라이프스타일','게릴라','관급설계','홈페이지','인트라넷','대형','포토북','공공주택지구','본사','서울역','VMD','SNS','삼성의료원',
     '팝업스토어','팝업존','브랜드존','플래그십스토어','디자인','마케팅','글로벌','성수','성수동','더현대','현대백화점','신세계','롯데','백화점','쇼룸','오피스','리뉴얼','카페','매장','컨셉','기획','캠페인','콘텐츠','더위클리','아트리어','오픈','런칭','론칭','신제품','시즌','크리스마스','홀리데이','여름','겨울','서울','부산','대구','강남','한남','팝업행사',
     -- 2026-11-27 추가: 행사장 · 지역 · 흔한 행사 낱말 (대표 '메일이 구분 안돼고 있어')
     '킨텍스','코엑스','벡스코','엑스코','세텍','aT센터','엑스포','박람회','전시회','페스타','페스티벌','축제','콘서트','뮤지컬','공연','라이브','유튜브','인스타그램','네트워킹','파트너','포토월','포토존','팝업부스','캐릭터','굿즈','오브제','바디케어','키오스크','체험존','라운지',
     '광주','인천','대전','울산','수원','고양','일산','판교','분당','용인시','여의도','잠실','홍대','명동','을지로','용산','광화문','송도','제주','동대문','서초동','강남구','마포','종로',
     'BUILD','Live','LIVE','STUDIO','Studio','HOUSE','House','STORE','Store','POPUP','Popup','EVENT','Event','DESIGN','Design','PROJECT','Project','KOREA','Korea','SEOUL','Seoul'])),
  tok as (
    select q.id, q.t, count(*) over (partition by lower(q.t)) df
      from (select distinct p.id, t from public.projects p, regexp_split_to_table(p.name, '[\s·,()/\-_]+') t
             where t !~ '^[0-9]+$' and ((t ~ '[가-힣]' and length(t) >= 3) or (t !~ '[가-힣]' and length(t) >= 4))) q
  ),
  hit as (select distinct tok.id from tok
           where p_text is not null and tok.df = 1
             and lower(tok.t) not in (select lower(w) from stop)
             and not exists (select 1 from public.profiles pr where replace(pr.name, ' ', '') = tok.t)
             and p_text ilike '%' || tok.t || '%'
             and case when tok.t ~ '[가-힣]'
                      -- 한글 낱말: 앞에 한글이 붙어 있으면 다른 낱말의 일부(예: 넷플릭스 속 플릭스)
                      then p_text ~ ('(^|[^가-힣])' || regexp_replace(tok.t, '([\[\]\(\)\.\*\+\?\^\$\{\}\|\\])', '\\\1', 'g'))
                      -- 영어 · 숫자 낱말: 앞뒤가 글자가 아니어야(예: building 속 BUILD)
                      else p_text ~* ('(^|[^A-Za-z0-9])' || regexp_replace(tok.t, '([\[\]\(\)\.\*\+\?\^\$\{\}\|\\])', '\\\1', 'g') || '($|[^A-Za-z0-9])')
                 end)
  select case when (select count(*) from hit) between 1 and 2 then (select array_agg(id) from hit) else '{}'::uuid[] end
$function$;

create table if not exists private.mail_link_backup_20261127 as select id, project_ids from public.mail_index;
update public.mail_index set project_ids = '{}' where cardinality(project_ids) > 0;
-- 보낸 순서대로 다시 맞춤 (트리거 mail_index_link 가 subject 갱신에 반응 · 운영에서는 나눠서 실행함)
do $$ declare r record; begin
  for r in select id from public.mail_index order by sent_at nulls first, id loop
    update public.mail_index set subject = subject where id = r.id;
  end loop;
end $$;

-- 다시 맞춘 결과(운영 2026-11-27): 연결 1,074 → 861통 · 3곳 이상 0 · K-뷰티엑스포 메일 0.
-- '공간대관 사업'(TW2610-03)의 공간 제휴 · 대관 메일 53통은 낱말이 아니라 같은 대화로 붙어 있던 것이라 손으로 고친 연결(add)로 되살림:
-- insert into public.mail_project_overrides (mail_id, project_id, action, created_by) … where subject ~ '공간 제휴|대관|공간 소개'
