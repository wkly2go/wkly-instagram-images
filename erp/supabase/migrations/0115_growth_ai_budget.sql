begin;
create table public.growth_ai_models(key text primary key check(key in ('fast','standard','deep')),label text not null,model_id text not null,input_rate numeric not null check(input_rate>0 and input_rate<=1000),output_rate numeric not null check(output_rate>0 and output_rate<=1000),enabled boolean not null default false);
create table public.growth_ai_budgets(id uuid primary key,starts_at timestamptz not null,ends_at timestamptz not null,limit_usd numeric not null check(limit_usd>=0 and limit_usd<=100),enabled boolean not null default false,spent_usd numeric not null default 0,reserved_usd numeric not null default 0,check(ends_at>starts_at));
create table public.growth_ai_usage(id uuid primary key,user_id uuid not null references public.profiles(id),budget_id uuid not null references public.growth_ai_budgets(id),task text not null,signature text not null,model_id text not null,status text not null check(status in ('running','completed','unknown','reconciled')),reserved_usd numeric not null check(reserved_usd>0),actual_usd numeric,output text,reconciled_by uuid references public.profiles(id),reconciled_note text,reconciled_at timestamptz,created_at timestamptz not null default now());
create index growth_ai_usage_idx on public.growth_ai_usage(budget_id,created_at desc);
alter table public.growth_ai_models enable row level security;
alter table public.growth_ai_budgets enable row level security;
alter table public.growth_ai_usage enable row level security;
create policy ai_models_read on public.growth_ai_models for select to authenticated using((select public.is_active_member()));
create policy ai_budget_read on public.growth_ai_budgets for select to authenticated using((select public.is_active_member()));
create policy ai_usage_read on public.growth_ai_usage for select to authenticated using((select public.is_active_member()) and (user_id=auth.uid() or (select public.is_admin())));
revoke all on public.growth_ai_models,public.growth_ai_budgets,public.growth_ai_usage from anon,authenticated;
grant select on public.growth_ai_models,public.growth_ai_budgets,public.growth_ai_usage to authenticated;
grant all on public.growth_ai_models,public.growth_ai_budgets,public.growth_ai_usage to service_role;

create function public.growth_ai_configure(p_budget jsonb,p_models jsonb) returns void language plpgsql security definer set search_path='' as $$
declare b public.growth_ai_budgets; m jsonb;
begin
 if not public.is_admin() then raise exception '관리자만 AI 사용 한도를 설정할 수 있습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_budget) is distinct from 'object' or p_budget-array['id','starts_at','ends_at','limit_usd','enabled']<>'{}'::jsonb or jsonb_typeof(p_models) is distinct from 'array' or jsonb_array_length(p_models) not between 1 and 3 then raise exception '한도와 모델 설정을 확인해 주세요.'; end if;
 b:=jsonb_populate_record(null::public.growth_ai_budgets,p_budget);
 perform pg_advisory_xact_lock(2147483000);
 if exists(select 1 from public.growth_ai_budgets where id<>b.id and tstzrange(starts_at,ends_at,'[)') && tstzrange(b.starts_at,b.ends_at,'[)')) then raise exception '기존 예산 기간과 겹칩니다. 기존 기간을 수정해 주세요.'; end if;
 if exists(select 1 from public.growth_ai_budgets where id=b.id and (starts_at<>b.starts_at or ends_at<>b.ends_at) and (spent_usd>0 or reserved_usd>0)) then raise exception '사용 이력이 있는 예산 기간은 변경할 수 없습니다.'; end if;
 if exists(select 1 from public.growth_ai_budgets where id=b.id and spent_usd+reserved_usd>b.limit_usd) then raise exception '사용·예약한 금액보다 낮게 설정할 수 없습니다.'; end if;
 insert into public.growth_ai_budgets(id,starts_at,ends_at,limit_usd,enabled) values(b.id,b.starts_at,b.ends_at,b.limit_usd,b.enabled)
 on conflict(id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,limit_usd=excluded.limit_usd,enabled=excluded.enabled;
 if (select count(distinct v->>'key') from jsonb_array_elements(p_models) v)<>jsonb_array_length(p_models) then raise exception '모델 설정이 중복됩니다.'; end if;
 for m in select * from jsonb_array_elements(p_models) loop
  if m-array['key','label','model_id','input_rate','output_rate','enabled']<>'{}'::jsonb or char_length(m->>'label') not between 1 and 100 or coalesce(m->>'model_id','') !~ '^claude-[a-z0-9.-]{1,100}$' then raise exception '모델 ID·이름을 확인해 주세요.'; end if;
  insert into public.growth_ai_models values(m->>'key',m->>'label',m->>'model_id',(m->>'input_rate')::numeric,(m->>'output_rate')::numeric,(m->>'enabled')::boolean)
  on conflict(key) do update set label=excluded.label,model_id=excluded.model_id,input_rate=excluded.input_rate,output_rate=excluded.output_rate,enabled=excluded.enabled;
 end loop;
end $$;

create function public.growth_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.growth_ai_usage; b public.growth_ai_budgets; m public.growth_ai_models; p_amount numeric;
begin
 if not exists(select 1 from public.profiles where id=p_user and active and not is_agent) then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if p_id is null or p_task not in ('classify','write','compare') or char_length(p_signature)<>64 or p_input_tokens is null or p_input_tokens<1 or p_input_tokens>30000 then raise exception '요청 한도를 확인해 주세요.'; end if;
 perform pg_advisory_xact_lock(2147483000);
 select * into prior from public.growth_ai_usage where id=p_id for update;
 if prior.id is not null then
  if prior.user_id<>p_user or prior.signature<>p_signature then raise exception '같은 요청에 다른 내용이 있습니다.'; end if;
  return jsonb_build_object('execute',false,'status',prior.status,'text',prior.output,'cost',coalesce(prior.actual_usd,prior.reserved_usd));
 end if;
 select * into m from public.growth_ai_models where key=p_model and enabled;
 if m.key is null then raise exception '연결할 모델이 아직 설정되지 않았습니다.'; end if;
 p_amount:=ceil((p_input_tokens*m.input_rate+1600*m.output_rate))/1000000;
 if p_amount>1 then raise exception '요청당 비용 한도 $1을 넘습니다.'; end if;
 select * into b from public.growth_ai_budgets where enabled and starts_at<=now() and ends_at>now() for update;
 if b.id is null then raise exception '사용 가능한 예산 기간이 없습니다.'; end if;
 if b.spent_usd+b.reserved_usd+p_amount>b.limit_usd then raise exception 'AI 한도에 도달했습니다. 수동 작성으로 계속해 주세요.'; end if;
 if (select count(*) from public.growth_ai_usage where status='running')>=3 or exists(select 1 from public.growth_ai_usage where user_id=p_user and status='running') then raise exception '실행 중인 요청을 먼저 확인해 주세요.'; end if;
 update public.growth_ai_budgets set reserved_usd=reserved_usd+p_amount where id=b.id;
 insert into public.growth_ai_usage(id,user_id,budget_id,task,signature,model_id,status,reserved_usd) values(p_id,p_user,b.id,p_task,p_signature,m.model_id,'running',p_amount);
 return jsonb_build_object('execute',true,'model_id',m.model_id,'input_rate',m.input_rate,'output_rate',m.output_rate);
end $$;
create function public.growth_ai_finish(p_id uuid,p_actual numeric,p_output text,p_uncertain boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.growth_ai_usage;
begin
 perform pg_advisory_xact_lock(2147483000);
 select * into r from public.growth_ai_usage where id=p_id for update;
 if r.id is null then raise exception '요청을 찾을 수 없습니다.'; end if;
 if r.status<>'running' then return; end if;
 if p_uncertain then update public.growth_ai_usage set status='unknown' where id=p_id; return; end if;
 if p_actual is null or p_actual<0 or char_length(p_output)>30000 then raise exception '정산 값을 확인해 주세요.'; end if;
 update public.growth_ai_budgets set reserved_usd=greatest(0,reserved_usd-r.reserved_usd),spent_usd=spent_usd+p_actual where id=r.budget_id;
 update public.growth_ai_usage set status='completed',actual_usd=p_actual,output=p_output where id=p_id;
end $$;
revoke all on function public.growth_ai_configure(jsonb,jsonb),public.growth_ai_reserve(uuid,uuid,text,text,text,integer),public.growth_ai_finish(uuid,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.growth_ai_configure(jsonb,jsonb) to authenticated;
grant execute on function public.growth_ai_reserve(uuid,uuid,text,text,text,integer),public.growth_ai_finish(uuid,numeric,text,boolean) to service_role;
create function public.growth_ai_reconcile(p_id uuid,p_actual numeric,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare r public.growth_ai_usage;
begin
 if not public.is_admin() then raise exception '관리자만 사용액을 확인할 수 있습니다.' using errcode='42501'; end if;
 if p_actual is null or p_actual<0 or p_actual>100 or p_note is null or char_length(btrim(p_note)) not between 5 and 1000 then raise exception 'Console에서 확인한 비용과 확인 근거를 적어 주세요.'; end if;
 perform pg_advisory_xact_lock(2147483000);
 select * into r from public.growth_ai_usage where id=p_id for update;
 if r.id is null or r.status not in ('unknown','running') or (r.status='running' and r.created_at>now()-interval '5 minutes') then raise exception '확인 대기 요청 또는 5분 이상 지난 요청만 정산할 수 있습니다.'; end if;
 update public.growth_ai_budgets set reserved_usd=greatest(0,reserved_usd-r.reserved_usd),spent_usd=spent_usd+p_actual where id=r.budget_id;
 update public.growth_ai_usage set status='reconciled',actual_usd=p_actual,reconciled_by=auth.uid(),reconciled_note=btrim(p_note),reconciled_at=now() where id=p_id;
end $$;
revoke all on function public.growth_ai_reconcile(uuid,numeric,text) from public,anon;
grant execute on function public.growth_ai_reconcile(uuid,numeric,text) to authenticated;
commit;
