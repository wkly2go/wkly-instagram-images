# 장애 대응 순서

인트라넷이 안 열리거나 '불러오는 중'에서 멈출 때 보는 한 장. (2026-11-19 · 같은 날 새벽 장애 뒤 작성)

## 1. 어디가 문제인지 가르기 (2분)

| 보이는 것 | 뜻 | 할 일 |
| --- | --- | --- |
| 화면 자체가 안 뜸(흰 화면 · 주소 오류) | Cloudflare Pages 쪽 | Cloudflare 대시보드 › Pages › 배포 상태 확인 · 직전 배포로 되돌리기 |
| 로그인 화면은 뜨는데 로그인이 안 됨 · 계속 '불러오는 중' | Supabase(DB) 쪽 | 아래 2번 |
| 한 메뉴만 '문제가 생겼습니다' | 그 화면의 오류 | '다시 시도' · 다른 메뉴는 그대로 사용 · 오류 글을 개발 세션에 전달 |
| '새 버전으로 바뀌었습니다' | 배포 뒤 예전 창 | '새 버전으로 열기' |

## 2. DB 가 느리거나 멈췄을 때

1. Supabase 대시보드 › 프로젝트 `hophgcpszenrvchvbkav` › **Reports › Database** 에서 CPU · 메모리 · Disk IO 를 봅니다.
   Disk IO 가 바닥(0%)이면 쓰기가 몰린 것입니다.
2. 급한 불 끄기 — SQL Editor 에서 대량 수집부터 멈춥니다.
   ```sql
   update private.design_g2b_sync set state = state || '{"paused":true}' where kind in ('mall','items');
   select cron.alter_job(jobid, active := false) from cron.job where jobname in ('design_g2b_mall','design_g2b_catalog');
   ```
3. 그래도 응답이 없으면 **Project Settings › General › Restart project**. 보통 3~10분.
4. 재시작 뒤 15분은 DB 구조 변경(마이그레이션)을 하지 않습니다. 화면이 붙은 뒤에 원인을 봅니다.

## 3. 원인 찾기

- 예약 작업 실패: `select jobname, status, return_message, start_time from cron.job_run_details d join cron.job j using (jobid) where status = 'failed' order by start_time desc limit 50;`
- 느린 조회: 재시작하면 통계가 지워지므로 로그(Logs › Postgres)에서 `duration:` · `startup timeout` 을 찾습니다.
- 서버 지킴이 기록: `select * from private.server_health_log order by id desc limit 20;`
- 능력 지표의 안정성 줄(관리 › 능력 지표)에서 어떤 장치가 빠졌는지 봅니다.

## 4. 저절로 도는 안전장치

| 장치 | 하는 일 |
| --- | --- |
| 서버 지킴이 (5분) | 예약 작업의 시간 초과 · 느린 실행을 보고 대표에게 알림(한 시간에 한 번) + 나라장터 수집을 하루 쉼 |
| 수집 자동 멈춤 | DB 가 바쁘면 그날 수집을 건너뜀 · 저장 한 번이 5초를 넘기면 그날 멈춤 |
| 서버 밖 감시 (깃허브 · 10분) | 밖에서 로그인 서버와 DB 응답을 확인. 세 번 연속 실패하면 깃허브가 실패 메일을 보내고 저장소에 이슈를 엶 |
| 실행 기록 정리 | 예약 작업 기록을 사흘치만 남김 |
| 화면 오류 막이 | 한 화면 · 한 칸이 멈춰도 나머지는 그대로 |

## 5. 다시 생기지 않게

- DB 구조 변경은 사람이 덜 쓰는 저녁에 한 번에 적용합니다.
- 대량 자료 수집은 새벽에 조금씩만. 늘리려면 사흘 치 기록을 본 뒤에.
- 장애를 겪었으면 `app_settings` 의 `last_incident` 에 시각과 한 줄 메모를 적습니다(능력 지표가 이 날짜부터 다시 셉니다).
- 백업: Supabase Pro 는 매일 자동 백업(7일). 대시보드 › Database › Backups 에서 목록이 쌓이는지 달마다 확인합니다.

## 연락

- Supabase 상태: https://status.supabase.com
- Cloudflare 상태: https://www.cloudflarestatus.com
