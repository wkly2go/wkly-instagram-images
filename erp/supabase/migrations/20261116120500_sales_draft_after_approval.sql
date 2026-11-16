-- 2026-11-16 대표 지시 '내가 승인을 하면 제안 기획과 이메일 초안을 작성하는 방식으로': 순서를 바꾼다.
--   예전: 기획안 생성 → (승인 전) 제안서·메일 초안 자동 작성 → 기획 승인 → 묶음 승인 → 발송
--   이제: 기획안(아이디어) 생성 → 대표 승인 → 수행 계획·디자인 메일 초안 자동 작성 → 실행 묶음(받는 곳·문안·일정) 대표 승인 → 발송
-- 효과: 승인한 기획에만 AI 작성 비용이 들고, 승인 뒤 작성된 최신 초안을 보고 발송을 결정한다.
-- 승인 전에는 받는 곳(대상)만 정리해 둔다. 이미 승인 전에 초안이 만들어진 승인 대기 기획은 새 방식으로 되돌린다(승인하면 새 양식으로 다시 작성).
begin;
-- ① 승인 전 자동 작성 중지: 대상 정리만
create or replace function private.sales_strategy_prepare_before_decision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.sales_strategies set targets=private.sales_strategy_targets(new.id) where id=new.id;
 return new;
end $$;
revoke all on function private.sales_strategy_prepare_before_decision() from public,anon,authenticated;

-- ② 승인되면 실행 묶음 흐름을 켠다 (작성은 sales_strategy_decide 가 승인 직후 시작 · 완료되면 실행 묶음 자동 생성)
create or replace function private.sales_strategy_after_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.sales_strategies set preparation_before_approval=true,targets=private.sales_strategy_targets(new.id) where id=new.id;
 return new;
end $$;
revoke all on function private.sales_strategy_after_approval() from public,anon,authenticated;
drop trigger if exists sales_strategy_after_approval on public.sales_strategies;
create trigger sales_strategy_after_approval after update of status on public.sales_strategies for each row
 when(old.status='승인 대기' and new.status='승인' and not new.preparation_before_approval) execute function private.sales_strategy_after_approval();

-- ③ 초안 재준비 · 실패 재시도는 이제 승인된 기획에서 돈다 (보내기 승인이 난 묶음이 있는 기획은 건드리지 않음)
create or replace function private.sales_target_refresh_tick() returns integer language plpgsql security definer set search_path='' as $$
declare c record;n integer:=0;
begin
 if not pg_try_advisory_xact_lock(903161202) then return 0;end if;
 for c in
  select s.id,p.id prep_id,p.target_retries,s.preparation_status st
  from public.sales_strategies s join private.sales_strategy_preparations p on p.strategy_id=s.id
  where s.status='승인' and s.preparation_before_approval and p.done and s.created_at>now()-interval '7 days'
   and not exists(select 1 from public.sales_execution_packages x where x.strategy_id=s.id and x.status='승인')
   and ((s.preparation_status='완료' and (s.targets is distinct from private.sales_strategy_targets(s.id)
     or exists(select 1 from jsonb_array_elements(coalesce(s.sources,'[]')) old left join public.sales_prospects x on x.id::text=old->>'id'
               where s.plan->'evidence_ids' ? (old->>'id') and (x.id is null or private.sales_prospect_signature(x) is distinct from old->>'signature'))))
    or (s.preparation_status='확인 필요' and p.target_retries<2 and p.started_at<now()-interval '10 minutes' and jsonb_array_length(coalesce(s.plan->'evidence_ids','[]'))>0
        and coalesce(s.preparation_error,'') !~ '(한도|범위 확인|범위 결정)'))
  order by s.created_at desc limit 5
 loop
  if c.target_retries>=2 then
   if c.st='완료' then
    update public.sales_strategies set preparation_status='확인 필요',preparation_error='대상·근거가 계속 바뀌어 자동 재준비 2회 한도 도달 · 기획 범위 확인 필요',revision=revision+1 where id=c.id;
   end if;
   continue;
  end if;
  update private.sales_strategy_preparations set target_retries=target_retries+1,evidence_retries=0 where id=c.prep_id;
  if c.st='완료' then update public.sales_strategies set targets=private.sales_strategy_targets(c.id) where id=c.id;end if;
  if private.sales_contact_restart(c.prep_id) then
   update public.sales_strategies set preparation_error=case when c.st='완료' then '대상·연락처가 새로 확보되어 자동 재준비' else '초안 준비 실패 · 자동 재시도' end where id=c.id;
   n:=n+1;
  end if;
  exit when n>=2;
 end loop;
 return n;
end $$;
revoke all on function private.sales_target_refresh_tick() from public,anon,authenticated,service_role;

-- ④ 승인 전에 이미 초안이 만들어진 승인 대기 기획을 새 방식으로 되돌림 (예전 양식 초안 · 묶음은 기록으로 남기고 보내지 않음)
do $$
declare s record;pk record;
begin
 for s in select id from public.sales_strategies where status='승인 대기' and preparation_before_approval for update loop
  for pk in update public.sales_execution_packages set status='재검토',approved_at=null,approved_by=null,checked_at=now() where strategy_id=s.id and status not in ('재검토','보류') returning id loop
   insert into public.sales_execution_events(package_id,kind,note) values(pk.id,'재검토','작성 순서 변경 · 기획 승인 후 수행 계획·디자인 메일로 다시 작성');
  end loop;
  update private.sales_strategy_preparations set done=true where strategy_id=s.id and not done;
  delete from private.sales_strategy_preparations where strategy_id=s.id;
  update public.sales_strategies set preparation_before_approval=false,preparation_status='미요청',preparation_error='',targets=private.sales_strategy_targets(s.id),revision=revision+1 where id=s.id;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
