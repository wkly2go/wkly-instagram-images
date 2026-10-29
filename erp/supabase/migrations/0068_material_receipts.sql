-- 0068 자재 입출고 ↔ 프로젝트 지급 연동 (대표 지시 2026-10-29 "프로젝트 입출금을 간편하게, 자재 입고와 연동"
--      + "세금계산서와 영수증 · 현금 지급을 간편하게 기입" + "자재 입출고에 대한 사항도 포함")
--   - 구분: 입고(구매 → 지급 자동) · 출고(현장 투입 · 반출, 돈 없음) · 반품(지급에서 차감, 음수)
--   - 재고 = 입고 − 출고 − 반품 (material_stock 보기, 자재 · 프로젝트별)
--   - 현장에서 자재 입고를 한 줄로 기록하면 같은 프로젝트의 '지급' 결제가 자동으로 생기고 금액 · 증빙 · 상태가 함께 바뀜
--   - 증빙: 세금계산서 · 카드 · 현금영수증 (부가세 10% 포함) / 간이영수증 · 현금 (부가세 없음)
--   - 바로 낸 돈(현금 · 카드)은 '지급 완료'로, 나머지는 '예정'(지급일 비우면 차주 월요일 지급 대상)
--   - 마감재 DB 자재를 고르면 그 자재의 최근 단가 · 출처를 입고 단가로 갱신
--   - 지우지 않고 '취소'로 (연결된 지급도 취소)

create table if not exists public.material_receipts (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id),
  material_id  uuid references public.materials (id),
  kind         text not null default '입고' check (kind in ('입고', '출고', '반품')),
  name         text not null check (char_length(name) between 1 and 120),
  spec         text,
  unit         text,
  qty          numeric(12, 2) not null default 1 check (qty > 0),
  unit_price   bigint not null default 0 check (unit_price >= 0),
  supplier     text,
  client_id    uuid references public.clients (id),
  evidence     text not null default '세금계산서' check (evidence in ('세금계산서', '카드', '현금영수증', '간이영수증', '현금')),
  invoice_received boolean not null default false,
  paid         boolean not null default false,
  received_on  date not null default ((now() at time zone 'Asia/Seoul')::date),
  status       text not null default '입고' check (status in ('입고', '취소')),
  payment_id   uuid references public.payments (id),
  memo         text,
  created_by   uuid default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists material_receipts_project on public.material_receipts (project_id, received_on desc);
comment on table public.material_receipts is '자재 입출고 (프로젝트별) — 입고 · 반품은 지급 결제가 자동으로 생기고, 출고는 재고만 줄임';

alter table public.material_receipts enable row level security;
create policy material_receipts_read on public.material_receipts for select to authenticated using ((select public.is_active_member()));
create policy material_receipts_insert on public.material_receipts for insert to authenticated with check ((select public.is_active_member()));
create policy material_receipts_update on public.material_receipts for update to authenticated
  using ((select public.is_admin()) or created_by = (select auth.uid()))
  with check ((select public.is_admin()) or created_by = (select auth.uid()));

-- 금액: 공급가 = 수량 × 단가, 부가세 = 증빙이 세금계산서 · 카드 · 현금영수증이면 10%
create or replace function private.receipt_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_sign int := case when new.kind = '반품' then -1 else 1 end;
  v_supply bigint := v_sign * round(new.qty * new.unit_price);
  v_vat bigint := case when new.evidence in ('세금계산서', '카드', '현금영수증') then round(v_supply * 0.1) else 0 end;
  v_title text := left(concat_ws(' ', case when new.kind = '반품' then '[자재 반품]' else '[자재]' end, new.name, nullif(new.spec, ''), trim(to_char(new.qty, 'FM999999990.##')) || coalesce(new.unit, '')), 200);
  v_ct text := case new.evidence when '세금계산서' then '세금계산서' when '카드' then '카드' when '현금영수증' then '현금영수증' else '기타' end;
  v_inv text := case when new.evidence = '세금계산서' then (case when new.invoice_received then '발행' else '미발행' end) else '해당 없음' end;
  v_status text := case when new.status = '취소' or new.kind = '출고' then '취소' when new.paid then '완료' else '예정' end;
  v_pid uuid := new.payment_id;
begin
  -- 출고는 돈이 오가지 않음: 연결된 지급이 있으면(구분을 바꾼 경우) 취소만
  if new.kind = '출고' and v_pid is null then
    return null;
  end if;
  if v_pid is not null and exists (select 1 from public.payments p where p.id = v_pid) then
    update public.payments set
      project_id = new.project_id, client_id = new.client_id, category = '자재', title = v_title, payee = new.supplier,
      contract_type = v_ct, amount = v_supply + v_vat, vat = v_vat, tax_invoice = v_inv,
      tax_invoice_date = case when v_inv = '발행' then coalesce(tax_invoice_date, new.received_on) else null end,
      status = case when status = '완료' and v_status = '예정' then status else v_status end,
      paid_date = case when v_status = '완료' then coalesce(paid_date, new.received_on) when v_status = '취소' then paid_date else paid_date end,
      memo = concat_ws(' · ', '자재 입출고 연동', new.memo), updated_at = now()
    where id = v_pid;
  elsif new.status = '입고' then
    insert into public.payments (direction, project_id, client_id, category, title, payee, contract_type, amount, vat, tax_invoice, tax_invoice_date, status, requested_date, paid_date, memo, created_by)
    values ('지급', new.project_id, new.client_id, '자재', v_title, new.supplier, v_ct, v_supply + v_vat, v_vat, v_inv,
            case when v_inv = '발행' then new.received_on end, v_status, new.received_on,
            case when v_status = '완료' then new.received_on end, concat_ws(' · ', '자재 입출고 연동', new.memo), new.created_by)
    returning id into v_pid;
    update public.material_receipts set payment_id = v_pid where id = new.id;
  end if;
  -- 마감재 DB 단가 갱신 (최근 입고 기준)
  if new.material_id is not null and new.status = '입고' and new.kind = '입고' and new.unit_price > 0 then
    update public.materials set unit_price = new.unit_price, price_source = left(concat_ws(' ', '입고', new.supplier), 120),
      price_checked_on = new.received_on, updated_at = now()
    where id = new.material_id and (price_checked_on is null or price_checked_on <= new.received_on);
  end if;
  return null;
end $$;

create or replace trigger material_receipts_sync after insert or update of kind, project_id, material_id, name, spec, unit, qty, unit_price, supplier, client_id, evidence, invoice_received, paid, received_on, status, memo
  on public.material_receipts for each row execute function private.receipt_sync();

create or replace function private.receipt_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create or replace trigger material_receipts_touch before update on public.material_receipts for each row execute function private.receipt_touch();

grant select, insert, update on public.material_receipts to authenticated;

-- 재고: 입고 − 출고 − 반품 (마감재 DB 자재는 id 로, 나머지는 이름 · 규격으로 묶음)
create or replace view public.material_stock with (security_invoker = true) as
select
  r.project_id,
  r.material_id,
  min(r.name) as name,
  nullif(min(coalesce(r.spec, '')), '') as spec,
  min(r.unit) as unit,
  sum(case when r.kind = '입고' then r.qty else 0 end) as qty_in,
  sum(case when r.kind = '출고' then r.qty else 0 end) as qty_out,
  sum(case when r.kind = '반품' then r.qty else 0 end) as qty_return,
  sum(case r.kind when '입고' then r.qty else -r.qty end) as on_hand,
  max(r.received_on) as last_on
from public.material_receipts r
where r.status = '입고'
group by r.project_id, r.material_id, case when r.material_id is null then lower(r.name) || '|' || coalesce(r.spec, '') end;
grant select on public.material_stock to authenticated;
