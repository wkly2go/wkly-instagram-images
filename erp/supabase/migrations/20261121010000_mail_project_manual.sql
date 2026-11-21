-- 메일 → 프로젝트 손으로 붙이기 · 떼기 (2026-11-21 · 2026-11-20 '메일 분류가 안된거 같아'의 남은 과제)
--  - 자동 연결(private.mail_link · mail_link_threads)이 틀렸을 때 팀원이 프로젝트 화면에서 고친다
--  - 고친 내용은 mail_project_overrides 에 남아 메일이 다시 동기화돼도(제목 · 받는 사람 변경 → 트리거 재계산) 그대로 지켜진다
--  - 기본은 같은 대화(thread) 전체에 적용
--  - DROP 없음 · 기존 함수는 create or replace 로 본문만 바꿈

create table if not exists public.mail_project_overrides (
  mail_id text not null references public.mail_index (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  action text not null check (action in ('add', 'remove')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (mail_id, project_id)
);
create index if not exists mail_project_overrides_project on public.mail_project_overrides (project_id);

alter table public.mail_project_overrides enable row level security;
create policy mail_project_overrides_read on public.mail_project_overrides for select to authenticated using ((select public.is_active_member()));
revoke all on public.mail_project_overrides from anon;
revoke insert, update, delete on public.mail_project_overrides from authenticated;

-- 자동으로 고른 프로젝트에 손으로 고친 것을 덮어씀
create or replace function private.mail_apply_overrides(p_mail text, p_ids uuid[])
returns uuid[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}')
  from (
    select unnest(coalesce(p_ids, '{}')) x
    union select o.project_id from public.mail_project_overrides o where o.mail_id = p_mail and o.action = 'add'
  ) s
  where not exists (select 1 from public.mail_project_overrides o where o.mail_id = p_mail and o.project_id = s.x and o.action = 'remove')
$$;
revoke all on function private.mail_apply_overrides(text, uuid[]) from public, anon, authenticated;

create or replace function private.mail_link()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  v_text text := concat_ws(' ', new.subject, new.snippet, array_to_string(new.attachments, ' '));
  v_other text := case when new.from_addr ilike '%@thewklyn.com' then new.to_addr else new.from_addr end;
  v_contact uuid;
  v_client uuid;
  v_thread uuid[];
begin
  new.project_ids := (select coalesce(array_agg(distinct x), '{}') from unnest(public.match_projects(v_text) || public.match_projects_loose(v_text)) x);
  if v_other is not null then
    select c.id, c.client_id into v_contact, v_client from public.contacts c where lower(c.email) = lower(v_other) limit 1;
    if v_client is null then
      select k.id into v_client from public.clients k where lower(k.email) = lower(v_other) limit 1;
    end if;
    if v_client is not null and cardinality(new.project_ids) = 0 then
      new.project_ids := coalesce((select array_agg(p.id) from public.projects p where p.client_id = v_client and p.status in ('진행', '문의', 'NIC') having count(*) = 1), '{}');
    end if;
  end if;
  if cardinality(new.project_ids) = 0 and new.thread_id is not null then
    v_thread := coalesce((select array_agg(distinct x) from public.mail_index m, unnest(m.project_ids) x
                           where m.thread_id = new.thread_id and m.id <> new.id), '{}');
    if cardinality(v_thread) between 1 and 2 then new.project_ids := v_thread; end if;
  end if;
  new.project_ids := private.mail_apply_overrides(new.id, new.project_ids);
  new.contact_id := v_contact;
  new.client_id := v_client;
  return new;
end $function$;

create or replace function private.mail_link_threads()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare n integer;
begin
  update public.mail_index m set project_ids = sub.pids
  from (
    select u.id, private.mail_apply_overrides(u.id,
             (select array_agg(distinct x) from public.mail_index s, unnest(s.project_ids) x where s.thread_id = u.thread_id and s.id <> u.id)) as pids
    from public.mail_index u
    where cardinality(u.project_ids) = 0 and u.thread_id is not null
      and exists (select 1 from public.mail_index s where s.thread_id = u.thread_id and s.id <> u.id and cardinality(s.project_ids) > 0)
    limit 300) sub
  where m.id = sub.id and cardinality(sub.pids) > 0;
  get diagnostics n = row_count;
  return n;
end $function$;

-- 화면: 메일(기본은 같은 대화 전체)을 이 프로젝트에 붙이거나 뗌 · 바뀐 메일 수를 돌려줌
create or replace function public.mail_project_set(p_mail text, p_project uuid, p_on boolean, p_thread boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_thread text; v_n integer := 0; r record;
begin
  if not public.is_active_member() then raise exception '팀원만 고칠 수 있습니다.' using errcode = '42501'; end if;
  if not exists (select 1 from public.projects where id = p_project) then raise exception '프로젝트를 찾지 못했습니다.'; end if;
  select thread_id into v_thread from public.mail_index where id = p_mail;
  if not found then raise exception '메일을 찾지 못했습니다.'; end if;
  for r in select id, project_ids from public.mail_index
           where id = p_mail or (p_thread and v_thread is not null and thread_id = v_thread) loop
    insert into public.mail_project_overrides (mail_id, project_id, action)
    values (r.id, p_project, case when p_on then 'add' else 'remove' end)
    on conflict (mail_id, project_id) do update set action = excluded.action, created_by = auth.uid(), created_at = now();
    update public.mail_index set project_ids = private.mail_apply_overrides(r.id, r.project_ids) where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.mail_project_set(text, uuid, boolean, boolean) from public, anon;
grant execute on function public.mail_project_set(text, uuid, boolean, boolean) to authenticated;
