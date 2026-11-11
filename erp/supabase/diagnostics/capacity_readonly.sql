-- 더위클리 Supabase 용량 진단 (읽기 전용)
-- 마이그레이션이 아닙니다. SQL Editor에서 필요한 SELECT 한 문장씩 실행합니다.
-- DB/Storage 크기만 확인하며 Egress·과금 기간 사용량은 대시보드에서 확인합니다.
-- 업무 본문, 비밀 값, 파일 경로를 조회하지 않습니다.
-- 실행·해석 안내: ../../docs/SUPABASE_CAPACITY_OPTIMIZATION.md

-- 1. 현재 DB 크기 (Storage 파일 크기·WAL 포함 디스크 전체 크기가 아님)
select
  current_database() as database_name,
  pg_database_size(current_database()) as database_bytes,
  pg_size_pretty(pg_database_size(current_database())) as database_size;

-- 2. 총 크기가 큰 사용자 테이블 20개
-- 행 수는 통계 추정값입니다. dead rows를 회수 가능 바이트로 해석하지 않습니다.
-- table_and_toast_size에는 TOAST 등이 포함되고, index_size는 별도로 표시합니다.
select
  schemaname,
  relname as table_name,
  n_live_tup as estimated_live_rows,
  n_dead_tup as estimated_dead_rows,
  pg_size_pretty(pg_table_size(relid)) as table_and_toast_size,
  pg_size_pretty(pg_indexes_size(relid)) as index_size,
  pg_total_relation_size(relid) as total_bytes,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 20;

-- 3. 파일이 있는 버킷별 개수와 메타데이터상 총 파일 크기
-- 숫자로 읽을 수 없는 크기는 합계에서 제외하고 해당 객체 수를 함께 표시합니다.
-- 현재 메타데이터 합계이며 청구 집계나 실제 미사용 파일 용량을 뜻하지 않습니다.
-- 숫자 변환 전에 형식을 확인하고 큰 합계를 위해 numeric을 사용합니다.
with bucket_usage as (
  select
    bucket_id,
    count(*) as object_count,
    count(*) filter (
      where coalesce(metadata->>'size', '') !~ '^[0-9]+$'
    ) as objects_without_numeric_size,
    coalesce(sum(
      case
        when metadata->>'size' ~ '^[0-9]+$'
        then (metadata->>'size')::numeric
        else 0
      end
    ), 0) as reported_bytes
  from storage.objects
  group by bucket_id
)
select
  bucket_id,
  object_count,
  objects_without_numeric_size,
  reported_bytes,
  pg_size_pretty(reported_bytes) as reported_size
from bucket_usage
order by reported_bytes desc;
