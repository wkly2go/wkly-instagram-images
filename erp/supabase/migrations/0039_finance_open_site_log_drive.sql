-- 0039 · 대표 지시 2026-10-18
-- (1) "재무 부분도 팀원들이 볼수 있게 전체 공개해": 프로젝트 계약 · 예산 · 공사 구분 예산은 구성원 모두 열람,
--     결제 원장은 계좌번호 · 예금주 · 은행을 비운 보기(payments_shared)로 열람. 원본 payments · 쓰기는 관리자만 (개인정보 보호)
-- (2) 현장 작업일지: 이벤트 · 특이사항 칸, 구글 드라이브 저장 정보(drive_file_id · drive_url · synced_at), 휴대폰 사진 저장소
--     드라이브 저장은 예약 작업 'ARTERIOR-현장 작업일지 드라이브 저장'이 updated_at > synced_at 인 일지를 Google 문서로 만들고 링크를 적음
alter policy project_finances_select on public.project_finances using ((select public.is_active_member()));
alter policy project_budget_lines_select on public.project_budget_lines using ((select public.is_active_member()));

create or replace view public.payments_shared as
  select id, direction, project_id, client_id, budget_line_id, approval_id, category, title, payee, contract_type, stage, amount, vat, tax_invoice, tax_invoice_date, status, is_estimate, requested_date, due_date, paid_date, advance_by, null::text as bank_name, null::text as account_no, null::text as account_holder, memo, created_by, created_at, updated_at
  from public.payments
  where public.is_active_member();
revoke all on public.payments_shared from anon;
grant select on public.payments_shared to authenticated;

alter table public.site_logs add column if not exists events text, add column if not exists drive_file_id text, add column if not exists drive_url text, add column if not exists synced_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;
-- 비공개 저장소: 구성원만 보기 (화면 · 드라이브 저장 작업은 서명된 링크 사용)
create policy site_photos_select on storage.objects for select to authenticated using (bucket_id = 'site-photos' and (select public.is_active_member()));
create policy site_photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'site-photos' and (select public.is_active_member()));
create policy site_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'site-photos' and (owner = (select auth.uid()) or (select public.is_admin())));
