-- 보고서 결재 '기타' 세분화: 홍보 게시 · 회의 결정 · 제안 · 구매 · 계약 을 따로 둠
-- AI 팀원이 '기타'로 올려도 제목을 보고 자동으로 나눔

alter table public.approvals drop constraint if exists approvals_kind_check;
alter table public.approvals add constraint approvals_kind_check check (kind = any (array[
  '업무 보고', '일일 보고', '회의록', '메일 발송', '홍보 게시', '회의 결정', '제안', '구매 · 계약',
  '프로젝트', '거래처', '할 일', '지출', '기타'
])) not valid;

-- 결재 경로(종류별 승인자)도 같은 종류를 고를 수 있게 (예전 목록엔 회의록도 빠져 있었음)
alter table public.approval_routes drop constraint if exists approval_routes_kind_check;
alter table public.approval_routes add constraint approval_routes_kind_check check (kind = any (array[
  '업무 보고', '일일 보고', '회의록', '메일 발송', '홍보 게시', '회의 결정', '제안', '구매 · 계약',
  '프로젝트', '거래처', '할 일', '지출', '기타'
]));

create or replace function private.approval_kind_of(p_title text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_title ~ '(홍보|블로그|게시|포스팅|인스타|SNS|카페)' then '홍보 게시'
    when p_title ~ '회의 ?결정' then '회의 결정'
    when p_title ~ '(제안|개선안|건의)' then '제안'
    when p_title ~ '(구매|계약|견적|발주)' then '구매 · 계약'
    else '기타'
  end
$$;

create or replace function private.approvals_classify()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind = '기타' then
    new.kind := private.approval_kind_of(coalesce(new.title, ''));
  end if;
  return new;
end
$$;

-- 이름 순으로 실행되므로 결재 경로(approvals_apply_route)보다 먼저 돌도록 0 으로 시작
create or replace trigger approvals_0_classify before insert on public.approvals
  for each row execute function private.approvals_classify();

update public.approvals set kind = private.approval_kind_of(title) where kind = '기타';
