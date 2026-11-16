-- 2026-11-16 '개발 먼저 끝내고': 기획 뒤에 받는 곳이 새로 확보되면 그대로 멈춰 있던 문제 수정.
-- 예) 피지오겔: 기획 초안을 쓴 뒤 시스템이 공식 공개 주소를 찾아 대상이 바뀜 → 실행 묶음에 '근거 또는 대상 변경 · 자동 재기획 필요'가
--     붙었지만, 자동 재준비는 대상이 그대로일 때만 돌아서 10번 다시 만들어져도 계속 막혀 있었음.
-- 이제 승인 대기 중인 기획의 대상·근거가 바뀌면 바뀐 대상으로 초안을 자동으로 다시 준비한다 (기획당 최대 2회 · 10분마다 최대 2건).
-- 이미 대표가 승인한 기획은 건드리지 않는다(승인 취소 방지). 한도를 넘으면 '확인 필요'로 남긴다.
begin;
alter table private.sales_strategy_preparations add column if not exists target_retries integer not null default 0;

create or replace function private.sales_target_refresh_tick() returns integer language plpgsql security definer set search_path='' as $$
declare c record;n integer:=0;
begin
 if not pg_try_advisory_xact_lock(903161202) then return 0;end if;
 for c in
  select s.id,p.id prep_id,p.target_retries
  from public.sales_strategies s join private.sales_strategy_preparations p on p.strategy_id=s.id
  where s.status='승인 대기' and s.preparation_status='완료' and p.done and s.created_at>now()-interval '7 days'
   and (s.targets is distinct from private.sales_strategy_targets(s.id)
    or exists(select 1 from jsonb_array_elements(coalesce(s.sources,'[]')) old left join public.sales_prospects x on x.id::text=old->>'id'
              where s.plan->'evidence_ids' ? (old->>'id') and (x.id is null or private.sales_prospect_signature(x) is distinct from old->>'signature')))
  order by s.created_at desc limit 5
 loop
  if c.target_retries>=2 then
   update public.sales_strategies set preparation_status='확인 필요',preparation_error='대상·근거가 계속 바뀌어 자동 재준비 2회 한도 도달 · 기획 범위 확인 필요',revision=revision+1
    where id=c.id and preparation_status='완료';
   continue;
  end if;
  update private.sales_strategy_preparations set target_retries=target_retries+1,evidence_retries=0 where id=c.prep_id;
  if private.sales_contact_restart(c.prep_id) then
   update public.sales_strategies set preparation_error='대상·연락처가 새로 확보되어 자동 재준비' where id=c.id;
   n:=n+1;
  end if;
  exit when n>=2;
 end loop;
 return n;
end $$;
revoke all on function private.sales_target_refresh_tick() from public,anon,authenticated,service_role;

insert into private.sales_ops_steps(step,label,call,every_min,grace_min) values('target_refresh','바뀐 대상으로 초안 재준비','private.sales_target_refresh_tick()',10,10)
 on conflict(step) do nothing;
commit;
