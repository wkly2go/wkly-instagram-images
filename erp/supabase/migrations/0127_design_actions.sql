-- 0127 설계·견적 동작: 검토 카드 결정(단가 가져오기 · 견적 확정 · 발주 발송 준비)과 작업 요청(견적 계산 · 발주서 만들기)
-- 부른 사람 권한 그대로 동작한다(security invoker). 실행 단가 · 발주는 관리자만 닿는다(0125 정책).
-- 밖으로 보내는 기능은 없다. '발주 발송 준비'를 승인해도 상태만 '발송'으로 바뀐다(메일은 사람이 보낸다).
begin;

create function public.design_decide(p_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql set search_path = '' as $$
declare a design.approvals; ex design.extractions; r jsonb; v_id uuid; v_trades text[]; new_trades text[];
begin
  if not (select public.is_admin()) then raise exception '검토 카드는 관리자만 결정할 수 있습니다.' using errcode = '42501'; end if;
  update design.approvals set status = case when p_approve then 'approved' else 'rejected' end::design.approval_status,
         decided_by = auth.uid(), decided_at = now(), comment = nullif(btrim(coalesce(p_comment, '')), '')
   where id = p_id and status = 'pending' returning * into a;
  if not found then raise exception '이미 처리된 카드입니다.'; end if;

  if a.kind in ('price_extract', 'cost_extract') then
    update design.extractions set status = a.status, decided_by = auth.uid(), decided_at = now()
     where id = a.ref_id returning * into ex;
    if not found or not p_approve then return; end if;
    if ex.target_table = 'unit_costs' then
      select coalesce(array_agg(distinct x->>'trade'), '{}') into new_trades
        from jsonb_array_elements(ex.payload->'rows') x where (x->>'ok')::boolean;
      select id, trades into v_id, v_trades from design.vendors where name = ex.payload->>'vendor' limit 1;
      if v_id is null then
        insert into design.vendors (name, trades) values (ex.payload->>'vendor', new_trades) returning id into v_id;
      else
        update design.vendors set trades = (select array_agg(distinct t) from unnest(v_trades || new_trades) t) where id = v_id;
      end if;
      for r in select x from jsonb_array_elements(ex.payload->'rows') x where (x->>'ok')::boolean loop
        insert into design.unit_costs (trade_code, item, spec, unit, cost_price, vendor_id, effective_date, approved, source_doc)
        select r->>'trade', r->>'item', coalesce(r->>'spec', ''), r->>'unit', (r->>'price')::numeric, v_id, current_date, true, ex.payload->>'file'
        where not exists (select 1 from design.unit_costs p where p.trade_code = r->>'trade' and p.item = r->>'item'
          and p.spec = coalesce(r->>'spec', '') and p.unit = r->>'unit' and p.cost_price = (r->>'price')::numeric
          and p.vendor_id = v_id and p.approved);
      end loop;
    else
      for r in select x from jsonb_array_elements(ex.payload->'rows') x where (x->>'ok')::boolean loop
        insert into design.unit_prices (trade_code, item, spec, unit, variant, sell_price, effective_date, approved, approved_by, source_doc)
        select r->>'trade', r->>'item', coalesce(r->>'spec', ''), r->>'unit', 'standard', (r->>'price')::numeric, current_date, true, auth.uid(), ex.payload->>'file'
        where not exists (select 1 from design.unit_prices p where p.trade_code = r->>'trade' and p.item = r->>'item'
          and p.spec = coalesce(r->>'spec', '') and p.unit = r->>'unit' and p.variant = 'standard'
          and p.sell_price = (r->>'price')::numeric and p.approved);
      end loop;
    end if;
  elsif a.kind = 'po_send' and p_approve then
    update design.purchase_orders set status = 'sent', issue_date = coalesce(issue_date, current_date)
     where id = a.ref_id and status = 'draft';
  end if;
end $$;
revoke all on function public.design_decide(uuid, boolean, text) from public, anon;
grant execute on function public.design_decide(uuid, boolean, text) to authenticated;

-- 작업 요청: 같은 프로젝트에 같은 작업이 대기 · 진행 중이면 다시 넣지 않는다.
create function public.design_request_job(p_project uuid, p_kind text)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid; v_payload jsonb; v_est uuid;
begin
  if p_kind not in ('estimate.build', 'po.build') then raise exception '알 수 없는 작업입니다.'; end if;
  if p_kind = 'po.build' and not (select public.is_admin()) then
    raise exception '발주서는 관리자만 만들 수 있습니다.' using errcode = '42501';
  end if;
  if not exists (select 1 from design.projects where id = p_project) then raise exception '설계를 시작하지 않은 프로젝트입니다.'; end if;
  select id into v_id from design.jobs where project_id = p_project and kind = p_kind and status in ('queued', 'running') limit 1;
  if v_id is not null then return v_id; end if;
  v_payload := jsonb_build_object('project_id', p_project);
  if p_kind = 'po.build' then
    select e.id into v_est from design.approvals a join design.estimates e on e.id = a.ref_id
     where a.ref_table = 'estimates' and a.status = 'approved' and e.project_id = p_project
     order by e.revision desc limit 1;
    if v_est is null then raise exception '확정(승인)된 견적이 없습니다. 먼저 견적을 확정하세요.'; end if;
    v_payload := v_payload || jsonb_build_object('estimate_id', v_est);
  end if;
  insert into design.jobs (kind, project_id, payload, requested_by) values (p_kind, p_project, v_payload, auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.design_request_job(uuid, text) from public, anon;
grant execute on function public.design_request_job(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
