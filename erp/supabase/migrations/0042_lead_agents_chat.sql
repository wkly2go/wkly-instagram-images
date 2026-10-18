-- 0042 · 팀장 AI 채팅 참여 (대표 지시 2026-10-18 "채팅방에 각 팀장들도 참여 … 권한과 책임을 부여")
-- 1) 팀장 AI 4명에게 자기 계정(로그인 불가 · AI 팀원)을 만들어 채팅방 · 1:1 대화에 직접 참여하고 자기 이름으로 답한다.
--    이름 = 채팅 호출명(@마케팅팀장 …) 이라 기존 '@이름' 호출 · 1:1 대화 흐름이 그대로 동작한다.
-- 2) agent_roster.home.profile_id 로 팀장 ↔ 계정 연결.
-- 3) agent_actions: AI 가 채팅 · 지시로 한 일(쓰기 작업)의 기록 — 책임 추적. 관리자 · 해당 팀 사람 팀장이 봄.

do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select * from (values
      ('LEAD-MKT', '마케팅팀장',   'ai-lead-mkt@thewklyn.com', '마케팅·영업 팀장 (AI)'),
      ('LEAD-CON', '콘텐츠팀장',   'ai-lead-con@thewklyn.com', '콘텐츠 제작 팀장 (AI)'),
      ('LEAD-INT', '인테리어팀장', 'ai-lead-int@thewklyn.com', '인테리어 팀장 (AI)'),
      ('LEAD-RES', '리서치팀장',   'ai-lead-res@thewklyn.com', '공통 리서치 팀장 (AI)')
    ) as t(code, name, email, title)
  loop
    select id into v_id from auth.users where email = r.email;
    if v_id is null then
      v_id := gen_random_uuid();
      -- 로그인하지 않는 서비스 계정: 임의 비밀번호 + 영구 차단 (서버가 service_role 로만 글을 씀)
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', r.email,
        extensions.crypt(encode(extensions.gen_random_bytes(24), 'base64'), extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', r.name, 'agent', true),
        'infinity', now(), now(), '', '', '', ''
      );
    end if;
    -- 프로필은 on_auth_user_created 트리거가 만든다
    update public.profiles
       set name = r.name, title = r.title, is_agent = true, active = true, role = 'member'
     where id = v_id;
    update public.agent_roster
       set home = coalesce(home, '{}'::jsonb) || jsonb_build_object('profile_id', v_id), updated_at = now()
     where code = r.code;
  end loop;
end $$;

create table if not exists public.agent_actions (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  agent_id    uuid references public.profiles(id) on delete set null,
  lead_code   text,
  team        text,
  requester_id uuid references public.profiles(id) on delete set null,
  source      text not null default 'chat' check (source in ('chat', 'instruction')),
  room_id     uuid,
  tool        text not null,
  input       jsonb,
  ok          boolean not null default true,
  result      text
);
create index if not exists agent_actions_created_idx on public.agent_actions (created_at desc);
alter table public.agent_actions enable row level security;

-- 보기: 관리자 · 요청한 본인 · 그 팀 사람 팀장
create policy agent_actions_select on public.agent_actions for select to authenticated using (
  public.is_admin()
  or requester_id = auth.uid()
  or exists (select 1 from public.agent_roster r where r.code = agent_actions.lead_code and r.owner_id = auth.uid())
);
-- 쓰기는 서버(service_role)만
