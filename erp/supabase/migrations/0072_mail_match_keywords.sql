-- 0072 메일 ↔ 프로젝트 연결 보강: 프로젝트 이름 전체가 아니라 핵심 단어(띵크어띵 · 로이비 · 해성2빌딩 · 나름대로 …)로도 연결
--   흔한 말(팝업 · 행사 · 인테리어 · 브랜드 …)과 짧은 말(한글 3자 미만 · 영문 4자 미만)은 빼고 비교
create or replace function public.match_projects_loose(p_text text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  with stop(w) as (select unnest(array['팝업','행사','인테리어','브랜드','프로젝트','제작','운영','사업','공간','문의','설계','견적','이벤트','전시','전시팝업','사무실','이전','개발','채널','홍보','노출','광고','방어','뉴스레터','라이브러리','파이프라인','디자인자동화','시공','소품','계획','정비사업','연말','파티','대행사','플래그십','커피','뷰티플랫폼','스토어','사인물','교내','로비','부스','외부','간판','경영업무','캐러셀','릴스','파트너스','크루','제휴','공간대관','부정클릭','검색','입찰','제안','마감재','라이프스타일','게릴라','관급설계','홈페이지','인트라넷','대형','포토북','공공주택지구','본사','서울역','VMD','SNS','삼성의료원'])),
  tok as (
    select p.id, t from public.projects p, regexp_split_to_table(p.name, '[\s·,()/\-_]+') t
    where (t ~ '[가-힣]' and length(t) >= 3) or (t !~ '[가-힣]' and length(t) >= 4)
  )
  select coalesce(array_agg(distinct tok.id), '{}')
  from tok
  where p_text is not null and tok.t not in (select w from stop) and p_text ilike '%' || tok.t || '%'
$$;
grant execute on function public.match_projects_loose(text) to authenticated;

create or replace function private.mail_link() returns trigger language plpgsql set search_path = '' as $$
declare
  v_text text := concat_ws(' ', new.subject, new.snippet, array_to_string(new.attachments, ' '));
  v_other text := case when new.from_addr ilike '%@thewklyn.com' then new.to_addr else new.from_addr end;
  v_contact uuid;
  v_client uuid;
begin
  new.project_ids := (select coalesce(array_agg(distinct x), '{}') from unnest(public.match_projects(v_text) || public.match_projects_loose(v_text)) x);
  if v_other is not null then
    select c.id, c.client_id into v_contact, v_client from public.contacts c where lower(c.email) = lower(v_other) limit 1;
    if v_client is null then
      select k.id into v_client from public.clients k where lower(k.email) = lower(v_other) limit 1;
    end if;
    if v_client is not null and cardinality(new.project_ids) = 0 then
      new.project_ids := coalesce((select array_agg(p.id) from public.projects p where p.client_id = v_client and p.status in ('진행', '기획', 'NIC') having count(*) = 1), '{}');
    end if;
  end if;
  new.contact_id := v_contact;
  new.client_id := v_client;
  return new;
end $$;
