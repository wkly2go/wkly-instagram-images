-- AI 크레딧 만료일 자동 넘김 (대표 지시 2026-11-27 '회사 계정은 아직 많이 남았어' · '구독을 지속할거야 걱정하지마')
-- 문제: api-agents · video-worker 는 잔액이 아니라 설정 anthropic_free_credit 의 grants[].expires_at 을 보고 멈춘다.
--        구독이 이어져 매달 새 크레딧이 들어와도 적어 둔 날짜가 지나면 AI 가 전부 멈춘다.
-- 해결: 설정에 renews_monthly true 가 있으면, 끝나기 3일 전인 크레딧의 만료일을 한 달씩 뒤로 넘긴다(하루 한 번).
--        넘긴 날짜는 Console 에서 읽은 값이 아니라 '매달 갱신' 가정이므로 그 grant 에 assumed true 를 남긴다.
--        구독을 끊으면 renews_monthly 를 false 로 바꾸면 되고, 그때는 적힌 날짜에 예전처럼 멈춘다.
--        실제로 크레딧이 떨어지면 Anthropic 이 요청을 거절한다 → api-agents 가 '한도 초과' 로 기록하고 관리자에게 하루 한 번 알림(기존 동작 · 결제 없음).
--        크레딧 안에서만 쓰는 원칙(paid_allowed false)은 그대로 둔다. 금액은 저장소에 적지 않는다(설정에만).

-- 계산만 하는 함수 (자료를 바꾸지 않음 · 시각을 받아 시험할 수 있음)
create or replace function private.anthropic_credit_rolled(p_value jsonb, p_now timestamptz)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $$
declare
  g jsonb;
  v_out jsonb := '[]'::jsonb;
  v_exp timestamptz;
  v_new timestamptz;
  v_n int;
  v_changed boolean := false;
begin
  if p_value is null or jsonb_typeof(p_value->'grants') is distinct from 'array' then return p_value; end if;
  if coalesce(p_value->>'renews_monthly', 'false') <> 'true' then return p_value; end if;
  for g in select e from jsonb_array_elements(p_value->'grants') as t(e) loop
    v_exp := null;
    if coalesce(g->>'expires_at', '') ~ '^\d{4}-\d{2}-\d{2}' then
      begin
        v_exp := (g->>'expires_at')::timestamptz;
      exception when others then
        v_exp := null;
      end;
    end if;
    if v_exp is not null and v_exp <= p_now + interval '3 days' then
      -- 한국 시각 기준으로 처음 날짜에서 n 달 뒤 (달마다 더하면 말일이 밀리므로 처음 날짜에서 계산)
      v_n := 0;
      v_new := v_exp;
      while v_new <= p_now + interval '3 days' and v_n < 120 loop
        v_n := v_n + 1;
        v_new := ((v_exp at time zone 'Asia/Seoul') + make_interval(months => v_n)) at time zone 'Asia/Seoul';
      end loop;
      g := g || jsonb_build_object(
        'expires_at', to_char(v_new at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00',
        'assumed', true);
      v_changed := true;
    end if;
    v_out := v_out || jsonb_build_array(g);
  end loop;
  if not v_changed then return p_value; end if;
  return p_value || jsonb_build_object('grants', v_out, 'rolled_at', to_char(p_now at time zone 'Asia/Seoul', 'YYYY-MM-DD'));
end $$;

-- 하루 한 번: 바뀔 것이 있을 때만 설정을 고친다 (알림 없음)
create or replace function private.anthropic_credit_roll()
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $$
declare v_cur jsonb; v_next jsonb;
begin
  select value into v_cur from public.app_settings where key = 'anthropic_free_credit' for update;
  if v_cur is null then return false; end if;
  v_next := private.anthropic_credit_rolled(v_cur, now());
  if v_next is not distinct from v_cur then return false; end if;
  update public.app_settings set value = v_next, updated_at = now() where key = 'anthropic_free_credit';
  return true;
end $$;

revoke all on function private.anthropic_credit_rolled(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function private.anthropic_credit_roll() from public, anon, authenticated;

-- 구독을 계속한다는 대표 지시를 설정에 남긴다 (이미 값이 있으면 건드리지 않음)
update public.app_settings
   set value = value || jsonb_build_object('renews_monthly', true), updated_at = now()
 where key = 'anthropic_free_credit' and not (value ? 'renews_monthly');

-- 매일 08:41 (한국 시각) — AI 팀원 5분 주기(3 · 8 · 13 …분)와 겹치지 않는 분
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'anthropic_credit_roll') then
    perform cron.schedule('anthropic_credit_roll', '41 23 * * *', 'select private.anthropic_credit_roll()');
  end if;
end $$;
