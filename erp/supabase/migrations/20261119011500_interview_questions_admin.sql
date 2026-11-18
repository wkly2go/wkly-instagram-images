-- 인터뷰 질문 은행은 관리자만 고친다 (2026-11-19 대표 지시 '관리자 전용에 만들어')
-- 메뉴를 관리자 전용 묶음(/interview-questions)으로 옮기면서, 넣기 · 고치기도 관리자만 되게 제한 정책(restrictive)을 더한다.
-- 읽기는 그대로 활성 팀원 모두(영업 담당이 브랜드별 인터뷰지를 만들 때 문안을 읽어야 함). 기존 정책은 지우지 않는다.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_interview_questions' and policyname = 'sales_interview_questions_admin_insert') then
    create policy sales_interview_questions_admin_insert on public.sales_interview_questions as restrictive for insert to authenticated
      with check ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_interview_questions' and policyname = 'sales_interview_questions_admin_update') then
    create policy sales_interview_questions_admin_update on public.sales_interview_questions as restrictive for update to authenticated
      using ((select public.is_admin())) with check ((select public.is_admin()));
  end if;
end $$;
