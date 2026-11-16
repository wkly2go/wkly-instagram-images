-- 영업 대화 · 기획 접어 보관 (대표 지시 2026-11-16 '한번 진행한 대화를 계속 유지하지 말고 접어놔 ·
--   대화가 유용하지 않을 경우 검토를 하지 않을 수 있어 · 접은 기획과 대화는 저장해 놓고 다음에 사용할 수 있도록')
-- 대화(sales_desk_messages)와 기획(sales_strategies)은 그대로 두고, 사람마다 '보관함에 넣은 것'만 따로 적는다.
-- 보관해도 기획의 상태(승인 대기 등)는 바뀌지 않는다. 다시 꺼내면 원래 자리로 돌아온다.
create table if not exists private.sales_desk_folds (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('message', 'plan')),
  ref_id uuid not null,
  label text not null default '',
  folded_at timestamptz not null default now(),
  primary key (owner_id, kind, ref_id)
);
revoke all on private.sales_desk_folds from public, anon, authenticated;

-- 접기(p_fold true) · 다시 꺼내기(false). 라벨은 보관함 목록에 보일 한 줄(최대 200자)
create or replace function public.sales_desk_fold(p_kind text, p_id uuid, p_fold boolean, p_label text default '')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_kind not in ('message', 'plan') then raise exception '보관할 수 없는 종류입니다.' using errcode = '22023'; end if;
  if p_fold then
    insert into private.sales_desk_folds (owner_id, kind, ref_id, label)
    values (auth.uid(), p_kind, p_id, left(coalesce(p_label, ''), 200))
    on conflict (owner_id, kind, ref_id) do update set label = excluded.label, folded_at = now();
  else
    delete from private.sales_desk_folds where owner_id = auth.uid() and kind = p_kind and ref_id = p_id;
  end if;
end $$;

-- 내 보관함 (최근 보관 순 · 최대 200건)
create or replace function public.sales_desk_folds()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public.is_active_member() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('kind', f.kind, 'id', f.ref_id, 'label', f.label, 'folded_at', f.folded_at) order by f.folded_at desc)
    from (select * from private.sales_desk_folds where owner_id = auth.uid() order by folded_at desc limit 200) f
  ), '[]'::jsonb) end
$$;

revoke all on function public.sales_desk_fold(text, uuid, boolean, text) from public, anon;
revoke all on function public.sales_desk_folds() from public, anon;
grant execute on function public.sales_desk_fold(text, uuid, boolean, text) to authenticated;
grant execute on function public.sales_desk_folds() to authenticated;
