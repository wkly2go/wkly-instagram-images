-- 2026-11-19 대표 지시 '능력 지표 내용 검토해서 점수 올릴 수 있도록 개발 착수해'
-- 점수를 꾸미지 않고 실제 원인을 고친다 (기준선 · 계산식은 그대로).
--
-- ① 안정성: 예약 작업이 같은 분에 한꺼번에 시작해 'job startup timeout' 으로 실패
--    매 정각 · 10분 · 15분마다 7~10개가 동시에 DB 연결을 열었다(연결 60 · 최소 컴퓨트).
--    11/19 16:15(KST)에도 6개가 같은 분에 시작하다 실패. 사람이 시각을 느끼는 작업(할 일 알람 · 저장 알림 · 영업 맥박)은 그대로 두고
--    시각이 상관없는 작업만 1~8분씩 비켜 한 분에 많아야 4~5개만 시작하게 한다. 설계 구역 예약(design_*)은 건드리지 않는다.
do $$
declare r record;
begin
  for r in select * from (values
      ('wkly_slack_sync',       '1,3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,35,37,39,41,43,45,47,49,51,53,55,57,59 * * * *'),   -- 짝수 분은 영업 맥박 → 홀수 분으로
      ('wkly_server_health',    '2,7,12,17,22,27,32,37,42,47,52,57 * * * *'),
      ('geocode_tick',          '3,8,13,18,23,28,33,38,43,48,53,58 * * * *'),
      ('wkly_gdrive_sync',      '4,9,14,19,24,29,34,39,44,49,54,59 * * * *'),
      ('wkly_drive_tidy',       '6,16,26,36,46,56 * * * *'),
      ('wkly_mail_link_threads','6,16,26,36,46,56 * * * *'),
      ('wkly_absent_alert',     '7,17,27,37,47,57 * * * *'),
      ('wkly_gmail_sync',       '8,18,28,38,48,58 * * * *')
    ) as v(name, sched)
  loop
    if exists (select 1 from cron.job where jobname = r.name) then
      perform cron.alter_job(job_id := (select jobid from cron.job where jobname = r.name), schedule := r.sched);
    end if;
  end loop;
end $$;

-- ② 실사용(알림 읽음): 같은 요약 알림이 날마다 새 줄로 쌓임
--    '오늘 확인할 할 일 3건' · '기한 초과 2건' · '지급 예정 1건' · AI 보고(같은 작업 · 날짜만 다름)는 숫자 · 날짜만 달라 제목이 같지 않아
--    합치는 장치(notifications_merge_repeat)를 지나쳤다 → 30일 1,888건 중 이런 반복 요약이 대부분.
--    이제 숫자 · 날짜 · 결과(완료/실패)만 다른 요약은 '같은 알림'으로 보고, 아직 안 읽은 앞의 것을 새 내용으로 바꿔 맨 위로 올린다.
--    (읽음으로 바꾸지 않는다 — 줄 수만 줄어든다. 새 할 일 배정 · 결재 · 멘션 · 할 일 알람처럼 하나하나가 다른 알림은 그대로)
create or replace function private.notification_family(p_kind text, p_title text) returns text
language sql immutable set search_path = '' as $$
  select case
    -- 날마다 오는 요약: 정해 둔 머리말만
    when p_kind in ('할 일', '알람', '결제')
     and p_title ~ '^(오늘 요약|오늘 확인할 할 일|기한 초과|출근 기록이 없습니다|오늘 업무 일지가 없습니다|재무 확인|지급 예정|미수금|기한 지난 결제|업무 쏠림)'
      then p_kind || '|' || regexp_replace(p_title, '[0-9]+', '#', 'g')
    -- AI 보고 · 에이전트 실패: 같은 작업이면 날짜 · 결과가 달라도 한 줄
    when p_kind in ('일일 보고', '시스템')
      then p_kind || '|' || regexp_replace(regexp_replace(regexp_replace(p_title, '^⚠\s*', ''), '\s*·\s*(완료|성공|일부 실패|실패|부분 완료|변동 없음)\s*$', ''), '[0-9]+', '#', 'g')
    else null
  end
$$;
revoke all on function private.notification_family(text, text) from public, anon, authenticated;

create or replace function private.notifications_merge_repeat()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare hit bigint; fam text := private.notification_family(new.kind, new.title);
begin
  -- 같은 사람 · 같은 종류 · 같은 제목(또는 같은 요약 묶음)의 안 읽은 알림이 36시간 안에 있으면 새로 쌓지 않고 그 알림을 새 내용으로 바꿔 맨 위로
  select id into hit from public.notifications
   where user_id = new.user_id and kind = new.kind and read_at is null
     and created_at > now() - interval '36 hours'
     and (title = new.title or (fam is not null and private.notification_family(kind, title) = fam))
   order by created_at desc limit 1;
  if hit is not null then
    update public.notifications
       set created_at = now(), title = new.title, body = coalesce(new.body, body), link = coalesce(new.link, link)
     where id = hit;
    return null;
  end if;
  return new;
end $$;
