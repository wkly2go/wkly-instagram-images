-- 서비스 청구서 · 영수증 PDF 를 수신방/청구서/<YYYY-MM>/<회사> 에 저장 (대표 지시 2026-11-12 · gmail 함수)
alter table public.mail_files drop constraint if exists mail_files_kind_check;
alter table public.mail_files add constraint mail_files_kind_check
  check (kind = any (array['첨부', '세금계산서', '청구서', '계약서', '견적서', '도면', '일정표', '사진']));
-- 이미 건너뛴 지난 청구서 메일(10월~)을 다시 처리하게 함
update public.mail_index set files_done_at = null
where has_attachment and sent_at >= '2026-10-01'
  and not (labels @> array['SENT']) and from_addr !~* '@thewklyn\.com$' and from_addr !~* '^(mailer-daemon|postmaster)@'
  and subject ~* '(invoice|receipt|billing|statement|인보이스|청구서|영수증|결제\s?내역|이용\s?요금)'
  and not exists (select 1 from public.mail_files f where f.mail_id = mail_index.id);
