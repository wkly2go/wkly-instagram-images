begin;
create table public.growth_ig_sync (
 account_id text primary key check(account_id ~ '^[0-9]{1,40}$'), division text not null check(division in ('TW','AR')), cursor text,
 revision integer not null default 0, last_synced_at timestamptz, last_completed_at timestamptz
);
create table public.growth_ig_contacts (
 account_id text not null references public.growth_ig_sync(account_id), sender_id text not null,
 item_id uuid not null references public.growth_items(id), created_at timestamptz not null default now(),
 primary key(account_id,sender_id)
);
alter table public.growth_ig_sync enable row level security;
alter table public.growth_ig_contacts enable row level security;
revoke all on public.growth_ig_sync,public.growth_ig_contacts from public,anon,authenticated;
grant select on public.growth_ig_sync to service_role;
create function public.growth_ig_commit(p_account text,p_revision integer,p_cursor text,p_candidates jsonb,p_owner uuid,p_division text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare state public.growth_ig_sync; c jsonb; item public.growth_items; existing uuid; handle text; inserted integer:=0; kept integer:=0;
begin
 if p_account is null or p_account !~ '^[0-9]{1,40}$' or p_revision is null or p_revision<0 or (p_cursor is not null and (char_length(p_cursor)>2048 or p_cursor='')) then raise exception '수집 상태가 올바르지 않습니다.'; end if;
 if p_division is null or p_division not in ('TW','AR') then raise exception '수집 계정의 회사를 확인해 주세요.'; end if;
 if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates)>100 then raise exception '후보 형식을 확인해 주세요.'; end if;
 if not exists(select 1 from public.profiles where id=p_owner and active and not is_agent) then raise exception '활성 담당자를 확인해 주세요.'; end if;
 insert into public.growth_ig_sync(account_id,division) values(p_account,p_division) on conflict do nothing;
 select * into state from public.growth_ig_sync where account_id=p_account for update;
 if state.division<>p_division then raise exception '기존 수집 계정의 회사가 다릅니다. 관리자에게 확인해 주세요.'; end if;
 if state.revision<>p_revision then raise exception '다른 수집이 먼저 완료됐습니다. 상태를 다시 확인해 주세요.' using errcode='40001'; end if;
 for c in select * from jsonb_array_elements(p_candidates) loop
  if jsonb_typeof(c) is distinct from 'object' or c-array['id','username']<>'{}'::jsonb or jsonb_typeof(c->'id') is distinct from 'string' or c->>'id' !~ '^[0-9]{1,40}$' or jsonb_typeof(c->'username') is distinct from 'string' or c->>'username' !~ '^[a-zA-Z0-9_.]{1,30}$' then raise exception '담당자 후보 형식을 확인해 주세요.'; end if;
  if c->>'id'=p_account then continue; end if;
  select item_id into existing from public.growth_ig_contacts where account_id=p_account and sender_id=c->>'id';
  if existing is not null then kept:=kept+1; continue; end if;
  handle:=lower(c->>'username');
  select id into existing from public.growth_items where kind='contact' and lower(ltrim(document->>'instagram','@'))=handle order by created_at,id limit 1;
  if existing is null then
   insert into public.growth_items(id,kind,title,owner_id,status,source_key,document)
   values(gen_random_uuid(),'contact','@'||handle,p_owner,'검토','ig:'||handle,jsonb_build_object('division',p_division,'source_url','https://www.instagram.com/'||handle||'/','note','연결된 인스타그램 대화의 참여자 후보입니다. 브랜드·담당자 여부를 확인한 뒤 영업에 연결해 주세요.','name','','brand','','email','','instagram',handle,'segment','미분류','source','인스타그램'))
   on conflict(kind,source_key) do nothing returning * into item;
   if item.id is not null then
    existing:=item.id; inserted:=inserted+1;
    insert into public.growth_revisions values(item.id,item.revision,to_jsonb(item),now());
   else
    select id into existing from public.growth_items where kind='contact' and source_key='ig:'||handle;
    kept:=kept+1;
   end if;
  else kept:=kept+1;
  end if;
  if existing is null then raise exception '후보 저장을 확인하지 못했습니다.'; end if;
  insert into public.growth_ig_contacts(account_id,sender_id,item_id) values(p_account,c->>'id',existing);
 end loop;
 update public.growth_ig_sync set cursor=p_cursor,revision=revision+1,last_synced_at=clock_timestamp(),last_completed_at=case when p_cursor is null then clock_timestamp() else last_completed_at end where account_id=p_account;
 return jsonb_build_object('inserted',inserted,'kept',kept,'hasMore',p_cursor is not null,'revision',p_revision+1);
end $$;
revoke all on function public.growth_ig_commit(text,integer,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.growth_ig_commit(text,integer,text,jsonb,uuid,text) to service_role;
commit;
