-- 참가 자격 판정: 공식 API 가 알려 주는 업종 제한 · 참가 가능 지역을 회사가 가진 자격과 견주어
-- 공고마다 '참여 가능 / 참여 불가 / 자격 확인 필요' 를 적는다. 판정은 규칙으로만 하며 AI 를 쓰지 않는다.
begin;
create table public.sales_bid_qualifications(
 kind text not null check(kind in ('업종','지역')),name text not null check(char_length(name) between 2 and 80),
 status text not null default '확인 필요' check(status in ('보유','미보유','확인 필요')),seen_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(kind,name)
);
alter table public.sales_bid_qualifications enable row level security;
create policy sales_bid_qualifications_admin on public.sales_bid_qualifications for select to authenticated using((select public.is_admin()));
revoke all on public.sales_bid_qualifications from anon,authenticated;
grant select on public.sales_bid_qualifications to authenticated;
insert into public.sales_bid_qualifications(kind,name) select '지역',unnest(array['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도']);

-- A licence seen for the first time is recorded once. Construction licences are not held (대표 지시 2026-11-15),
-- the registered industrial-design firm qualification is; everything else waits for the administrator.
create function private.sales_bid_verdict(p_terms jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare licenses text[]; regions text[]; lic_state text:='없음'; region_state text:='없음'; notes text[]:='{}'; home text[]; pending text[]; missing text[];
begin
 if p_terms is null or jsonb_typeof(p_terms) is distinct from 'object' then return null; end if;
 if coalesce((p_terms->>'industry_limited')::boolean,false) then
  if jsonb_typeof(p_terms->'licenses') is distinct from 'array' or jsonb_array_length(p_terms->'licenses')=0 then lic_state:='확인';notes:=notes||'업종 제한 내용 조회 전'::text;
  else
   select array_agg(distinct left(btrim(v),80)) into licenses from jsonb_array_elements_text(p_terms->'licenses') v where char_length(btrim(v)) between 2 and 80;
   insert into public.sales_bid_qualifications(kind,name,status) select '업종',n,case when n ~ '(건설|공사업|전기공사|정보통신공사|소방시설|실내건축)' then '미보유' when n ~ '산업디자인' then '보유' else '확인 필요' end from unnest(licenses) n on conflict do nothing;
   select array_agg(name order by name) filter(where status='확인 필요'),array_agg(name order by name) filter(where status='미보유') into pending,missing from public.sales_bid_qualifications where kind='업종' and name=any(licenses);
   if pending is null and missing is null then lic_state:='가능';
   elsif pending is null and coalesce(array_length(missing,1),0)=array_length(licenses,1) then lic_state:='불가';notes:=notes||('미보유 업종: '||array_to_string(missing,', '));
   else lic_state:='확인';notes:=notes||('등록 여부 확인이 필요한 업종: '||array_to_string(coalesce(pending,'{}')||coalesce(missing,'{}'),', '));
   end if;
  end if;
 end if;
 if coalesce((p_terms->>'region_limited')::boolean,false) then
  if jsonb_typeof(p_terms->'regions') is distinct from 'array' or jsonb_array_length(p_terms->'regions')=0 then region_state:='확인';notes:=notes||'참가 가능 지역 조회 전'::text;
  else
   select array_agg(distinct left(btrim(v),80)) into regions from jsonb_array_elements_text(p_terms->'regions') v where char_length(btrim(v)) between 2 and 80;
   select array_agg(name) into home from public.sales_bid_qualifications where kind='지역' and status='보유';
   if home is null then region_state:='확인';notes:=notes||('참가 가능 지역: '||array_to_string(regions,', ')||' · 본사 소재지 미등록');
   elsif exists(select 1 from unnest(regions) r,unnest(home) h where r like h||'%' or r='전국') then region_state:='가능';
   else region_state:='불가';notes:=notes||('참가 가능 지역: '||array_to_string(regions,', ')||' · 본사 소재지 아님');
   end if;
  end if;
 end if;
 return jsonb_build_object('verdict',case when '불가' in (lic_state,region_state) then '참여 불가' when '확인' in (lic_state,region_state) then '자격 확인 필요' else '참여 가능' end,
  'note',left(case when notes='{}' then '업종 · 지역 제한 없음 또는 보유 자격으로 충족' else array_to_string(notes,' · ') end,400));
end $$;

-- Extends the licence gate: the verdict is written on every save; an impossible notice leaves the list.
create or replace function private.sales_license_gate() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 if new.source not like '나라장터%' then return new; end if;
 if new.event_data ? 'terms' then
  v:=private.sales_bid_verdict(new.event_data->'terms');
  if v is not null then new.event_data:=new.event_data||jsonb_build_object('eligibility',v); end if;
 end if;
 if new.reviewed_assessment is not null then return new; end if;
 if new.event_data->>'category'='construction' or new.name ~ '(실내건축|인테리어 ?공사|건축 ?공사|리모델링 ?공사|시설 ?공사|전문건설|건설업)' then
  new.assessment:='제외';new.score:=0;
  new.reasons:='참여 불가: 실내건축공사업 등 건설업 면허가 필요한 공사 공고';
  new.next_action:='조치 없음 · 면허가 필요 없는 용역 공고만 검토';
 elsif v->>'verdict'='참여 불가' then
  new.assessment:='제외';new.score:=0;
  new.reasons:=left('참여 불가: '||(v->>'note'),500);
  new.next_action:='조치 없음 · 참가 자격이 맞는 공고만 검토';
 elsif v->>'verdict'='자격 확인 필요' then
  new.next_action:=left('참가 자격 확인: '||(v->>'note'),500);
 end if;
 return new;
end $$;

create function private.sales_bid_rejudge() returns void language sql security definer set search_path='' as $$
 -- A notice this gate excluded returns to review first; the trigger excludes it again when it still cannot be joined.
 update public.sales_prospects set revision=revision+1,
  assessment=case when reasons like '참여 불가: %' then '확인 필요' else assessment end,score=case when reasons like '참여 불가: %' then 50 else score end,
  reasons=case when reasons like '참여 불가: %' then '참가 자격 다시 판정함 · 다음 수집에서 수요 재평가' else reasons end,
  next_action=case when reasons like '참여 불가: %' or next_action like '참가 자격 확인: %' then '공고 원문 검토' else next_action end
  where source like '나라장터%' and event_data ? 'terms' and reviewed_assessment is null and (end_date is null or end_date>=current_date-7)
$$;
create function public.sales_bid_qualification_set(p_kind text,p_name text,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 바꿀 수 있습니다.' using errcode='42501'; end if;
 if p_status is null or p_status not in ('보유','미보유','확인 필요') then raise exception '상태 값을 확인해 주세요.'; end if;
 if p_kind='지역' then
  -- One head-office region: choosing it marks every other region as not held.
  if p_status<>'보유' or not exists(select 1 from public.sales_bid_qualifications where kind='지역' and name=p_name) then raise exception '본사 소재지를 목록에서 골라 주세요.'; end if;
  update public.sales_bid_qualifications set status=case when name=p_name then '보유' else '미보유' end,updated_at=now() where kind='지역';
 elsif p_kind='업종' then
  update public.sales_bid_qualifications set status=p_status,updated_at=now() where kind='업종' and name=p_name;
  if not found then raise exception '없는 업종입니다.'; end if;
 else raise exception '구분 값을 확인해 주세요.';
 end if;
 perform private.sales_bid_rejudge();
end $$;
revoke all on function private.sales_bid_verdict(jsonb),private.sales_bid_rejudge(),private.sales_license_gate() from public,anon,authenticated;
revoke all on function public.sales_bid_qualification_set(text,text,text) from public,anon;
grant execute on function public.sales_bid_qualification_set(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
