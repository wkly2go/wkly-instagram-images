-- The sales playbook lives in the database so it can grow: a weekly AI review proposes changes from
-- the decisions made so far, and a proposal takes effect only when the administrator approves it.
begin;
create table public.sales_methods(
 name text primary key check(char_length(name) between 2 and 40),signal text not null,offer text not null,first_step text not null,
 active boolean not null default true,origin text not null default '기본' check(origin in ('기본','AI 제안')),updated_at timestamptz not null default now()
);
insert into public.sales_methods(name,signal,offer,first_step) values
 ('팝업 오픈 브랜드 후속 제안','브랜드의 팝업 운영·예정 보도','다음 시즌·다음 지역 팝업의 기획·대행(공간 디자인, 제작·설치, 운영)','이번 팝업의 공개 정보를 근거로 다음 회차 일정과 공간 계획을 묻는다'),
 ('신규 매장·플래그십 오픈 후속','매장·쇼룸·플래그십 오픈 보도','오픈 기념 행사와 프로모션 팝업의 기획·대행','오픈 사실을 짚고 오픈 행사·시즌 팝업 계획을 묻는다'),
 ('박람회·전시 참가사 부스 제안','박람회·전시회 참가기업 모집, 참가사 목록','참가 부스의 기획·디자인·제작·설치·현장 운영 대행','행사명과 일정에 맞춘 부스 규모별 구성을 제시한다'),
 ('공공 용역 입찰 참여','나라장터 행사·전시·홍보 용역 공고','행사·전시·홍보의 기획·운영 대행 용역 제안서(면허 불필요 범위)','참가 자격·추정가격·마감을 대조해 참여 여부를 판단한다'),
 ('면허 보유사와 공동 참여','실내건축 면허와 디자인 자격을 함께 요구하는 공고(공동수급 허용)','디자인·콘텐츠 분담의 공동수급 구성','공동수급 허용 여부를 확인하고 면허 보유 협력사에 분담안을 제안한다'),
 ('기존 거래처 재수주','거래처의 새 캠페인·행사·출점 소식, 지난 프로젝트 종료 후 기간 경과','지난 프로젝트를 잇는 다음 팝업·행사 기획·대행','지난 프로젝트 결과를 근거로 다음 일정을 묻는다'),
 ('대행사·기획사 협력 제안','행사·캠페인을 수주한 대행사 보도, 대행사 선정 공고','대행사가 수주한 행사의 팝업·공간 파트 기획·제작 협력','수주한 행사의 공간 파트 협력 범위를 제안한다'),
 ('공간 운영사·유통사 제휴','대관 공간·백화점·쇼핑몰의 팝업 유치 계획','입점 브랜드용 팝업 기획·운영 패키지, 공간 연간 운영 대행','공간의 입점 일정에 맞춘 패키지 운영안을 제안한다'),
 ('매거진 취재 연계','더위클리 매거진이 다룰 만한 팝업·브랜드','취재·콘텐츠로 관계를 만든 뒤 다음 팝업·행사 기획·대행 제안','취재 요청으로 담당자와 접점을 만든다');
create table public.sales_method_proposals(
 id uuid primary key default gen_random_uuid(),action text not null check(action in ('추가','수정','중지')),name text not null,signal text not null default '',offer text not null default '',first_step text not null default '',reason text not null,
 status text not null default '승인 대기' check(status in ('승인 대기','승인','반려')),created_at timestamptz not null default now(),decided_at timestamptz,decided_by uuid references public.profiles(id)
);
alter table public.sales_methods enable row level security;
alter table public.sales_method_proposals enable row level security;
create policy sales_methods_read on public.sales_methods for select to authenticated using((select public.is_active_member()));
create policy sales_method_proposals_read on public.sales_method_proposals for select to authenticated using((select public.is_active_member()));
revoke all on public.sales_methods,public.sales_method_proposals from anon,authenticated;
grant select on public.sales_methods,public.sales_method_proposals to authenticated;

create function private.sales_methods_active() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('name',name,'signal',signal,'offer',offer,'first',first_step) order by origin,name),'[]'::jsonb) from public.sales_methods where active
$$;
-- A new plan receives the current playbook together with the learning it already gets.
do $$
declare def text; old text:='jsonb_build_object(''learning'',private.sales_method_learning())'; new text:='jsonb_build_object(''learning'',private.sales_method_learning(),''methods'',private.sales_methods_active())';
begin
 def:=pg_get_functiondef('public.sales_strategy_claim(uuid,uuid)'::regprocedure);
 if position('sales_methods_active' in def)>0 then return; end if;
 if position(old in def)=0 then raise exception 'Unexpected planner claim'; end if;
 execute replace(def,old,new);
end $$;

create function public.sales_method_decide(p_id uuid,p_decision text) returns void language plpgsql security definer set search_path='' as $$
declare p public.sales_method_proposals;
begin
 if not public.is_admin() then raise exception '관리자만 결정할 수 있습니다.' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('승인','반려') then raise exception '결정 값을 확인해 주세요.'; end if;
 select * into p from public.sales_method_proposals where id=p_id for update;
 if p.id is null or p.status<>'승인 대기' then raise exception '이미 결정했거나 없는 제안입니다.' using errcode='PT409'; end if;
 if p_decision='승인' then
  if p.action='추가' then insert into public.sales_methods(name,signal,offer,first_step,origin) values(p.name,p.signal,p.offer,p.first_step,'AI 제안') on conflict(name) do update set signal=excluded.signal,offer=excluded.offer,first_step=excluded.first_step,active=true,updated_at=now();
  elsif p.action='수정' then update public.sales_methods set signal=p.signal,offer=p.offer,first_step=p.first_step,active=true,updated_at=now() where name=p.name;
  else update public.sales_methods set active=false,updated_at=now() where name=p.name;
  end if;
 end if;
 update public.sales_method_proposals set status=p_decision,decided_at=now(),decided_by=auth.uid() where id=p_id;
end $$;
revoke all on function public.sales_method_decide(uuid,text) from public,anon;
grant execute on function public.sales_method_decide(uuid,text) to authenticated;

create table private.sales_method_review_jobs(id uuid primary key default gen_random_uuid(),token uuid not null default gen_random_uuid(),actor uuid not null references public.profiles(id),state text not null default 'queued' check(state in ('queued','claimed','done','failed')),created_at timestamptz not null default now(),finished_at timestamptz,note text not null default '');
alter table private.sales_method_review_jobs enable row level security;
revoke all on private.sales_method_review_jobs from public,anon,authenticated;
create function private.sales_method_review_tick() returns integer language plpgsql security definer set search_path='' as $$
declare gateway text; who uuid; job private.sales_method_review_jobs;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sales_method_review',0)) then return 0; end if;
 update private.sales_method_review_jobs set state='failed',finished_at=now(),note='검토 시간 초과' where state in ('queued','claimed') and created_at<now()-interval '5 minutes';
 -- One review a week at most, and none while earlier proposals still wait for a decision.
 if exists(select 1 from private.sales_method_review_jobs where created_at>now()-interval '6 days') or exists(select 1 from public.sales_method_proposals where status='승인 대기') then return 0; end if;
 if (select count(*) from public.sales_strategies where status in ('승인','수정 요청','보류') and created_at>now()-interval '90 days')<3 then return 0; end if;
 select btrim(decrypted_secret) into gateway from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 select id into who from public.profiles where active and role='admin' and not is_agent order by id limit 1;
 if coalesce(gateway,'')='' or who is null then return 0; end if;
 insert into private.sales_method_review_jobs(actor) values(who) returning * into job;
 perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-method-research',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,'apikey',gateway),body:=jsonb_build_object('id',job.id,'token',job.token),timeout_milliseconds:=10000);
 return 1;
end $$;
create function public.sales_method_review_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_method_review_jobs; model text;
begin
 update private.sales_method_review_jobs set state='claimed' where id=p_id and token=p_token and state='queued' and created_at>now()-interval '5 minutes' returning * into j;
 if j.id is null then return null; end if;
 select key into model from public.growth_ai_models where enabled order by case key when 'standard' then 0 when 'fast' then 1 else 2 end limit 1;
 return jsonb_build_object('id',j.id,'actor',j.actor,'model',coalesce(model,'fast'),'methods',private.sales_methods_active(),'learning',private.sales_method_learning(),
  'signals',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'count',n) order by n desc),'[]'::jsonb) from (select coalesce(nullif(event_data->>'occasion',''),source) label,count(*)::integer n from public.sales_prospects where source in ('news_brand','행사 참여 브랜드','event_participant','나라장터 공식 공고','나라장터 공식 API','홈페이지 문의') and collected_at>now()-interval '30 days' and not blocked group by 1 order by count(*) desc limit 12) s));
end $$;
create function public.sales_method_review_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_task is distinct from 'write' or not exists(select 1 from private.sales_method_review_jobs j where j.id=p_id and j.actor=p_user and j.state='claimed' and j.created_at>now()-interval '5 minutes') then raise exception 'Method review claim required' using errcode='42501'; end if;
 return private.sales_ai_topup(p_id,p_input_tokens,6000,public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens));
end $$;
create function public.sales_method_review_finish(p_id uuid,p_proposals jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_method_review_jobs; p jsonb;
begin
 select * into j from private.sales_method_review_jobs where id=p_id for update;
 if j.id is null or j.state<>'claimed' then return; end if;
 if p_proposals is null then
  if p_error is null or char_length(p_error) not between 1 and 300 then raise exception 'Invalid method review result'; end if;
  update private.sales_method_review_jobs set state='failed',finished_at=now(),note=p_error where id=p_id;return;
 end if;
 if jsonb_typeof(p_proposals) is distinct from 'array' or jsonb_array_length(p_proposals)>2 then raise exception 'Invalid method review result'; end if;
 for p in select value from jsonb_array_elements(p_proposals) loop
  if jsonb_typeof(p) is distinct from 'object' or p-ARRAY['action','name','signal','offer','first','reason']<>'{}' or coalesce(p->>'action','') not in ('추가','수정','중지') or char_length(coalesce(p->>'name','')) not between 2 and 40 or char_length(coalesce(p->>'reason','')) not between 5 and 300
   or char_length(coalesce(p->>'signal',''))>160 or char_length(coalesce(p->>'offer',''))>160 or char_length(coalesce(p->>'first',''))>160 or (p->>'name')||(p->>'signal')||(p->>'offer')||(p->>'first')||(p->>'reason') ~ '[<>{}\\]'
   or (p->>'action'='추가')=exists(select 1 from public.sales_methods m where m.name=p->>'name') or (p->>'action'<>'중지' and (char_length(p->>'signal')<4 or char_length(p->>'offer')<4 or char_length(p->>'first')<4)) then raise exception 'Invalid method proposal'; end if;
 end loop;
 insert into public.sales_method_proposals(action,name,signal,offer,first_step,reason) select v->>'action',v->>'name',coalesce(v->>'signal',''),coalesce(v->>'offer',''),coalesce(v->>'first',''),v->>'reason' from jsonb_array_elements(p_proposals) v;
 update private.sales_method_review_jobs set state='done',finished_at=now(),note=jsonb_array_length(p_proposals)||'건 제안' where id=p_id;
end $$;
revoke all on function private.sales_methods_active(),private.sales_method_review_tick() from public,anon,authenticated;
revoke all on function public.sales_method_review_claim(uuid,uuid),public.sales_method_review_ai_reserve(uuid,uuid,text,text,text,integer),public.sales_method_review_finish(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_method_review_claim(uuid,uuid),public.sales_method_review_ai_reserve(uuid,uuid,text,text,text,integer),public.sales_method_review_finish(uuid,jsonb,text) to service_role;
-- Mondays 08:30 KST.
select cron.schedule('wkly_sales_method_review','30 23 * * 0','select private.sales_method_review_tick()');
notify pgrst,'reload schema';
commit;
