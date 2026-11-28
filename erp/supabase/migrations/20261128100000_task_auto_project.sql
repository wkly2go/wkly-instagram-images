-- 할 일 프로젝트 자동 지정 (2026-11-28 대표 지시 '인트라넷에 프로젝트를 자동으로 지정해')
--  프로젝트 없이 만들어진 할 일(사람 · AI 비서 · 예약 AI 모두)에 프로젝트를 붙인다. 순서:
--   ① 제목 · 메모의 연번(AR2611-06 꼴) ② 메일 연결과 같은 엄격한 이름 맞춤(match_projects · 한 곳일 때)
--   ③ 제목만으로 느슨한 이름 맞춤(match_projects_loose · 한 곳일 때 · 메모는 서명 · 인사말이 섞여 쓰지 않음)
--   ④ 낱말 규칙(app_settings 'task_project_rules' · 위에서부터 처음 맞는 규칙 · 제목 먼저, 그다음 메모)
--   ⑤ 그래도 없으면 기본 프로젝트(규칙의 fallback · 경영업무)
--  넣을 때만 정한다(나중에 사람이 '프로젝트 없음'으로 바꾼 것은 그대로 둠). 설계 공정에서 온 할 일은 건드리지 않음.
--  규칙은 관리자가 app_settings 에서 고칠 수 있음(코드 배포 없이).

insert into public.app_settings (key, value, updated_at) values ('task_project_rules', jsonb_build_object(
  'fallback', 'AR0000',
  'rules', jsonb_build_array(
    jsonb_build_object('code', 'AR2609-04', 'words', jsonb_build_array('PUNIKKO', '홍대 AK')),
    jsonb_build_object('code', 'AR0000', 'words', jsonb_build_array('인터넷신문', '[매거진]', '웹매거진', '[세무', '원천세', '부가세', '통신판매업', '전자상거래', '연구노트', '사업자등록', '등기', '[계약 검토]')),
    jsonb_build_object('code', 'TW2610-03', 'words', jsonb_build_array('[대관', '대관 후보', '대관', '보라빌딩', '공간 미팅')),
    jsonb_build_object('code', 'TW2610-01', 'words', jsonb_build_array('[CRM]', '[크루', '크루', '파트너스', '공간 제휴')),
    jsonb_build_object('code', 'TW2610-05', 'words', jsonb_build_array('뉴스레터')),
    jsonb_build_object('code', 'TW2610-02', 'words', jsonb_build_array('[반응]', '[금요 촬영]', '촬영 목록', '인스타그램', '릴스', '캐러셀', 'SNS')),
    jsonb_build_object('code', 'RS2610-07', 'words', jsonb_build_array('[백링크', '백링크', '[게시]', '검색 노출', 'SEO', '브런치', 'LinkedIn', '네이버 블로그', '광고', '애즈', '마케팅', '홍보', '콘텐츠')),
    jsonb_build_object('code', 'RS2610-03', 'words', jsonb_build_array('입찰', '나라장터', '영업', '수주', '제안서')),
    jsonb_build_object('code', 'RS2610-06', 'words', jsonb_build_array('인트라넷', '홈페이지', 'API', 'Vault', '인증키', 'Supabase', 'Claude', '맥미니', '개발')),
    jsonb_build_object('code', 'RS2610-01', 'words', jsonb_build_array('마감재'))
  )), now())
on conflict (key) do nothing;

create or replace function private.task_guess_project(p_title text, p_memo text)
 returns uuid
 language plpgsql
 stable
 security definer
 set search_path to ''
as $$
declare
  v_text text := coalesce(p_title, '') || ' ' || coalesce(p_memo, '');
  v_code text;
  v_id uuid;
  v_ids uuid[];
  v_rules jsonb;
  r jsonb;
  w text;
  v_part text;
begin
  -- ① 연번
  for v_code in select (regexp_matches(v_text, '\m([A-Z]{2}\d{4}-\d{2}|[A-Z]{2}0000)\M', 'g'))[1] loop
    select id into v_id from public.projects where code = v_code;
    if v_id is not null then return v_id; end if;
  end loop;
  -- ② 엄격한 이름 맞춤 (한 곳일 때만)
  begin
    v_ids := public.match_projects(v_text);
    if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
    -- ③ 제목만 느슨하게 (한 곳일 때만)
    v_ids := public.match_projects_loose(coalesce(p_title, ''));
    if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  exception when others then null; -- 맞춤 함수가 실패해도 할 일 저장은 막지 않음
  end;
  -- ④ 낱말 규칙 (제목 먼저, 그다음 메모)
  select value into v_rules from public.app_settings where key = 'task_project_rules';
  if v_rules is null then return null; end if;
  foreach v_part in array array[coalesce(p_title, ''), coalesce(p_memo, '')] loop
    for r in select e from jsonb_array_elements(coalesce(v_rules->'rules', '[]'::jsonb)) as t(e) loop
      for w in select jsonb_array_elements_text(coalesce(r->'words', '[]'::jsonb)) loop
        if w <> '' and strpos(lower(v_part), lower(w)) > 0 then
          select id into v_id from public.projects where code = r->>'code';
          if v_id is not null then return v_id; end if;
        end if;
      end loop;
    end loop;
  end loop;
  -- ⑤ 기본 프로젝트
  select id into v_id from public.projects where code = v_rules->>'fallback';
  return v_id;
end $$;
revoke all on function private.task_guess_project(text, text) from public, anon, authenticated;

create or replace function private.task_auto_project()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $$
begin
  if new.project_id is null and coalesce(new.origin_ref, '') not like 'design:%' then
    begin
      new.project_id := private.task_guess_project(new.title, new.memo);
    exception when others then null; -- 못 정해도 할 일 저장은 그대로
    end;
  end if;
  return new;
end $$;
revoke all on function private.task_auto_project() from public, anon, authenticated;

create trigger tasks_auto_project before insert on public.tasks
  for each row execute function private.task_auto_project();

-- 이미 있던 '프로젝트 없음' 할 일도 한 번 채움
update public.tasks set project_id = private.task_guess_project(title, memo)
 where project_id is null and coalesce(origin_ref, '') not like 'design:%';
