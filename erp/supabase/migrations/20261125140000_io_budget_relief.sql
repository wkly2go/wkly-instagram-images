-- 2026-11-25 수파베이스 '디스크 입출력 예산 부족' 경고(11/18 · 11/25) 대책
-- ① 5분마다 같은 분(:00 · :05 …)에 4~5개가 한꺼번에 시작해 'job startup timeout' 이 나던 것 → 두 작업을 1 · 4분 비킴
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'wkly_notify_due_tasks'), schedule := '1,6,11,16,21,26,31,36,41,46,51,56 * * * *');
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'wkly_saved_reminders'), schedule := '4,9,14,19,24,29,34,39,44,49,54,59 * * * *');
-- ② 영업 맥박에서 가장 무거운 읽기 단계 간격 늘림 (연락처 찾기 한 번 약 6초 · 연락 근거 약 1초)
update private.sales_ops_steps set every_min = 60 where step = 'contact_discovery';
update private.sales_ops_steps set every_min = 30 where step = 'contact_evidence';
