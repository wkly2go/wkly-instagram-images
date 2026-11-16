-- 2026-11-16 '개발 먼저 끝내고': 초안 준비가 AI 응답 형식 문제로 '확인 필요'가 되면 사람이 손대기 전까지 멈춰 있었다.
-- 이제 승인 대기 기획의 초안 준비가 실패하면 10분 뒤 자동으로 한 번 더 준비한다 (기획당 재시도 2회 한도 · target_retries 와 같은 칸).
-- 비용 한도(주간 AI 한도) · 서버 연결 실패 처리는 기존 준비 경로 그대로다.
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
    or (s.preparation_status='확인 필요' and p.target_retries<2 and p.started_at<now()-interval '10 minutes'
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
  if private.sales_contact_restart(c.prep_id) then
   update public.sales_strategies set preparation_error=case when c.st='완료' then '대상·연락처가 새로 확보되어 자동 재준비' else '초안 준비 실패 · 자동 재시도' end where id=c.id;
   n:=n+1;
  end if;
  exit when n>=2;
 end loop;
 return n;
end $$;
revoke all on function private.sales_target_refresh_tick() from public,anon,authenticated,service_role;
update private.sales_ops_steps set label='초안 재준비 (대상 변경 · 실패 재시도)' where step='target_refresh';
commit;
