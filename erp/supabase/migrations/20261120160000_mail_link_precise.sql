-- 2026-11-20 메일 → 프로젝트 자동 분류 고침 (대표 '메일 분류가 안된거 같아' · AR2611-08 뮤지컬 플릭스에 우쑤한국사 · 케이월드미디어 · 메르시 메일이 붙음)
-- 원인: 느슨한 맞춤(match_projects_loose)이 프로젝트 이름 낱말 중 '팝업스토어'(6곳) · '2026'(2곳) · '디자인' · '글로벌' · '성수동' 같은
--       흔한 낱말로도 짝을 지어, 메일 한 통이 프로젝트 6~11곳에 붙음 (3,354통 중 816통이 3곳 이상).
-- 고친 것: ① 한 프로젝트 이름에만 있는 낱말만 씀(두 곳 이상에 있으면 흔한 낱말) ② 숫자만인 낱말 · 지역 · 백화점 · 일반 낱말 제외
--          ③ 그래도 3곳 이상 맞으면 어느 것인지 모르는 것으로 보고 붙이지 않음
--          ④ 이미 들어온 메일도 보낸 순서대로 다시 맞춤(같은 대화 따라 붙이기 · 거래처 담당자 맞춤은 그대로)
-- 시그니처는 그대로 (DROP 없음).

create or replace function public.match_projects_loose(p_text text)
returns uuid[] language sql stable security definer set search_path to '' as $$
  with stop(w) as (select unnest(array['팝업','행사','인테리어','브랜드','프로젝트','제작','운영','사업','공간','문의','설계','견적','이벤트','전시','전시팝업','사무실','이전','개발','채널','홍보','노출','광고','방어','뉴스레터','라이브러리','파이프라인','디자인자동화','시공','소품','계획','정비사업','연말','파티','대행사','플래그십','커피','뷰티플랫폼','스토어','사인물','교내','로비','부스','외부','간판','경영업무','캐러셀','릴스','파트너스','크루','제휴','공간대관','부정클릭','검색','입찰','제안','마감재','라이프스타일','게릴라','관급설계','홈페이지','인트라넷','대형','포토북','공공주택지구','본사','서울역','VMD','SNS','삼성의료원',
     '팝업스토어','팝업존','브랜드존','플래그십스토어','디자인','마케팅','글로벌','성수','성수동','더현대','현대백화점','신세계','롯데','백화점','쇼룸','오피스','리뉴얼','카페','매장','컨셉','기획','캠페인','콘텐츠','더위클리','아트리어','오픈','런칭','론칭','신제품','시즌','크리스마스','홀리데이','여름','겨울','서울','부산','대구','강남','한남','팝업행사'])),
  tok as (
    select q.id, q.t, count(*) over (partition by lower(q.t)) df
      from (select distinct p.id, t from public.projects p, regexp_split_to_table(p.name, '[\s·,()/\-_]+') t
             where t !~ '^[0-9]+$' and ((t ~ '[가-힣]' and length(t) >= 3) or (t !~ '[가-힣]' and length(t) >= 4))) q
  ),
  hit as (select distinct tok.id from tok
           where p_text is not null and tok.df = 1 and tok.t not in (select w from stop) and p_text ilike '%' || tok.t || '%')
  select case when (select count(*) from hit) between 1 and 2 then (select array_agg(id) from hit) else '{}'::uuid[] end
$$;

-- 이미 들어온 메일 다시 맞춤: 보낸 순서대로 한 통씩(같은 대화 따라 붙이기가 앞 메일의 새 결과를 보게) · 트리거 mail_index_link 가 계산
do $$
declare r record;
begin
  for r in select id from public.mail_index order by sent_at nulls first, id loop
    update public.mail_index set subject = subject where id = r.id;
  end loop;
end $$;

-- 2차 (같은 날): 같은 대화 따라 붙이기가 아직 다시 맞추지 않은 메일의 예전 값(프로젝트 6~11곳)을 읽어 와 다시 퍼짐
--   → 따라 붙일 때도 1~2곳일 때만 · 연결을 모두 비운 뒤 보낸 순서대로 다시 맞춤
create or replace function private.mail_link()
returns trigger language plpgsql set search_path to '' as $$
declare
  v_text text := concat_ws(' ', new.subject, new.snippet, array_to_string(new.attachments, ' '));
  v_other text := case when new.from_addr ilike '%@thewklyn.com' then new.to_addr else new.from_addr end;
  v_contact uuid;
  v_client uuid;
  v_thread uuid[];
begin
  new.project_ids := (select coalesce(array_agg(distinct x), '{}') from unnest(public.match_projects(v_text) || public.match_projects_loose(v_text)) x);
  if v_other is not null then
    select c.id, c.client_id into v_contact, v_client from public.contacts c where lower(c.email) = lower(v_other) limit 1;
    if v_client is null then
      select k.id into v_client from public.clients k where lower(k.email) = lower(v_other) limit 1;
    end if;
    if v_client is not null and cardinality(new.project_ids) = 0 then
      new.project_ids := coalesce((select array_agg(p.id) from public.projects p where p.client_id = v_client and p.status in ('진행', '문의', 'NIC') having count(*) = 1), '{}');
    end if;
  end if;
  -- 같은 대화의 다른 메일이 이미 프로젝트에 붙어 있으면 그 프로젝트로 (1~2곳일 때만)
  if cardinality(new.project_ids) = 0 and new.thread_id is not null then
    v_thread := coalesce((select array_agg(distinct x) from public.mail_index m, unnest(m.project_ids) x
                           where m.thread_id = new.thread_id and m.id <> new.id), '{}');
    if cardinality(v_thread) between 1 and 2 then new.project_ids := v_thread; end if;
  end if;
  new.contact_id := v_contact;
  new.client_id := v_client;
  return new;
end $$;

update public.mail_index set project_ids = '{}' where cardinality(project_ids) > 0;
do $$
declare r record;
begin
  for r in select id from public.mail_index order by sent_at nulls first, id loop
    update public.mail_index set subject = subject where id = r.id;
  end loop;
end $$;
