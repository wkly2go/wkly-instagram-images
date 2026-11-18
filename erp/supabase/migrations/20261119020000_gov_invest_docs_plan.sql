-- 2026-11-19 대표 지시: 투자유치 공고도 자동 수집 · 사업계획서는 필요 정보만 넣으면 AI 가 작성 · 모든 요청사항과 지시는 인트라넷에
-- gov_programs.track(지원/투자) · gov_docs(자료 · 계획 문서) · gov_plan_drafts(사업계획서 초안). 모두 관리자 전용.
-- 문서 본문과 초안은 운영 DB 에만 둔다 (이 저장소는 공개).

alter table public.gov_programs add column if not exists track text not null default '지원';
alter table public.gov_programs drop constraint if exists gov_programs_track_chk;
alter table public.gov_programs add constraint gov_programs_track_chk check (track in ('지원','투자'));
comment on column public.gov_programs.track is '지원 = 지원사업 · 투자 = 투자유치 관련(데모데이 · 투자 설명회 · 팁스 · 액셀러레이터 · 펀드). 제목 · 개요 낱말로 자동 구분';

create or replace function public.gov_apply_fit(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare g public.gov_programs; c record; f record; v_fits jsonb := '{}'::jsonb;
  b_fit text := '제외'; b_score int := -1; b_note text; b_co text; v_text text;
begin
  select * into g from public.gov_programs where id = p_id;
  if not found then return; end if;
  for c in select key from public.gov_companies order by sort loop
    select * into f from public.gov_fit_eval(c.key, g.title, g.summary, g.target, g.target_detail, g.biz_years, g.region, g.category, g.supervising);
    v_fits := v_fits || jsonb_build_object(c.key, jsonb_build_object('fit', f.fit, 'score', f.score, 'note', f.note));
    if f.score > b_score then b_fit := f.fit; b_score := f.score; b_note := f.note; b_co := c.key; end if;
  end loop;
  v_text := g.title || ' ' || coalesce(g.summary, '');
  update public.gov_programs set fits = v_fits, fit = b_fit, fit_score = greatest(b_score, 0), fit_note = b_note, fit_company = b_co,
    track = case when v_text ~ '(투자|데모데이|팁스|액셀러레이|엑셀러레이|엔젤|펀드|오픈이노베이션)' or v_text ~* '(^|[^a-z])(IR|TIPS)([^a-z]|$)' then '투자' else '지원' end
   where id = p_id;
end $$;
revoke execute on function public.gov_apply_fit(uuid) from public, anon, authenticated;

create table if not exists public.gov_docs (
  key text primary key,
  title text not null,
  body text not null default '',
  sort int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.gov_docs is '정부지원사업 · 투자유치 자료와 계획 문서(마크다운). 관리자 전용 · 본문은 운영 DB 에만 두고 저장소에 넣지 않음';
alter table public.gov_docs enable row level security;
revoke all on public.gov_docs from anon;
revoke insert, delete, truncate on public.gov_docs from authenticated;
drop policy if exists gov_docs_select on public.gov_docs;
drop policy if exists gov_docs_update on public.gov_docs;
create policy gov_docs_select on public.gov_docs for select to authenticated using ((select public.is_admin()));
create policy gov_docs_update on public.gov_docs for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create table if not exists public.gov_plan_drafts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references public.gov_programs(id) on delete set null,
  company text not null,
  title text not null default '',
  inputs jsonb not null default '{}'::jsonb,
  sections jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.gov_plan_drafts is '사업계획서 초안 — 입력값(inputs)과 AI 가 쓴 항목(sections: problem · solution · scaleup · team). 관리자 전용. AI 호출은 기존 growth-ai 한도 안';
create index if not exists gov_plan_drafts_program_idx on public.gov_plan_drafts (program_id, updated_at desc);
alter table public.gov_plan_drafts enable row level security;
revoke all on public.gov_plan_drafts from anon;
revoke truncate on public.gov_plan_drafts from authenticated;
drop policy if exists gov_plan_drafts_all on public.gov_plan_drafts;
create policy gov_plan_drafts_all on public.gov_plan_drafts for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

select public.gov_rescore();
