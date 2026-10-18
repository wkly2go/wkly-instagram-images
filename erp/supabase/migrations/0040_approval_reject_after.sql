-- 0040 · 승인받은 보고서도 반려 (대표 지시 2026-10-18 "승인받은 보고서도 반려할 수 있도록")
-- 승인 → 반려: 승인자 · 관리자만, 상태 · 처리자 · 처리 시각 · 의견만 바뀜. 본인 요청은 관리자만.
-- 지출은 승인 때 결제 대장에 지급 예정이 등록되므로 제외 (지급 취소는 결제 대장에서).
create or replace function public.approvals_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_uid        uuid    := auth.uid();
  v_requester  boolean;
  v_decider    boolean;
  v_old        jsonb   := to_jsonb(old) - 'updated_at';
  v_new        jsonb   := to_jsonb(new) - 'updated_at';
begin
  if v_uid is null then
    if new.status in ('승인', '반려') and old.status = '대기' and new.decided_at is null then
      new.decided_at := now();
    end if;
    return new;
  end if;

  v_requester := old.requested_by = v_uid;
  v_decider   := public.is_admin() or (public.is_active_member() and old.approver_id = v_uid);

  -- 승인된 보고서를 나중에 반려
  if old.status = '승인' and new.status = '반려' then
    if old.kind = '지출' then
      raise exception '승인된 지출은 반려할 수 없습니다. 결제 대장에서 지급을 취소하세요.'
        using errcode = '42501';
    end if;
    if not v_decider then
      raise exception '이 보고서를 반려할 권한이 없습니다.'
        using errcode = '42501';
    end if;
    if v_requester and not public.is_admin() then
      raise exception '본인이 올린 보고서는 직접 반려할 수 없습니다.'
        using errcode = '42501';
    end if;
    if v_new - array['status', 'decided_by', 'decided_at', 'decision_comment']
       is distinct from
       v_old - array['status', 'decided_by', 'decided_at', 'decision_comment'] then
      raise exception '반려할 때는 상태와 처리 의견만 변경할 수 있습니다.'
        using errcode = '42501';
    end if;
    new.decided_by := v_uid;
    new.decided_at := now();
    return new;
  end if;

  -- 처리 완료된 요청
  if old.status <> '대기' then
    if new.status is distinct from old.status then
      raise exception '이미 처리된 요청(%)은 상태를 변경할 수 없습니다.', old.status
        using errcode = '42501';
    end if;
    if v_new - 'decision_comment' is distinct from v_old - 'decision_comment' then
      raise exception '이미 처리된 요청은 수정할 수 없습니다.'
        using errcode = '42501';
    end if;
    if new.decision_comment is distinct from old.decision_comment
       and old.decided_by is distinct from v_uid then
      raise exception '처리 의견은 해당 요청을 처리한 사람만 수정할 수 있습니다.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- 대기 중 → 대기 (내용 수정)
  if new.status = '대기' then
    if not v_requester then
      raise exception '대기 중인 요청은 요청자만 수정할 수 있습니다.'
        using errcode = '42501';
    end if;
    if v_new - array['title', 'content', 'payload', 'amount', 'approver_id', 'kind', 'target_id']
       is distinct from
       v_old - array['title', 'content', 'payload', 'amount', 'approver_id', 'kind', 'target_id'] then
      raise exception '요청자는 제목·내용·첨부 데이터·금액·승인자·종류·대상만 수정할 수 있습니다.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- 대기 → 취소
  if new.status = '취소' then
    if not v_requester then
      raise exception '요청 취소는 요청자만 할 수 있습니다.'
        using errcode = '42501';
    end if;
    if v_new - 'status' is distinct from v_old - 'status' then
      raise exception '취소할 때는 다른 항목을 함께 변경할 수 없습니다.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- 대기 → 승인 / 반려
  if not v_decider then
    raise exception '이 요청을 승인하거나 반려할 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if v_requester and not public.is_admin() then
    raise exception '본인이 올린 요청은 직접 승인하거나 반려할 수 없습니다.'
      using errcode = '42501';
  end if;
  if v_new - array['status', 'decided_by', 'decided_at', 'decision_comment']
     is distinct from
     v_old - array['status', 'decided_by', 'decided_at', 'decision_comment'] then
    raise exception '승인/반려할 때는 상태와 처리 의견만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  new.decided_by := v_uid;
  new.decided_at := now();
  return new;
end;
$function$;

create or replace function public.approvals_notify()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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

    select coalesce(nullif(btrim(p.name), ''), '누군가') into v_name
    from public.profiles p where p.id = new.requested_by;

    v_title := case when new.kind = '일일 보고' then '일일 보고 도착' else '승인 요청' end || ' · ' || new.title;

    if new.approver_id is not null then
      if new.approver_id is distinct from new.requested_by then
        perform public.notify(new.approver_id, v_kind, v_title, coalesce(v_name, '누군가'), '/approvals');
      end if;
    else
      for r in
        select p.id
        from public.profiles p
        where p.role = 'admin'
          and p.active
          and not p.is_agent
          and p.id is distinct from new.requested_by
      loop
        perform public.notify(r.id, v_kind, v_title, coalesce(v_name, '누군가'), '/approvals');
      end loop;
    end if;

  elsif old.status in ('대기', '승인')
        and new.status in ('승인', '반려')
        and new.status is distinct from old.status
        and new.requested_by is distinct from new.decided_by then
    select coalesce(nullif(btrim(p.name), ''), '누군가') into v_name
    from public.profiles p where p.id = new.decided_by;

    v_title := case
                 when new.status = '반려' and old.status = '승인' then '승인 후 반려됨'
                 when new.status = '반려' then '반려됨'
                 when new.kind = '일일 보고' then '확인됨'
                 else '승인됨'
               end || ' · ' || new.title;

    perform public.notify(
      new.requested_by, '승인', v_title,
      coalesce(nullif(btrim(new.decision_comment), ''), coalesce(v_name, '누군가') || '님이 처리했어요'),
      '/approvals?view=mine'
    );
  end if;

  return null;
end;
$function$;
