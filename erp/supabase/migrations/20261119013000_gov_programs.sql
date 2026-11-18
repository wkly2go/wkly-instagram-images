-- 정부지원사업 (2026-11-19 대표 지시 '인트라넷에 만들어' · '관리자 메뉴는 비공개야' · '대표만 알람 받음' · '더위클리와 아트리어 자료들 사용해')
-- 공고 자동 수집(K-Startup 공공데이터 · 기존 public_data_get · 금고 DATA_GO_KR_KEY) → 회사별 판정 → 대표 알림.
-- 관리자 전용(RLS is_admin). 기존 표는 건드리지 않는다. AI 호출 없음(계산식) · 하루 한 번 2쪽 안팎이라 서버 부하 없음.
-- 회사 기준(설립일 · 업종 · 인증)은 운영 DB 에만 넣는다 — 이 저장소는 공개라 여기에는 표 모양만 둔다.

create table if not exists public.gov_companies (
  key text primary key,
  name text not null,
  short text not null,
  founded date not null,
  region text not null default '서울',
  industries text not null default '',
  certifications text[] not null default '{}',
  cert_notes text not null default '',
  include_keywords text[] not null default '{}',
  exclude_keywords text[] not null default '{}',
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
comment on table public.gov_companies is '정부지원사업 추천 기준 — 회사별(더위클리 · 아트리어) 설립일 · 업종 · 보유 인증 · 관심/제외 낱말. 관리자 전용. 주민번호 · 계좌 · 매출은 넣지 않음';

create table if not exists public.gov_programs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_id text not null,
  title text not null,
  org text,
  supervising text,
  category text,
  region text,
  target text,
  target_detail text,
  biz_years text,
  target_age text,
  summary text,
  support_content text,
  exclude_detail text,
  apply_start date,
  apply_end date,
  detail_url text,
  apply_url text,
  contact text,
  fit text not null default '보통',
  fit_score int not null default 0,
  fit_note text,
  fit_company text,
  fits jsonb not null default '{}'::jsonb,
  status text not null default '신규',
  owner_id uuid references public.profiles(id) on delete set null,
  decision_note text,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id),
  constraint gov_programs_status_chk check (status in ('신규','검토 중','신청 준비','제출','선정','탈락','보류','마감')),
  constraint gov_programs_fit_chk check (fit in ('높음','보통','낮음','제외'))
);
comment on table public.gov_programs is '정부지원사업 공고 (K-Startup 등 공공데이터 매일 동기화) · 관리자 전용. fit=추천 등급(참고용, 최종 자격은 공고 원문 확인), status=진행 상태. 삭제하지 않고 상태로 관리';
comment on column public.gov_programs.fits is '회사별 판정 {회사 key: {fit, score, note}} · fit/fit_score/fit_note/fit_company 는 그중 가장 높은 쪽';
create index if not exists gov_programs_end_idx on public.gov_programs (apply_end);
create index if not exists gov_programs_status_idx on public.gov_programs (status);
create index if not exists gov_programs_fit_idx on public.gov_programs (fit, fit_score desc);

create or replace function public.gov_programs_touch() returns trigger language plpgsql set search_path to '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists gov_programs_touch on public.gov_programs;
create trigger gov_programs_touch before update on public.gov_programs for each row execute function public.gov_programs_touch();

alter table public.gov_companies enable row level security;
alter table public.gov_programs enable row level security;
revoke all on public.gov_companies from anon;
revoke all on public.gov_programs from anon;
revoke insert, delete, truncate on public.gov_programs from authenticated;
revoke insert, delete, truncate on public.gov_companies from authenticated;
drop policy if exists gov_programs_select on public.gov_programs;
drop policy if exists gov_programs_update on public.gov_programs;
drop policy if exists gov_companies_select on public.gov_companies;
drop policy if exists gov_companies_update on public.gov_companies;
create policy gov_programs_select on public.gov_programs for select to authenticated using ((select public.is_admin()));
create policy gov_programs_update on public.gov_programs for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy gov_companies_select on public.gov_companies for select to authenticated using ((select public.is_admin()));
create policy gov_companies_update on public.gov_companies for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- 한 회사 기준의 판정 (참고용). 지역 · 업력이 안 맞으면 제외, 나머지는 점수
create or replace function public.gov_fit_eval(p_company text, p_title text, p_summary text, p_target text, p_target_detail text, p_biz_years text, p_region text, p_category text, p_supervising text)
returns table (fit text, score int, note text)
language plpgsql stable security definer set search_path to '' as $$
declare
  s public.gov_companies;
  v_age numeric;
  v_max int;
  v_text text := coalesce(p_title,'') || ' ' || coalesce(p_summary,'') || ' ' || coalesce(p_target_detail,'');
  v_cert_text text;
  v_score int := 40;
  v_notes text[] := array[]::text[];
  v_hits text[];
  v_excl boolean := false;
begin
  select * into s from public.gov_companies where key = p_company;
  if not found then return; end if;
  v_age := ((now() at time zone 'Asia/Seoul')::date - s.founded) / 365.25;
  -- '중소기업' 안의 '소기업', '중소벤처기업부' 안의 '벤처기업'이 인증 언급으로 잡히지 않게
  v_cert_text := regexp_replace(v_text, '중소벤처기업(부|진흥공단)|벤처기업부|벤처기업협회|중소기업', '', 'g');

  if nullif(btrim(p_region),'') is not null and p_region not like '%전국%' and p_region not like '%' || s.region || '%' then
    v_excl := true; v_notes := array_append(v_notes, '지역 제한: ' || p_region);
  end if;

  if nullif(btrim(p_biz_years),'') is not null and p_biz_years not like '%이상%' then
    select max((m)[1]::int) into v_max from regexp_matches(p_biz_years, '(\d+)년미만', 'g') m;
    if v_max is null then
      if p_biz_years like '%예비창업%' then v_excl := true; v_notes := array_append(v_notes, '예비창업자 대상'::text); end if;
    elsif v_age >= v_max then
      v_excl := true; v_notes := array_append(v_notes, '업력 ' || v_max || '년 미만 대상 (현재 ' || trunc(v_age, 1) || '년)');
    else
      v_notes := array_append(v_notes, '업력 조건 충족(' || v_max || '년 미만)');
    end if;
  end if;

  if nullif(btrim(p_target),'') is not null and p_target not like '%일반기업%' and p_target not like '%1인 창조기업%' then
    v_score := v_score - 25; v_notes := array_append(v_notes, '대상: ' || p_target);
  end if;

  select array_agg(k) into v_hits from unnest(s.include_keywords) k where v_text ilike '%' || k || '%';
  if v_hits is not null then
    v_score := v_score + least(36, 12 * cardinality(v_hits));
    v_notes := array_append(v_notes, '관심 분야: ' || array_to_string(v_hits[1:4], ', '));
  end if;
  v_hits := null;
  select array_agg(k) into v_hits from unnest(s.exclude_keywords) k where v_text ilike '%' || k || '%';
  if v_hits is not null then
    v_score := v_score - least(30, 15 * cardinality(v_hits));
    v_notes := array_append(v_notes, '타 업종 가능성: ' || array_to_string(v_hits[1:3], ', '));
  end if;

  -- 보유 인증이 공고에 언급되면 가점 (우대 · 자격 가능성). 소기업 · 출판사는 흔한 말이라 세지 않음
  v_hits := null;
  select array_agg(c) into v_hits from unnest(s.certifications) c
   where c not in ('출판사', '소기업')
     and v_cert_text ilike '%' || replace(replace(c, '산업디자인전문회사', '디자인전문회사'), '연구개발전담부서', '전담부서') || '%';
  if v_hits is not null then
    v_score := v_score + least(16, 8 * cardinality(v_hits));
    v_notes := array_append(v_notes, '보유 인증 언급: ' || array_to_string(v_hits, ', '));
  end if;

  if p_category like '%사업화%' or p_category like '%판로%' or p_category like '%해외%' or p_category like '%기술개발%' or p_category like '%R&D%' then v_score := v_score + 10;
  elsif p_category like '%자금%' or p_category like '%융자%' then v_score := v_score + 8;
  elsif p_category like '%인력%' then v_score := v_score + 6;
  elsif p_category like '%시설%' or p_category like '%공간%' then v_score := v_score + 4;
  elsif p_category like '%행사%' or p_category like '%네트워크%' then v_score := v_score - 5;
  end if;

  if p_title ~ '(수행기관|주관기관|운영기관|운영사|용역).{0,6}(모집|선정|공고)' then
    v_score := v_score - 25; v_notes := array_append(v_notes, '수행·주관기관 모집 공고'::text);
  elsif p_title ~ '(세미나|설명회|컨퍼런스|포럼|밋업|교육|강의|특강|스쿨|아카데미|웨비나|참가자|참관)' then
    v_score := v_score - 12; v_notes := array_append(v_notes, '행사·교육 성격'::text);
  end if;
  if p_supervising = '민간' then
    v_score := v_score - 8; v_notes := array_append(v_notes, '민간 주관'::text);
  elsif nullif(btrim(p_supervising),'') is not null then
    v_score := v_score + 6; v_notes := array_append(v_notes, p_supervising || ' 주관');
  end if;

  v_score := greatest(0, least(100, v_score));
  fit := case when v_excl then '제외' when v_score >= 60 then '높음' when v_score >= 45 then '보통' else '낮음' end;
  score := case when v_excl then 0 else v_score end;
  note := nullif(array_to_string(v_notes, ' · '), '');
  return next;
end $$;

-- 한 공고의 회사별 판정을 다시 계산해 넣음
create or replace function public.gov_apply_fit(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare g public.gov_programs; c record; f record; v_fits jsonb := '{}'::jsonb;
  b_fit text := '제외'; b_score int := -1; b_note text; b_co text;
begin
  select * into g from public.gov_programs where id = p_id;
  if not found then return; end if;
  for c in select key from public.gov_companies order by sort loop
    select * into f from public.gov_fit_eval(c.key, g.title, g.summary, g.target, g.target_detail, g.biz_years, g.region, g.category, g.supervising);
    v_fits := v_fits || jsonb_build_object(c.key, jsonb_build_object('fit', f.fit, 'score', f.score, 'note', f.note));
    if f.score > b_score then b_fit := f.fit; b_score := f.score; b_note := f.note; b_co := c.key; end if;
  end loop;
  update public.gov_programs set fits = v_fits, fit = b_fit, fit_score = greatest(b_score, 0), fit_note = b_note, fit_company = b_co where id = p_id;
end $$;

create or replace function public.gov_rescore() returns int
language plpgsql security definer set search_path to '' as $$
declare n int := 0; r record;
begin
  for r in select id from public.gov_programs where status <> '마감' loop
    perform public.gov_apply_fit(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- K-Startup 모집 중 공고 동기화 (100건씩 최대 8쪽)
create or replace function public.gov_sync_kstartup() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pg int := 1; r jsonb; it jsonb; n int := 0; tot int := 0; v_id uuid;
begin
  loop
    r := public.public_data_get('B552735/kisedKstartupService01/getAnnouncementInformation01',
      jsonb_build_object('page', pg::text, 'perPage', '100', 'returnType', 'json', 'cond[rcrt_prgs_yn::EQ]', 'Y'), 'GOV_SYNC');
    exit when jsonb_typeof(r #> '{body,data}') is distinct from 'array';
    tot := coalesce((r #>> '{body,matchCount}')::int, 0);
    for it in select * from jsonb_array_elements(r #> '{body,data}') loop
      continue when nullif(it->>'pbanc_sn','') is null or nullif(it->>'biz_pbanc_nm','') is null;
      insert into public.gov_programs (source, source_id, title, org, supervising, category, region, target, target_detail, biz_years, target_age,
          summary, support_content, exclude_detail, apply_start, apply_end, detail_url, apply_url, contact, raw)
      values ('kstartup', it->>'pbanc_sn', it->>'biz_pbanc_nm', nullif(it->>'pbanc_ntrp_nm',''), nullif(it->>'sprv_inst',''), nullif(it->>'supt_biz_clsfc',''),
          nullif(it->>'supt_regin',''), nullif(it->>'aply_trgt',''), nullif(it->>'aply_trgt_ctnt',''), nullif(it->>'biz_enyy',''), nullif(it->>'biz_trgt_age',''),
          nullif(it->>'pbanc_ctnt',''), nullif(it->>'support_ctnt',''), nullif(it->>'aply_excl_trgt_ctnt',''),
          case when it->>'pbanc_rcpt_bgng_dt' ~ '^\d{8}$' then to_date(it->>'pbanc_rcpt_bgng_dt','YYYYMMDD') end,
          case when it->>'pbanc_rcpt_end_dt' ~ '^\d{8}$' then to_date(it->>'pbanc_rcpt_end_dt','YYYYMMDD') end,
          nullif(it->>'detl_pg_url',''), coalesce(nullif(it->>'biz_aply_url',''), nullif(it->>'aply_mthd_onli_rcpt_istc','')),
          nullif(btrim(coalesce(it->>'biz_prch_dprt_nm','') || ' ' || coalesce(it->>'prch_cnpl_no','')), ''), it)
      on conflict (source, source_id) do update set title = excluded.title, org = excluded.org, supervising = excluded.supervising, category = excluded.category,
          region = excluded.region, target = excluded.target, target_detail = excluded.target_detail, biz_years = excluded.biz_years, target_age = excluded.target_age,
          summary = excluded.summary, support_content = excluded.support_content, exclude_detail = excluded.exclude_detail, apply_start = excluded.apply_start,
          apply_end = excluded.apply_end, detail_url = excluded.detail_url, apply_url = excluded.apply_url, contact = excluded.contact, raw = excluded.raw
      returning id into v_id;
      perform public.gov_apply_fit(v_id);
      n := n + 1;
    end loop;
    exit when pg * 100 >= tot or pg >= 8;
    pg := pg + 1;
  end loop;
  update public.gov_programs set status = '마감' where apply_end < (now() at time zone 'Asia/Seoul')::date and status in ('신규','검토 중');
  return jsonb_build_object('upserted', n, 'open_total', tot);
end $$;

-- 관리자: 화면의 '지금 다시 받기' · '저장하고 다시 판정'
create or replace function public.gov_refresh() returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  if not public.is_admin() then raise exception '관리자만 실행할 수 있습니다'; end if;
  return public.gov_sync_kstartup();
end $$;

create or replace function public.gov_rescore_now() returns int
language plpgsql security definer set search_path to '' as $$
begin
  if not public.is_admin() then raise exception '관리자만 실행할 수 있습니다'; end if;
  return public.gov_rescore();
end $$;

-- 평일 아침 알림: 새 추천 · 마감 임박(D-7 · D-3 · D-1) — 대표만, 내용이 있을 때만 하루 1건
create or replace function public.gov_daily_alert() returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_new int; v_due int; v_list text; r record;
begin
  select count(*) into v_new from public.gov_programs where fit = '높음' and status = '신규' and first_seen_at > now() - interval '24 hours';
  select count(*) into v_due from public.gov_programs
   where apply_end in (v_day + 1, v_day + 3, v_day + 7) and (status in ('검토 중','신청 준비') or (fit = '높음' and status = '신규'));
  if v_new + v_due = 0 then return; end if;
  select string_agg(x.line, E'\n') into v_list from (
    select 'D-' || (apply_end - v_day) || ' ' || left(title, 60) as line from public.gov_programs
     where apply_end in (v_day + 1, v_day + 3, v_day + 7) and (status in ('검토 중','신청 준비') or (fit = '높음' and status = '신규'))
     order by apply_end limit 8) x;
  for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' and p.title = '대표' loop
    perform public.notify(r.id, '알람', '정부지원사업 · 새 추천 ' || v_new || '건 · 마감 임박 ' || v_due || '건', left(coalesce(v_list, '새 추천 공고를 확인해 주세요.'), 900), '/gov');
  end loop;
end $$;

revoke execute on function public.gov_fit_eval(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.gov_apply_fit(uuid) from public, anon, authenticated;
revoke execute on function public.gov_rescore() from public, anon, authenticated;
revoke execute on function public.gov_sync_kstartup() from public, anon, authenticated;
revoke execute on function public.gov_daily_alert() from public, anon, authenticated;
revoke execute on function public.gov_refresh() from public, anon;
revoke execute on function public.gov_rescore_now() from public, anon;
grant execute on function public.gov_refresh() to authenticated;
grant execute on function public.gov_rescore_now() to authenticated;

-- 매일 06:35(KST) 수집, 평일 08:40(KST) 알림
select cron.schedule('gov_sync_kstartup', '35 21 * * *', 'select public.gov_sync_kstartup()');
select cron.schedule('gov_daily_alert', '40 23 * * 0-4', 'select public.gov_daily_alert()');
