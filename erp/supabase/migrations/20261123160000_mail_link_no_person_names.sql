-- 메일 → 프로젝트 자동 연결: 팀원 이름은 맞춤 낱말로 쓰지 않는다 (2026-11-23 대표 '내부 이메일 수집과 같은 것들에 오류가 있어')
-- 프로젝트 이름 'RS2610-04 인테리어 디자인 리서치 · 이채원'의 '이채원'이 다른 프로젝트에 없는 낱말이라,
-- 서명 · 인사말에 그 이름이 든 메일(포켓몬 견적 · 시트커팅 문의 등 35통)이 모두 이 프로젝트에 붙었다.
-- 고침: 느슨한 맞춤(match_projects_loose)에서 팀원 이름과 같은 낱말은 뺀다 → 그렇게 붙은 메일을 떼고 다시 맞춘다.
-- 그 부분만 바꿔 다시 만든다(같은 이름 · 같은 인자) · 지우는 표 · 함수 없음 · 손으로 고친 연결(mail_apply_overrides)은 그대로 적용된다.
do $$
declare def text;
begin
  def := pg_catalog.pg_get_functiondef('public.match_projects_loose(text)'::regprocedure);
  if position('pr.name' in def) = 0 then
    def := replace(def, 'tok.t not in (select w from stop)',
      $r$tok.t not in (select w from stop) and not exists (select 1 from public.profiles pr where replace(pr.name, ' ', '') = tok.t)$r$);
    if position('pr.name' in def) = 0 then raise exception 'match_projects_loose: 바꿀 자리를 찾지 못함'; end if;
    execute def;
  end if;
end $$;

-- 팀원 이름 낱말 때문에 붙었던 연결을 떼고(이름 · 연번이 글에 그대로 있는 메일은 둠) 다시 맞춘다
do $$
declare r record; ids text[];
begin
  for r in
    select distinct p.id
    from public.projects p, regexp_split_to_table(p.name, '[\s·,()/\-_]+') t
    where exists (select 1 from public.profiles pr where replace(pr.name, ' ', '') = t)
  loop
    select array_agg(m.id) into ids from public.mail_index m
     where r.id = any (m.project_ids)
       and not (r.id = any (public.match_projects(concat_ws(' ', m.subject, m.snippet, array_to_string(m.attachments, ' ')))));
    if ids is null then continue; end if;
    update public.mail_index set project_ids = array_remove(project_ids, r.id) where id = any (ids);
    -- 비게 된 메일은 다시 맞춤 (글 · 거래처 한 곳 · 같은 대화 순서 · 트리거 mail_index_link)
    update public.mail_index set subject = subject where id = any (ids) and cardinality(project_ids) = 0;
  end loop;
end $$;
