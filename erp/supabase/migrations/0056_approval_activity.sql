-- 결재 · 보고 주고받기와 진행 기록 (대표 지시 2026-10-23
--  "승인 보고가 결제에 오면 내용에 대한 답을 해줄 수 있게, 모든 결제와 보고에는 인터랙션이 들어가서 상호보완하고 결과와 과정을 트래킹")
--  - approval_activity: 한 결재의 모든 기록 (요청 · 댓글 · 진행 · 결과 · 수정 · 승인 · 반려 · 취소 · AI 답변)
--  - 사람은 댓글 · 진행 · 결과만 직접 남김. 나머지는 결재가 바뀔 때 저절로 기록
--  - 새 기록 → 요청자 · 승인자(없으면 관리자) · 앞서 글을 남긴 사람에게 알림 (제목에 금액 없음)
--  - AI 팀원이 올린 결재에 사람이 댓글을 달면 그 AI 에게 바로 전달 → AI 가 처리한 답이 같은 기록에 'AI 답변'으로 붙음

create table if not exists public.approval_activity (
  id           bigint generated always as identity primary key,
  approval_id  uuid not null references public.approvals (id) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null default auth.uid(),
  kind         text not null check (kind in ('요청', '댓글', '진행', '결과', '수정', '승인', '반려', '취소', '다시 대기', 'AI 답변')),
  body         text check (body is null or char_length(body) <= 4000),
  ref_id       uuid,                         -- AI 에게 넘긴 지시 (agent_instructions.id)
  created_at   timestamptz not null default now()
);
create index if not exists approval_activity_approval_idx on public.approval_activity (approval_id, created_at);
create index if not exists approval_activity_ref_idx on public.approval_activity (ref_id) where ref_id is not null;
alter table public.approval_activity enable row level security;

-- 볼 수 있는 결재의 기록만 (결재 자체의 권한을 그대로 따름)
create policy approval_activity_select on public.approval_activity for select to authenticated
  using (exists (select 1 from public.approvals a where a.id = approval_id));
create policy approval_activity_insert on public.approval_activity for insert to authenticated
  with check (
    (select public.is_active_member())
    and user_id = (select auth.uid())
    and kind in ('댓글', '진행', '결과')
    and ref_id is null
    and char_length(btrim(coalesce(body, ''))) >= 1
    and exists (select 1 from public.approvals a where a.id = approval_id)
  );
create policy approval_activity_delete on public.approval_activity for delete to authenticated
  using ((user_id = (select auth.uid()) and kind in ('댓글', '진행', '결과')) or (select public.is_admin()));
revoke update on public.approval_activity from anon, authenticated;

-- 결재가 생기거나 바뀌면 저절로 기록
create or replace function private.approval_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.approval_activity (approval_id, user_id, kind, body) values (new.id, new.requested_by, '요청', null);
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.approval_activity (approval_id, user_id, kind, body)
    values (
      new.id,
      coalesce(new.decided_by, auth.uid()),
      case new.status when '승인' then '승인' when '반려' then '반려' when '취소' then '취소' else '다시 대기' end,
      nullif(btrim(coalesce(new.decision_comment, '')), '')
    );
  elsif new.title is distinct from old.title or new.content is distinct from old.content or new.amount is distinct from old.amount then
    insert into public.approval_activity (approval_id, user_id, kind, body)
    values (new.id, coalesce(auth.uid(), new.requested_by), '수정', case when new.title is distinct from old.title then '제목: ' || new.title else '내용을 고쳤습니다.' end);
  end if;
  return null;
end $$;
create or replace trigger approvals_log after insert or update on public.approvals
  for each row execute function private.approval_log();

-- 새 기록 알림 + AI 에게 전달
create or replace function private.approval_activity_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a        public.approvals%rowtype;
  v_name   text;
  v_label  text;
  v_link   text;
  v_agent  boolean;
  v_ins    uuid;
  r        record;
begin
  if new.kind not in ('댓글', '진행', '결과', 'AI 답변') then return null; end if;
  select * into a from public.approvals where id = new.approval_id;
  if not found then return null; end if;
  select coalesce(nullif(btrim(p.name), ''), '누군가') into v_name from public.profiles p where p.id = new.user_id;
  v_label := case new.kind when '댓글' then '답글' when '진행' then '진행 상황' when '결과' then '결과 보고' else 'AI 답변' end;
  v_link := '/approvals?view=all&id=' || a.id;

  -- 알림: 요청자 · 승인자(없으면 관리자) · 앞서 글을 남긴 사람 (쓴 사람 제외)
  for r in
    select distinct u from (
      select a.requested_by as u
      union select a.approver_id
      union select p.id from public.profiles p where a.approver_id is null and p.role = 'admin' and p.active and not p.is_agent
      union select x.user_id from public.approval_activity x where x.approval_id = a.id and x.kind in ('댓글', '진행', '결과')
    ) s where u is not null and u is distinct from new.user_id
  loop
    perform public.notify(r.u, '승인', coalesce(v_name, '누군가') || '님이 ' || v_label || '을 남겼어요 · ' || left(a.title, 60), left(new.body, 160), v_link);
  end loop;

  -- AI 팀원이 올린 결재에 사람이 댓글 → 그 AI 에게 바로 지시로 전달 (처리 결과는 아래 트리거가 'AI 답변'으로 붙임)
  if new.kind = '댓글' then
    select p.is_agent into v_agent from public.profiles p where p.id = a.requested_by;
    if coalesce(v_agent, false) and not exists (select 1 from public.profiles p where p.id = new.user_id and p.is_agent) then
      insert into public.agent_instructions (agent_id, instruction, created_by)
      values (
        a.requested_by,
        left(format(E'[결재 답글] 내가 올린 결재 "%s"(%s · 상태 %s)에 %s님이 답을 남겼습니다. 내용을 반영해 필요한 일을 처리하고, 무엇을 했는지 짧게 답해 주세요.\n\n답글: %s', a.title, a.kind, a.status, coalesce(v_name, '팀원'), new.body), 2000),
        new.user_id
      )
      returning id into v_ins;
      update public.approval_activity set ref_id = v_ins where id = new.id;
    end if;
  end if;
  return null;
exception when others then
  raise warning 'approval_activity_after: %', sqlerrm;
  return null;
end $$;
create or replace trigger approval_activity_after after insert on public.approval_activity
  for each row execute function private.approval_activity_after();

-- AI 가 그 지시를 끝내면 답을 결재 기록에 붙임
create or replace function private.approval_agent_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_approval uuid;
begin
  if new.response is null or new.response is not distinct from old.response then return null; end if;
  select x.approval_id into v_approval from public.approval_activity x where x.ref_id = new.id limit 1;
  if v_approval is null then return null; end if;
  insert into public.approval_activity (approval_id, user_id, kind, body, ref_id) values (v_approval, new.agent_id, 'AI 답변', left(new.response, 4000), new.id);
  return null;
exception when others then
  raise warning 'approval_agent_reply: %', sqlerrm;
  return null;
end $$;
create or replace trigger agent_instructions_approval_reply after update on public.agent_instructions
  for each row execute function private.approval_agent_reply();

-- 지금까지의 결재도 '요청' · 처리 기록을 채워 둠 (과정 보기용)
insert into public.approval_activity (approval_id, user_id, kind, body, created_at)
select a.id, a.requested_by, '요청', null, a.created_at from public.approvals a
where not exists (select 1 from public.approval_activity x where x.approval_id = a.id);
insert into public.approval_activity (approval_id, user_id, kind, body, created_at)
select a.id, a.decided_by, a.status, nullif(btrim(coalesce(a.decision_comment, '')), ''), coalesce(a.decided_at, a.updated_at)
from public.approvals a
where a.status in ('승인', '반려', '취소') and not exists (select 1 from public.approval_activity x where x.approval_id = a.id and x.kind = a.status);

alter publication supabase_realtime add table public.approval_activity;
