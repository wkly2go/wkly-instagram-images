-- 일위대가 (2026-11-18 대표 지시 '일위대가와 일반 인테리어를 분리해서 개발해')
-- 일반 인테리어 견적(판매 단가 · 수량표 · 견적)과 따로 둔다: 자기 표 · 자기 화면(/ilwi). 견적 계산에는 끼어들지 않는다.
--  design.labor_rates : 시중노임단가 (대한건설협회 건설업 임금실태조사 · 반기마다)
--  design.ilwi_items  : 일위대가 항목 (단위당 재료비 + 노무비 + 경비)
--  design.ilwi_lines  : 항목의 줄 — 재료(물가 기준 기호 × 소요량) · 노무(직종 × 품) · 경비(금액 또는 노무비의 %)
-- 금액은 저장하지 않고 볼 때 계산한다(물가 기준 · 노임이 바뀌면 따라 바뀜). 읽기는 팀원, 고치기는 관리자. 지우는 것 없음.
create table if not exists design.labor_rates (
  code text primary key,
  name text not null,
  wage numeric(12,0) not null check (wage > 0),
  as_of date not null,
  low_sample boolean not null default false,
  source text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists design.ilwi_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  trade_code text references design.trades (code),
  name text not null,
  spec text not null default '',
  unit text not null default '',
  basis text not null default '',
  note text,
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists design.ilwi_lines (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references design.ilwi_items (id) on delete cascade,
  kind text not null check (kind in ('material', 'labor', 'expense')),
  ref_code text,
  name text not null,
  spec text not null default '',
  unit text not null default '',
  qty numeric(14,4) not null default 0 check (qty >= 0),
  unit_price numeric(14,2) check (unit_price is null or unit_price >= 0),
  pct numeric(7,3) check (pct is null or (pct >= 0 and pct <= 100)),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ilwi_lines_item on design.ilwi_lines (item_id, sort);
alter table design.labor_rates enable row level security;
alter table design.ilwi_items enable row level security;
alter table design.ilwi_lines enable row level security;
do $$ declare t text; begin
  foreach t in array array['labor_rates', 'ilwi_items', 'ilwi_lines'] loop
    if not exists (select 1 from pg_policies where schemaname = 'design' and tablename = t and policyname = t || '_read') then
      execute format('create policy %I on design.%I for select to authenticated using ((select public.is_active_member()))', t || '_read', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'design' and tablename = t and policyname = t || '_admin') then
      execute format('create policy %I on design.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t || '_admin', t);
    end if;
  end loop;
end $$;
grant select, insert, update, delete on design.labor_rates, design.ilwi_items, design.ilwi_lines to authenticated;
grant all on design.labor_rates, design.ilwi_items, design.ilwi_lines to service_role;

create or replace view public.design_labor_rates with (security_invoker = true) as
  select code, name, wage, as_of, low_sample, source from design.labor_rates;

-- 줄마다 지금 단가: 직접 적은 단가가 있으면 그것, 없으면 물가 기준(기호) · 노임(직종)에서
create or replace view public.design_ilwi_lines with (security_invoker = true) as
  select l.id, l.item_id, l.kind, l.ref_code, l.name, l.spec, l.unit, l.qty, l.unit_price, l.pct, l.sort,
         coalesce(l.unit_price, p.price, w.wage) as price,
         case when l.unit_price is not null then '직접 입력' when p.id is not null then p.source_name when w.code is not null then w.source end as price_source,
         coalesce(p.notice_date, w.as_of) as price_date,
         case when l.pct is null then round(l.qty * coalesce(l.unit_price, p.price, w.wage)) end as amount
  from design.ilwi_lines l
  left join design.price_refs p on l.kind = 'material' and p.code = l.ref_code
  left join design.labor_rates w on l.kind = 'labor' and w.code = l.ref_code;

-- 항목마다 재료비 · 노무비 · 경비 · 합계. 경비 줄에 %가 있으면 노무비의 그 비율
create or replace view public.design_ilwi_items with (security_invoker = true) as
  select i.id, i.code, i.trade_code, i.name, i.spec, i.unit, i.basis, i.note, i.active, i.updated_at,
         t.material, t.labor, t.expense, t.material + t.labor + t.expense as total, t.lines, t.missing
  from design.ilwi_items i
  cross join lateral (
    select coalesce(sum(x.amount) filter (where x.kind = 'material'), 0) as material,
           coalesce(sum(x.amount) filter (where x.kind = 'labor'), 0) as labor,
           coalesce(sum(x.amount) filter (where x.kind = 'expense' and x.pct is null), 0)
             + round(coalesce(sum(x.pct) filter (where x.kind = 'expense' and x.pct is not null), 0) / 100.0 * coalesce(sum(x.amount) filter (where x.kind = 'labor'), 0)) as expense,
           count(*) as lines,
           count(*) filter (where x.pct is null and x.price is null) as missing
    from public.design_ilwi_lines x where x.item_id = i.id
  ) t;
-- 고치기용 보기(표 그대로 · 계산 칸 없음) — 권한은 표의 RLS 가 정한다(관리자만 고침)
create or replace view public.design_ilwi_item_rows with (security_invoker = true) as
  select id, code, trade_code, name, spec, unit, basis, note, active, created_by, created_at, updated_at from design.ilwi_items;
create or replace view public.design_ilwi_line_rows with (security_invoker = true) as
  select id, item_id, kind, ref_code, name, spec, unit, qty, unit_price, pct, sort, created_at from design.ilwi_lines;
grant select on public.design_labor_rates, public.design_ilwi_lines, public.design_ilwi_items to authenticated;
grant select, insert, update, delete on public.design_ilwi_item_rows, public.design_ilwi_line_rows to authenticated;

-- 시중노임단가: 대한건설협회 「2026년 하반기 적용 건설업 임금실태 조사 보고서」 일반공사 직종 (2026-09-01 적용 · 1일 8시간 기준)
-- 조사 현장이 5곳 미만인 직종은 low_sample. 조사되지 않은 직종(지붕잇기공 등)은 넣지 않는다.
insert into design.labor_rates (code, name, wage, as_of, low_sample, source)
select v.code, v.name, v.wage, date '2026-09-01', v.low, '대한건설협회 시중노임단가 2026 하반기'
from (values
  ('1001','작업반장',218316,false),('1002','보통인부',172698,false),('1003','특별인부',228717,false),('1004','조력공',181496,false),('1005','제도사',242423,true),
  ('1006','비계공',284440,false),('1007','형틀목공',275379,false),('1008','철근공',268932,false),('1009','철공',243870,false),('1010','철판공',220901,false),
  ('1011','철골공',255172,false),('1012','용접공',286330,false),('1013','콘크리트공',276285,false),('1014','보링공',233503,false),('1015','착암공',223246,true),
  ('1016','화약취급공',270444,false),('1017','할석공',246224,false),('1018','포설공',221306,true),('1019','포장공',274873,false),('1020','잠수부',391240,true),
  ('1021','조적공',273229,false),('1022','견출공',254875,false),('1023','건축목공',282990,false),('1024','창호공',248547,false),('1025','유리공',258602,false),
  ('1026','방수공',233163,false),('1027','미장공',279102,false),('1028','타일공',294379,false),('1029','도장공',268225,false),('1030','내장공',258904,false),
  ('1031','도배공',229833,false),('1032','연마공',208207,true),('1033','석공',270694,false),('1034','줄눈공',212390,false),('1035','판넬조립공',246986,false),
  ('1037','벌목부',257444,true),('1038','조경공',235843,false),('1039','배관공',249073,false),('1040','배관공(수도)',260673,false),('1041','보일러공',240647,true),
  ('1042','위생공',221435,false),('1043','덕트공',208140,false),('1044','보온공',222151,false),('1045','인력운반공',183687,true),('1046','궤도공',220821,false),
  ('1048','건설기계운전사',283323,false),('1049','화물차운전사',240042,true),('1051','기계설비공',242647,false),
  ('1056','플랜트배관공',327442,false),('1057','플랜트제관공',268949,false),('1058','플랜트용접공',289745,false),('1059','플랜트특수용접공',334739,true),
  ('1060','플랜트기계설치공',234041,false),('1061','플랜트특별인부',215601,false),('1062','플랜트케이블전공',263300,true),('1063','플랜트계장공',204167,true),
  ('1065','플랜트보온공',252567,true),('1066','제철축로공',365714,true),('1067','비파괴시험공',220565,false),('1068','특급품질관리원',200971,true),
  ('1069','고급품질관리원',199200,true),('1070','중급품질관리원',179012,false),('1071','초급품질관리원',150049,true),('1072','지적기사',283066,false),
  ('1073','지적산업기사',251236,false),('1074','지적기능사',175118,false),('1075','내선전공',276108,false),('1076','특고압케이블전공',444519,false),
  ('1077','고압케이블전공',376049,false),('1078','저압케이블전공',306274,false),('1079','송전전공',645607,false),('1080','송전활선전공',685744,false),
  ('1081','배전전공',420978,false),('1082','배전활선전공',562067,false),('1083','플랜트전공',269471,false),('1084','계장공',321645,false),
  ('1085','철도신호공',318257,false),('1086','통신내선공',286219,false),('1087','통신설비공',316875,false),('1088','통신외선공',410182,false),
  ('1089','통신케이블공',438070,false),('1090','무선안테나공',360084,false),('1091','석면해체공',203461,true)
) v(code, name, wage, low)
on conflict (code) do update set name = excluded.name, wage = excluded.wage, as_of = excluded.as_of, low_sample = excluded.low_sample, source = excluded.source, updated_at = now()
where design.labor_rates.as_of <= excluded.as_of;
notify pgrst, 'reload schema';
