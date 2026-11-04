-- 결재 제목 · 알림: '결재 요청'이라는 말보다 어떤 결재인지가 먼저 (대표 지시 2026-11-04)
--   1) 제목 앞 꼬리표 '[AI 결재 요청]' · '[결재 요청]' · '[승인 요청]' 은 저장할 때 뗌 (AI 가 올린 것은 요청자가 AI 팀원으로 보임)
--   2) 알림 제목: '<내용> · <종류>' (예: 홈페이지 게시 · 서울 팝업 11월 · 메일 발송) — '승인 요청 · …' 앞머리 없앰
create or replace function private.approval_clean_title() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.title := btrim(regexp_replace(new.title, '^\s*\[(AI\s*)?(결재|승인)\s*요청\]\s*', '', 'i'));
  if new.title = '' then new.title := coalesce(new.kind, '결재'); end if;
  return new;
end $$;
drop trigger if exists approvals_clean_title on public.approvals;
create trigger approvals_clean_title before insert or update of title on public.approvals
  for each row execute function private.approval_clean_title();

update public.approvals set title = btrim(regexp_replace(title, '^\s*\[(AI\s*)?(결재|승인)\s*요청\]\s*', '', 'i'))
where title ~* '^\s*\[(AI\s*)?(결재|승인)\s*요청\]';

create or replace function public.approvals_notify() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare
  v_kind   text := case when new.kind = '일일 보고' then '일일 보고' else '승인' end;
  v_title  text;
  v_name   text;
  r        record;
begin
  if tg_op = 'INSERT' then
    if new.status <> '대기' then
      return null;
    end if;
    select coalesce(nullif(btrim(p.name), ''), '누군가') into v_name from public.profiles p where p.id = new.requested_by;
    -- 내용이 먼저, 종류는 뒤에
    v_title := new.title || ' · ' || coalesce(nullif(new.kind, ''), '결재');
    if new.approver_id is not null then
      if new.approver_id is distinct from new.requested_by then
        perform public.notify(new.approver_id, v_kind, v_title, coalesce(v_name, '누군가') || ' 요청', '/approvals');
      end if;
    else
      for r in
        select p.id from public.profiles p
        where p.role = 'admin' and p.active and not p.is_agent and p.id is distinct from new.requested_by
      loop
        perform public.notify(r.id, v_kind, v_title, coalesce(v_name, '누군가') || ' 요청', '/approvals');
      end loop;
    end if;
  elsif old.status in ('대기', '승인')
        and new.status in ('승인', '반려')
        and new.status is distinct from old.status
        and new.requested_by is distinct from new.decided_by then
    select coalesce(nullif(btrim(p.name), ''), '누군가') into v_name from public.profiles p where p.id = new.decided_by;
    v_title := new.title || ' · ' || case
                 when new.status = '반려' and old.status = '승인' then '승인 후 반려됨'
                 when new.status = '반려' then '반려됨'
                 when new.kind = '일일 보고' then '확인됨'
                 else '승인됨'
               end;
    perform public.notify(
      new.requested_by, '승인', v_title,
      coalesce(nullif(btrim(new.decision_comment), ''), coalesce(v_name, '누군가') || '님이 처리했어요'),
      '/approvals?view=mine'
    );
  end if;
  return null;
end;
$function$;
