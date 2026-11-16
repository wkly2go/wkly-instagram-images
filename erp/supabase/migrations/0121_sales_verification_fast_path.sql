-- Unverified rows need no live source checks. Keep approval validation lazy so
-- sorting the whole registry does not execute unrelated source queries per row.
begin;
create or replace function private.sales_prospect_verified(p public.sales_prospects) returns boolean
language plpgsql stable set search_path='' as $$
begin
 if p.verification->>'status' is distinct from '확인' then return false; end if;
 if coalesce(p.verification->>'role','') not in ('발주처','협력사','소개·제휴') then return false; end if;
 if p.verification->>'signature' is distinct from private.sales_prospect_signature(p) then return false; end if;
 return not private.sales_prospect_blocked(p);
end $$;
-- Evaluate live exclusions in one set query rather than a function invocation
-- per candidate, retaining opt-out protection for the daily shortlist.
create or replace function private.sales_brief_actions() returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select p.id,p.name,p.organization,coalesce(p.reviewed_assessment,p.assessment) assessment,p.score,p.next_action,p.source,p.source_url,p.evidence,p.verification,private.sales_prospect_verified(p) verification_current
 from public.sales_prospects p where not p.blocked and coalesce(p.reviewed_assessment,p.assessment) not in ('제외','보류') and p.linked_sales_id is null
 and not exists(select 1 from public.brand_contacts b where b.opt_out and b.email<>'' and strpos(lower(p.contact),lower(b.email))>0)
 and not exists(select 1 from public.growth_items g where p.source in ('민간 영업 후보','나라장터 보관 공고') and g.id::text=p.source_key and (g.status in ('제외','취소') or g.document->>'qualification'='불충족'))
 order by private.sales_prospect_verified(p) desc,(coalesce(p.reviewed_assessment,p.assessment)='우선 검토') desc,p.score desc,p.created_at desc,p.id limit 5
 ) x
$$;
-- A stale application revision is a user-visible conflict, not a transient
-- serialization failure: PostgREST 14 retries SQLSTATE 40001 indefinitely.
-- https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
create or replace function public.sales_prospect_verify(p_id uuid,p_revision integer,p_role text,p_need text,p_scope text,p_evidence text,p_status text,p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.sales_prospects;
begin
 if not public.is_admin() then raise exception '관리자만 공용 영업망의 검증 결과를 저장할 수 있습니다.' using errcode='42501'; end if;
 if p_role is null or p_role not in ('미확인','발주처','협력사','소개·제휴') or p_status is null or p_status not in ('확인','추가 확인','보류','제외')
 or p_kind is null or p_kind not in ('회사','사람','영업 기회','미분류')
 or p_evidence is null or char_length(btrim(p_evidence)) not between 1 and 2000
 or p_need is null or char_length(p_need)>2000 or p_scope is null or char_length(p_scope)>2000 then raise exception '역할·검증 결과·근거를 올바르게 입력해 주세요.'; end if;
 if p_status='확인' and (p_role='미확인' or btrim(p_need)='' or btrim(p_scope)='') then raise exception '실제 수요·업무 범위·상대 역할을 확인해 주세요.'; end if;
 select * into p from public.sales_prospects where id=p_id for update;
 if p.id is null or p.revision is distinct from p_revision then raise exception '자료가 변경됐습니다. 다시 불러와 검증해 주세요.' using errcode='PT409'; end if;
 if p_status='확인' and private.sales_prospect_blocked(p) then raise exception '수신 거부·원본 제외 상태를 먼저 확인해 주세요.'; end if;
 update public.sales_prospects set
 verification=jsonb_build_object('role',p_role,'need',btrim(p_need),'scope',btrim(p_scope),'evidence',btrim(p_evidence),'status',p_status,'signature',private.sales_prospect_signature(p),'verified_by',auth.uid(),'verified_at',now()),
 reviewed_kind=p_kind,reviewed_assessment=case when private.sales_prospect_blocked(p) or p_status='제외' then '제외' when p_status='확인' then '우선 검토' when p_status='보류' then '보류' else '확인 필요' end,
 review_note=btrim(p_evidence),reviewed_by=auth.uid(),reviewed_at=now(),revision=revision+1 where id=p_id;
 return public.sales_prospect_get(p_id);
end $$;
commit;
