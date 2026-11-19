-- 홈페이지 직접 문의 → '상담협의' 프로젝트 자동 (2026-11-19 대표 지시 '개선해' · 기획 '메신저 협업 단순화 · 프로젝트 연결 · 영업 별 5개' 1주차 · 결정 ② '직접 문의는 바로 자동')
--  - 대상: kind '문의'(구독 · 리포트 신청 제외) · 상태 '신규' · 내부 시험(is_test) 아님 · 들어온 지 3일 안 · 아직 프로젝트 없음
--  - 같은 메일 주소로 60일 안에 만든 열린 프로젝트가 있으면 새로 만들지 않고 거기에 붙임
--  - 담당: app_settings 'inquiry_owner'(지금 백선미) · 구분: 문의가 들어온 홈페이지(TW · AR) · 거래처: 이름이 같은 거래처가 있으면 연결
--  - 프로젝트를 만들면 대화방 · 드라이브 폴더는 원래 규칙대로 자동(project_room_sync · gdrive ensureNewProjects)
--  - 담당자에게 '[문의 답장] … — 24시간 안' 할 일 하나(알림은 할 일 배정 알림 · 답장 독촉은 기존 문의 메일 추적이 함)
--  - 문의 상태는 바꾸지 않음(영업 대상 등록 · 메일 응대 추적이 '신규'를 보고 움직임). 메일은 보내지 않음. 지우는 것 없음
alter table public.web_inquiries add column if not exists project_id uuid references public.projects (id) on delete set null;
create index if not exists web_inquiries_project on public.web_inquiries (project_id) where project_id is not null;

create or replace function private.sales_inquiry_projects(p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q record; v_owner uuid; v_project uuid; v_client uuid; v_name text; v_cat text; v_code text;
  made int := 0; linked int := 0; out jsonb := '[]'::jsonb;
begin
  select nullif(value #>> '{}', '')::uuid into v_owner from public.app_settings where key = 'inquiry_owner';
  if v_owner is not null and not exists (select 1 from public.profiles where id = v_owner and active and not coalesce(is_agent, false)) then v_owner := null; end if;
  for q in
    select * from public.web_inquiries w
    where w.kind = '문의' and w.status = '신규' and not coalesce(w.is_test, false) and w.project_id is null
      and coalesce(w.received_at, w.submitted_at) > now() - interval '3 days'
    order by coalesce(w.received_at, w.submitted_at)
    limit 20
  loop
    -- 같은 주소의 열린 프로젝트 (60일 안)
    select w2.project_id into v_project from public.web_inquiries w2 join public.projects p on p.id = w2.project_id
    where w2.id <> q.id and lower(btrim(w2.email)) = lower(btrim(coalesce(q.email, ''))) and coalesce(q.email, '') <> ''
      and p.status in ('상담협의', '문의', '진행', 'NIC') and p.created_at > now() - interval '60 days'
    order by p.created_at desc limit 1;
    v_name := left(btrim(coalesce(nullif(btrim(q.brand), ''), split_part(coalesce(q.email, ''), '@', 2), '웹 문의') || ' · ' || coalesce(nullif(btrim(q.title), ''), nullif(btrim(q.category), ''), '문의')), 80);
    if v_project is not null then
      if not p_dry then update public.web_inquiries set project_id = v_project, assignee = coalesce(assignee, v_owner), updated_at = now() where id = q.id; end if;
      linked := linked + 1;
      out := out || jsonb_build_object('inquiry', q.id, 'project', v_project, 'how', '기존 프로젝트에 붙임');
      continue;
    end if;
    v_cat := case
      when coalesce(q.category, '') || coalesce(q.title, '') ~ '팝업|스토어|매장|부스|전시' then '팝업'
      when coalesce(q.category, '') || coalesce(q.title, '') ~ '홍보|광고|캠페인|마케팅' then '캠페인'
      when coalesce(q.category, '') || coalesce(q.title, '') ~ '콘텐츠|인터뷰|영상|촬영|매거진' then '콘텐츠'
      else '기타' end;
    select c.id into v_client from public.clients c
    where nullif(btrim(q.brand), '') is not null and lower(replace(c.name, ' ', '')) = lower(replace(q.brand, ' ', ''))
    limit 1;
    if p_dry then
      made := made + 1;
      out := out || jsonb_build_object('inquiry', q.id, 'name', v_name, 'category', v_cat, 'client', v_client, 'owner', v_owner);
      continue;
    end if;
    insert into public.projects (name, division, category, status, owner_id, client_id, created_by, description)
    values (v_name, case when q.site = 'AR' then 'AR' else 'TW' end, v_cat, '상담협의', v_owner, v_client, v_owner,
      left(concat_ws(E'\n',
        '[자동] 홈페이지 문의로 만든 상담협의 프로젝트 · ' || to_char(coalesce(q.received_at, q.submitted_at) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
        '문의 종류: ' || nullif(btrim(q.category), ''),
        '보낸 곳: ' || concat_ws(' · ', nullif(btrim(q.brand), ''), nullif(btrim(q.org_type), ''), nullif(btrim(q.email), ''), nullif(btrim(q.phone), '')),
        nullif(btrim(q.detail), '')), 4000))
    returning id, code into v_project, v_code;
    update public.web_inquiries set project_id = v_project, assignee = coalesce(assignee, v_owner), updated_at = now() where id = q.id;
    if v_owner is not null then
      insert into public.tasks (project_id, title, assignee_id, due_date, status, memo, created_by, origin_ref, phase)
      values (v_project, left('[문의 답장] ' || coalesce(nullif(btrim(q.brand), ''), q.email, '웹 문의') || ' — 24시간 안', 200), v_owner,
        ((coalesce(q.received_at, q.submitted_at) + interval '1 day') at time zone 'Asia/Seoul')::date, '할 일',
        '영업·수주 › 문의함에서 문의 내용을 보고 답장을 써 주세요. 메일로 답하면 문의가 자동으로 응대 완료됩니다.', v_owner, 'inquiry:' || q.id, '상담');
    end if;
    made := made + 1;
    out := out || jsonb_build_object('inquiry', q.id, 'project', v_project, 'code', v_code);
  end loop;
  return jsonb_build_object('made', made, 'linked', linked, 'dry', p_dry, 'items', out);
end $$;
revoke all on function private.sales_inquiry_projects(boolean) from public;

insert into private.sales_ops_steps (step, label, call, every_min, grace_min, enabled)
values ('inquiry_projects', '웹 문의 → 상담협의 프로젝트', 'private.sales_inquiry_projects()', 5, 10, true)
on conflict (step) do nothing;
