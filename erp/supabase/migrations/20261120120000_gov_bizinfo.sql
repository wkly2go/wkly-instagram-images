-- 2026-11-20 정부지원사업: 기업마당 공고 수집 (대표가 data.go.kr 15157820 '중소기업 지원사업 공고 조회 서비스' 활용신청 · 승인 확인)
-- 요청 주소 apis.data.go.kr/1421000/bizinfo/pblancBsnsService (예전에 시험한 mssBizService_v2 는 다른 서비스 15113297 이었음)
-- 기존 public_data_get + 금고 DATA_GO_KR_KEY · 최신 등록 순 · 매일 2쪽(200건) · 처음 한 번만 p_pages 로 전체(약 14쪽)
-- 판정은 K-Startup 과 같은 gov_apply_fit (AI 없음). 마감일 지난 신규 · 검토 중은 '마감'.

create or replace function public.gov_sync_bizinfo(p_pages int default 2)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare pg int := 1; r jsonb; it jsonb; n int := 0; tot int := 0; v_id uuid; v_period text; v_title text; v_region text; v_max int := least(greatest(coalesce(p_pages, 2), 1), 20);
begin
  loop
    r := public.public_data_get('1421000/bizinfo/pblancBsnsService',
      jsonb_build_object('pageNo', pg::text, 'numOfRows', '100', 'dataType', 'json'), 'GOV_SYNC');
    exit when jsonb_typeof(r #> '{body,response,body,items,item}') is distinct from 'array';
    tot := coalesce((r #>> '{body,response,body,totalCount}')::int, 0);
    for it in select * from jsonb_array_elements(r #> '{body,response,body,items,item}') loop
      continue when nullif(it->>'pblancId', '') is null or nullif(it->>'pblancNm', '') is null;
      v_title := it->>'pblancNm';
      v_region := (regexp_match(v_title, '^\[([^\]]{1,12})\]'))[1];
      v_period := coalesce(it->>'reqstBeginEndDe', '');
      insert into public.gov_programs (source, source_id, title, org, supervising, category, region, target,
          summary, apply_start, apply_end, detail_url, apply_url, contact, raw)
      values ('bizinfo', it->>'pblancId', v_title, nullif(it->>'excInsttNm', ''), nullif(it->>'jrsdInsttNm', ''), nullif(it->>'pldirSportRealmLclasCodeNm', ''),
          v_region, nullif(it->>'trgetNm', ''),
          nullif(btrim(regexp_replace(replace(replace(coalesce(it->>'bsnsSumryCn', ''), '&nbsp;', ' '), '&amp;', '&'), '<[^>]+>', ' ', 'g')), ''),
          case when v_period ~ '^\d{4}-\d{2}-\d{2}' then substr(v_period, 1, 10)::date end,
          case when v_period ~ '~\s*\d{4}-\d{2}-\d{2}' then (regexp_match(v_period, '~\s*(\d{4}-\d{2}-\d{2})'))[1]::date end,
          nullif(it->>'pblancUrl', ''), nullif(it->>'rceptEngnHmpgUrl', ''), nullif(it->>'refrncNm', ''), it)
      on conflict (source, source_id) do update set title = excluded.title, org = excluded.org, supervising = excluded.supervising, category = excluded.category,
          region = excluded.region, target = excluded.target, summary = excluded.summary, apply_start = excluded.apply_start, apply_end = excluded.apply_end,
          detail_url = excluded.detail_url, apply_url = excluded.apply_url, contact = excluded.contact, raw = excluded.raw
        -- 바뀐 것이 없으면 다시 쓰지 않음 (쓰기 부하 줄이기)
        where public.gov_programs.raw is distinct from excluded.raw
      returning id into v_id;
      if v_id is not null then perform public.gov_apply_fit(v_id); n := n + 1; end if;
      v_id := null;
    end loop;
    exit when pg * 100 >= tot or pg >= v_max;
    pg := pg + 1;
  end loop;
  update public.gov_programs set status = '마감' where source = 'bizinfo' and apply_end < (now() at time zone 'Asia/Seoul')::date and status in ('신규', '검토 중');
  return jsonb_build_object('source', 'bizinfo', 'upserted', n, 'open_total', tot, 'pages', pg);
end $$;
revoke all on function public.gov_sync_bizinfo(int) from public, anon, authenticated;

-- 화면 '지금 다시 받기'는 두 곳 모두
create or replace function public.gov_refresh()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare a jsonb; b jsonb;
begin
  if not public.is_admin() then raise exception '관리자만 실행할 수 있습니다'; end if;
  a := public.gov_sync_kstartup();
  b := public.gov_sync_bizinfo(2);
  -- 화면은 upserted 합계를 읽음
  return jsonb_build_object('upserted', coalesce((a->>'upserted')::int, 0) + coalesce((b->>'upserted')::int, 0), 'kstartup', a, 'bizinfo', b);
end $$;

-- 매일 06:47 KST (K-Startup 06:35 뒤 · 정각 · 5분 단위 피함)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gov_sync_bizinfo') then perform cron.unschedule('gov_sync_bizinfo'); end if;
  perform cron.schedule('gov_sync_bizinfo', '47 21 * * *', 'select public.gov_sync_bizinfo(2)');
end $$;
