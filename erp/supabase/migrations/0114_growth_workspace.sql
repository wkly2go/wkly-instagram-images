begin;
create table public.growth_items (
 id uuid primary key, kind text not null check(kind in ('tender','content','contact')),
 title text not null check(char_length(btrim(title)) between 1 and 160),
 owner_id uuid not null references public.profiles(id), status text not null,
 document jsonb not null check(jsonb_typeof(document)='object'), source_key text,
 campaign_id uuid references public.marketing_campaigns(id), linked_sales_id uuid references public.sales_opportunities(id),
 revision integer not null default 1, created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(kind,source_key)
);
create index growth_list_idx on public.growth_items(kind,updated_at desc,id);
create table public.growth_revisions(item_id uuid references public.growth_items(id), revision integer, snapshot jsonb not null, created_at timestamptz default now(), primary key(item_id,revision));
alter table public.growth_items enable row level security;
alter table public.growth_revisions enable row level security;
create policy growth_read on public.growth_items for select to authenticated using((select public.is_active_member()));
create policy growth_history_read on public.growth_revisions for select to authenticated using((select public.is_active_member()));
revoke all on public.growth_items,public.growth_revisions from anon,authenticated;
grant select on public.growth_items,public.growth_revisions to authenticated;

create function public.growth_safe_url(v text) returns boolean language sql immutable set search_path='' as $$
 select v is not null and char_length(v)<=2000 and (v='' or (v ~* '^https?://[^[:space:]/@?#]+([/?#][^[:space:]]*)?$' and v !~ '[[:cntrl:]]'))
$$;

create function public.growth_save(p_id uuid,p_document jsonb,p_expected_revision integer)
returns public.growth_items language plpgsql security definer set search_path='' as $$
declare prior public.growth_items; saved public.growth_items; d public.growth_items; x jsonb; v jsonb; oldv jsonb; k text; sk text; changed boolean;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if p_id is null or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>131072 then raise exception '입력 형식을 확인해 주세요.'; end if;
 if p_document-array['kind','title','owner_id','status','document','campaign_id'] <> '{}'::jsonb then raise exception '허용되지 않은 입력입니다.'; end if;
 foreach k in array array['kind','title','owner_id','status'] loop
  if jsonb_typeof(p_document->k) is distinct from 'string' then raise exception '필수 항목을 확인해 주세요.'; end if;
 end loop;
 d:=jsonb_populate_record(null::public.growth_items,p_document); x:=d.document; d.title:=btrim(d.title);
 if jsonb_typeof(x) is distinct from 'object' then raise exception '문서 형식을 확인해 주세요.'; end if;
 if x-array['division','source_url','note','number','round','agency','deadline','amount','qualification','evidence','original','versions','name','brand','email','instagram','segment','source'] <> '{}'::jsonb then raise exception '허용되지 않은 문서 항목입니다.'; end if;
 if coalesce(x->>'division','') not in ('TW','AR') or not public.growth_safe_url(x->>'source_url') or jsonb_typeof(x->'note') is distinct from 'string' or char_length(x->>'note')>10000 then raise exception '회사·출처·메모를 확인해 주세요.'; end if;
 if not exists(select 1 from public.profiles where id=d.owner_id and active and not is_agent) then raise exception '활성 담당자를 선택해 주세요.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
 select * into prior from public.growth_items where id=p_id for update;
 if not public.is_admin() and (d.owner_id<>auth.uid() or (prior.id is not null and prior.owner_id<>auth.uid())) then raise exception '담당자 또는 관리자만 수정할 수 있습니다.' using errcode='42501'; end if;
 if coalesce(prior.revision,0)<>p_expected_revision then raise exception '다른 작업에서 변경되었습니다. 다시 불러와 주세요.' using errcode='40001'; end if;
 if prior.id is not null and prior.kind<>d.kind then raise exception '자료 종류를 변경할 수 없습니다.'; end if;
 if d.kind='tender' then
  if d.status not in ('검토','준비','제출','종료','취소') then raise exception '공고 상태를 확인해 주세요.'; end if;
  foreach k in array array['number','round','agency'] loop
   if jsonb_typeof(x->k) is distinct from 'string' or char_length(btrim(x->>k)) not between 1 and 200 then raise exception '공고번호·차수·발주처를 확인해 주세요.'; end if;
  end loop;
  if coalesce(x->>'deadline','')<>'' then if x->>'deadline' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception '마감 시각의 시간대를 확인해 주세요.'; end if; perform (x->>'deadline')::timestamptz; end if;
  if x->'amount' is distinct from 'null'::jsonb then
   if jsonb_typeof(x->'amount') is distinct from 'number' or (x->>'amount')::numeric<0 or (x->>'amount')::numeric>9007199254740991 or trunc((x->>'amount')::numeric)<>(x->>'amount')::numeric then raise exception '공고 금액을 확인해 주세요.'; end if;
  end if;
  if coalesce(x->>'qualification','') not in ('추가 확인','충족','불충족') or (x->>'qualification'<>'추가 확인' and coalesce(btrim(x->>'evidence'),'')='') then raise exception '참가 조건 판단과 근거를 확인해 주세요.'; end if;
  sk:=btrim(x->>'number')||':'||btrim(x->>'round');
 elsif d.kind='contact' then
  if d.status not in ('검토','확인','제외') then raise exception '연락처 상태를 확인해 주세요.'; end if;
  x:=jsonb_set(x,'{email}',to_jsonb(lower(btrim(coalesce(x->>'email','')))));
  x:=jsonb_set(x,'{instagram}',to_jsonb(lower(regexp_replace(coalesce(x->>'instagram',''),'^@',''))));
  if x->>'email'='' and x->>'instagram'='' then raise exception '이메일 또는 인스타 계정이 필요합니다.'; end if;
  if x->>'email'<>'' and (char_length(x->>'email')>254 or x->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception '이메일 형식을 확인해 주세요.'; end if;
  if x->>'instagram'<>'' and x->>'instagram' !~ '^[a-z0-9_.]{1,30}$' then raise exception '인스타 계정명을 확인해 주세요.'; end if;
  sk:=case when x->>'email'<>'' then 'email:'|| (x->>'email') else 'ig:'||(x->>'instagram') end;
 elsif d.kind='content' then
  if d.status not in ('작성 중','검수 중','발행 기록') or jsonb_typeof(x->'original') is distinct from 'string' or char_length(btrim(x->>'original')) not between 1 and 20000 then raise exception '콘텐츠 원본과 상태를 확인해 주세요.'; end if;
  if jsonb_typeof(x->'versions') is distinct from 'array' or jsonb_array_length(x->'versions')<>3 then raise exception '채널 버전을 확인해 주세요.'; end if;
  if (select count(distinct z->>'channel') from jsonb_array_elements(x->'versions') z)<>3 then raise exception '채널이 중복됩니다.'; end if;
  for v in select * from jsonb_array_elements(x->'versions') loop
   if jsonb_typeof(v) is distinct from 'object' or v-array['channel','title','body','tags','status','rights','publication_url','external_id']<>'{}'::jsonb then raise exception '채널 형식을 확인해 주세요.'; end if;
   foreach k in array array['channel','title','body','tags','status','publication_url','external_id'] loop
    if jsonb_typeof(v->k) is distinct from 'string' then raise exception '채널 필수 항목을 확인해 주세요.'; end if;
   end loop;
   if v->>'channel' not in ('네이버 블로그','인스타그램','유튜브') or v->>'status' not in ('초안','검수','승인','발행') or jsonb_typeof(v->'rights') is distinct from 'boolean' or char_length(v->>'title')>300 or char_length(v->>'body')>10000 or char_length(v->>'tags')>500 or not public.growth_safe_url(v->>'publication_url') or char_length(v->>'external_id')>300 then raise exception '채널 내용과 발행 주소를 확인해 주세요.'; end if;
   oldv:=null;
   if prior.id is not null then select z into oldv from jsonb_array_elements(prior.document->'versions') z where z->>'channel'=v->>'channel'; end if;
   changed:=oldv is null or (oldv-array['status','publication_url','external_id']) is distinct from (v-array['status','publication_url','external_id']) or prior.document->>'original' is distinct from x->>'original';
   if v->>'status' in ('승인','발행') then
    if changed then raise exception '변경한 내용을 초안으로 저장한 뒤 다시 검수·승인해 주세요.'; end if;
    if coalesce(oldv->>'status','') not in ('승인','발행') and not public.is_admin() then raise exception '관리자가 콘텐츠를 승인해야 합니다.' using errcode='42501'; end if;
    if btrim(v->>'title')='' or btrim(v->>'body')='' or v->>'rights'<>'true' then raise exception '제목·본문·사용 권리를 확인해 주세요.'; end if;
    if v->>'status'='발행' and v->>'publication_url'='' then raise exception '실제 발행 주소를 적어 주세요.'; end if;
   end if;
  end loop;
 else raise exception '자료 종류를 확인해 주세요.';
 end if;
 if d.campaign_id is not null then
  if d.kind<>'content' or not exists(select 1 from public.marketing_campaigns where id=d.campaign_id and document->>'brand'=case when x->>'division'='TW' then 'wkly' else 'arterior' end) then raise exception '같은 회사의 광고 캠페인을 선택해 주세요.'; end if;
 end if;
 insert into public.growth_items(id,kind,title,owner_id,status,document,source_key,campaign_id,created_by,updated_by)
 values(p_id,d.kind,d.title,d.owner_id,d.status,x,sk,d.campaign_id,auth.uid(),auth.uid())
 on conflict(id) do update set title=excluded.title,owner_id=excluded.owner_id,status=excluded.status,document=excluded.document,source_key=excluded.source_key,campaign_id=excluded.campaign_id,revision=growth_items.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into saved;
 insert into public.growth_revisions values(saved.id,saved.revision,to_jsonb(saved),now());
 return saved;
end $$;

create function public.growth_link_sales(p_id uuid,p_expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.growth_items; sid uuid; sd jsonb;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 select * into r from public.growth_items where id=p_id for update;
 if r.id is null or (not public.is_admin() and r.owner_id<>auth.uid()) then raise exception '담당자 또는 관리자만 연결할 수 있습니다.' using errcode='42501'; end if;
 if r.linked_sales_id is not null then return r.linked_sales_id; end if;
 if r.revision<>p_expected_revision then raise exception '다시 불러온 뒤 연결해 주세요.' using errcode='40001'; end if;
 if r.kind='content' or r.status in ('제외','취소','종료') or (r.kind='contact' and r.status<>'확인') then raise exception '검토·확인한 영업 대상만 연결해 주세요.'; end if;
 if r.kind='tender' and r.document->>'qualification'='불충족' then raise exception '참가 조건을 충족하지 않는 공고입니다.'; end if;
 sid:=gen_random_uuid();
 sd:=jsonb_build_object('title',r.title,'division',r.document->>'division','client_id',null,'contact_id',null,'owner_id',r.owner_id,'stage','발굴','source',case when r.kind='tender' then '나라장터' else '기타' end,'source_url',r.document->>'source_url','expected_amount',null,'next_action','대상 확인 및 첫 연락 준비','next_date',null,'description',left(concat_ws(E'\n',r.document->>'note',r.document->>'agency',r.document->>'evidence',r.document->>'email',r.document->>'instagram'),10000),'result_note','','project_id',null);
 perform public.sales_save_opportunity(sid,sd,0);
 update public.growth_items set linked_sales_id=sid,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=p_id returning * into r;
 insert into public.growth_revisions values(r.id,r.revision,to_jsonb(r),now());
 return sid;
end $$;

-- 기존 메일 동기화가 저장한 발신자만 검토함에 추가한다. 발송·본문 수집은 하지 않는다.
create function public.growth_capture_mail() returns trigger language plpgsql security definer set search_path='' as $$
declare email text; owner uuid; inserted public.growth_items;
begin
 email:=lower(btrim(new.from_addr));
 if email is null or char_length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or email ~ '(^|[._-])(no-?reply|mailer-daemon)' or email ~ '@(thewklyn\.com|arteriors\.co\.kr)$' or coalesce(new.labels,'{}') && array['SENT','SPAM','TRASH'] then return new; end if;
 select id into owner from public.profiles where role='admin' and active and not is_agent order by id limit 1;
 if owner is null then return new; end if;
 insert into public.growth_items(id,kind,title,owner_id,status,source_key,document)
 values(gen_random_uuid(),'contact',left(coalesce(nullif(btrim(new.from_name),''),email),160),owner,'검토','email:'||email,jsonb_build_object('division','TW','source_url','https://mail.google.com/mail/u/0/#all/'||new.thread_id,'note',left(coalesce(new.subject,''),500),'name',coalesce(new.from_name,''),'brand','','email',email,'instagram','','segment','미분류','source','받은 메일'))
 on conflict(kind,source_key) do nothing returning * into inserted;
 if inserted.id is not null then insert into public.growth_revisions values(inserted.id,1,to_jsonb(inserted),now()); end if;
 return new;
end $$;
create trigger growth_mail_capture after insert on public.mail_index for each row execute function public.growth_capture_mail();
-- 과거 자료는 최근 500건 단위로 처리한다. 날짜만 갱신하여 기존 메일 연결 트리거를 건드리지 않는다.
create function public.growth_backfill_mail() returns integer language plpgsql security definer set search_path='' as $$
declare m public.mail_index; n integer:=0;
begin
 if not public.is_admin() then raise exception '관리자만 가져올 수 있습니다.' using errcode='42501'; end if;
 for m in select * from public.mail_index where from_addr is not null and char_length(btrim(from_addr))<=254 and lower(btrim(from_addr)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and lower(btrim(from_addr)) !~ '(^|[._-])(no-?reply|mailer-daemon)' and lower(btrim(from_addr)) !~ '@(thewklyn\.com|arteriors\.co\.kr)$' and not (coalesce(labels,'{}') && array['SENT','SPAM','TRASH']) and not exists(select 1 from public.growth_items g where g.kind='contact' and g.source_key='email:'||lower(btrim(mail_index.from_addr))) order by sent_at desc nulls last limit 500 loop
  update public.mail_index set synced_at=synced_at where id=m.id;
  n:=n+1;
 end loop;
 return n;
end $$;
create trigger growth_mail_backfill after update of synced_at on public.mail_index for each row execute function public.growth_capture_mail();
revoke all on function public.growth_save(uuid,jsonb,integer),public.growth_link_sales(uuid,integer),public.growth_backfill_mail(),public.growth_capture_mail() from public,anon;
grant execute on function public.growth_save(uuid,jsonb,integer),public.growth_link_sales(uuid,integer),public.growth_backfill_mail() to authenticated;
commit;
