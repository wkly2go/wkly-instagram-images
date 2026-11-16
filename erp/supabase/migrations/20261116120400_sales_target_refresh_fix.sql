-- 2026-11-16 초안 재준비 보완: ① 새로 확보된 받는 곳(대상)을 기획에 반영한 뒤 다시 준비 — 반영하지 않아 같은 차이로 계속 재준비되던 문제
-- ② 근거 자료가 하나도 연결되지 않은 기획은 다시 준비해도 같은 실패라 자동 재시도하지 않음(확인 필요로 남김)
-- ③ ①로 한도에 걸린 기획(피지오겔)의 재시도 횟수를 되돌림
begin;
create or replace function private.sales_target_refresh_tick() returns integer language plpgsql security definer set search_path='' as $$
declare c record;n integer:=0;
begin
 if not pg_try_advisory_xact_lock(903161202) then return 0;end if;
 for c in
  select s.id,p.id prep_id,p.target_retries,s.preparation_status st
  from public.sales_strategies s join private.sales_strategy_preparations p on p.strategy_id=s.id
  where s.status='승인 대기' and p.done and s.created_at>now()-interval '7 days'
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
  -- 새로 확보된 받는 곳을 기획에 반영한 뒤 초안을 다시 준비한다 (반영하지 않으면 같은 차이로 계속 다시 준비함).
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
update private.sales_strategy_preparations p set target_retries=0 from public.sales_strategies s
 where s.id=p.strategy_id and s.status='승인 대기' and s.preparation_error like '대상·근거가 계속 바뀌어%' and s.created_at>now()-interval '7 days';
update public.sales_strategies set preparation_status='완료',preparation_error='' where status='승인 대기' and preparation_error like '대상·근거가 계속 바뀌어%' and created_at>now()-interval '7 days';
commit;
