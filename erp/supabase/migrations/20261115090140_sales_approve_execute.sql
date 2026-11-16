-- 2026-11-16 대표 지시: 승인 한 번으로 기획부터 실행까지. 기획 카드에 실행 묶음(수신자 · 문안 · 첨부 · 일정)을 함께 보여 주고,
-- 대표가 그 화면에서 승인하면 기획 승인과 실행 묶음 승인을 한 번에 처리한다. 화면에 보인 묶음과 승인 직후 다시 만든 묶음의
-- 내용이 한 글자라도 다르면 실행 묶음은 승인하지 않고 기획 승인만 남긴다(다시 확인 필요).
begin;
create function public.sales_strategy_approve_execute(p_id uuid,p_revision integer,p_package uuid,p_version integer,p_fingerprint text) returns text language plpgsql security definer set search_path='' as $$
declare shown public.sales_execution_packages; fresh public.sales_execution_packages; m jsonb; new_id uuid;
begin
 if not public.is_admin() then raise exception '관리자만 승인할 수 있습니다.' using errcode='42501'; end if;
 perform 1 from public.sales_strategies where id=p_id for update;
 select * into shown from public.sales_execution_packages where id=p_package and strategy_id=p_id for update;
 m:=private.sales_execution_material(p_id);
 if shown.id is null or shown.version is distinct from p_version or shown.fingerprint is distinct from p_fingerprint or m is null or shown.fingerprint is distinct from m->>'fingerprint'
  or exists(select 1 from public.sales_execution_packages where strategy_id=p_id and version>shown.version) then raise exception '실행안이 변경되었습니다. 최신 내용을 확인해 주세요.' using errcode='PT409'; end if;
 if shown.status<>'승인 대기' or jsonb_array_length(m->'blockers')>0 then raise exception '실행 준비가 끝나지 않았습니다. 기획만 승인하거나 준비가 끝난 뒤 다시 시도해 주세요.' using errcode='PT409'; end if;
 perform public.sales_strategy_decide(p_id,p_revision,'승인','');
 -- Approving the plan changes its revision, so the package is rebuilt; everything else must be identical to what was shown.
 new_id:=private.sales_execution_refresh(p_id);
 select * into fresh from public.sales_execution_packages where id=new_id;
 if fresh.id is null or fresh.status<>'승인 대기' or jsonb_array_length(fresh.blockers)>0 or (fresh.payload-'strategy_revision') is distinct from (shown.payload-'strategy_revision') then return '기획 승인 · 실행안은 내용이 바뀌어 다시 확인 필요'; end if;
 perform public.sales_execution_decide(fresh.id,fresh.version,fresh.fingerprint,'승인');
 return '기획과 실행안 승인 · 예정 시각에 실행';
end $$;
revoke all on function public.sales_strategy_approve_execute(uuid,integer,uuid,integer,text) from public,anon;
grant execute on function public.sales_strategy_approve_execute(uuid,integer,uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
