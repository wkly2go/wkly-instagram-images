-- 서버 부하 줄이기 (2026-11-19 대표 '로그인됐어 상황 파악해서 서버 빠르게 운영가능하게 만들어').
-- 11/19 새벽 03:37(KST)부터 DB 디스크 입출력 예산이 바닥나 모든 요청이 10~90초 → 로그인 불가 → 프로젝트 재시작으로 복구.
-- 그 시각 나라장터 쇼핑몰 · 자재목록 대량 수집(design_g2b_mall · catalog, 새벽 1~6시)이 뒤에서 돌고 있었음 → 그 예약은 꺼 둠(active false · state.paused).
-- 여기서는 늘 도는 부하를 줄임:
--  ① 슬랙 가져오기 매분 → 2분마다 (0090 의 '실시간'은 2분 지연으로 충분)
--  ② 주소 좌표 변환 매분 → 5분마다 (한 번에 30건씩 처리 · 급하지 않음)
--  ③ 예약 작업 실행 기록(cron.job_run_details · 26MB · 지운 적 없음)을 사흘치만 남기고 매일 지움
--  ④ 대량 수집 예약 두 개는 꺼진 채로 둠(다시 켤 때는 대표 승인 · 하루 쓰기량 계획 먼저)
select cron.alter_job((select jobid from cron.job where jobname = 'wkly_slack_sync'), schedule := '*/2 * * * *')
where exists (select 1 from cron.job where jobname = 'wkly_slack_sync');
select cron.alter_job((select jobid from cron.job where jobname = 'geocode_tick'), schedule := '*/5 * * * *')
where exists (select 1 from cron.job where jobname = 'geocode_tick');
select cron.alter_job(jobid, active := false) from cron.job where jobname in ('design_g2b_mall', 'design_g2b_catalog');
update private.design_g2b_sync set state = state || '{"paused":true}'::jsonb where kind in ('mall', 'items');

create or replace function private.cron_history_cleanup()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  -- 한 번에 2만 줄까지만 (쓰기 몰림 방지) · 남은 것은 다음 날 이어서
  delete from cron.job_run_details where runid in (
    select runid from cron.job_run_details where end_time < now() - interval '3 days' order by runid limit 20000);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.cron_history_cleanup() from public, anon, authenticated;

select cron.unschedule('wkly_cron_history_cleanup') where exists (select 1 from cron.job where jobname = 'wkly_cron_history_cleanup');
-- 매일 15:20 KST (사람이 덜 쓰고 새벽 대량 작업과도 겹치지 않는 시각 · 06:20 UTC)
select cron.schedule('wkly_cron_history_cleanup', '20 6 * * *', 'select private.cron_history_cleanup()');

-- ⑤ 영업 맥박 매분 → 2분마다 (한 번에 평소 1.4초 · 예약 작업 DB 시간의 대부분). 정해진 시각 단계는 grace_min 4~50분이라 놓치지 않음
select cron.alter_job((select jobid from cron.job where jobname = 'wkly_sales_pulse'), schedule := '*/2 * * * *')
where exists (select 1 from cron.job where jobname = 'wkly_sales_pulse');
