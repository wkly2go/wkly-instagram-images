-- 프로젝트 만들기 오류 수정: 연번 트리거가 일반 직원 권한으로는 private 스키마를 못 써서 모든 생성이 막혀 있었음
alter function private.project_code_assign() security definer;
alter function private.project_code_next(text, date) security definer;
