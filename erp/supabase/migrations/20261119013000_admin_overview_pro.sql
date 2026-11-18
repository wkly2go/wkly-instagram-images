-- 관리 › 시스템 현황 업데이트 (2026-11-19 대표 '업데이트해' · 화면이 무료 플랜 500MB 기준으로 남아 있었음)
-- 지금 서버는 Supabase Pro(디스크 8GB · 파일 저장 100GB · 가장 작은 컴퓨트 · 연결 60). 한도 숫자는 화면(Admin.tsx PLAN)에 둔다.
-- 같은 함수 이름 · 같은 인자로 다시 만든다(지우지 않음). 더해서 주는 것: 파일 저장공간 크기 · DB 연결 수 · 최근 쓰는 표의 줄 수.
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tables jsonb := '{}'::jsonb;
  v_name text;
  v_count bigint;
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;

  foreach v_name in array array[
    'public.profiles', 'public.clients', 'public.contacts', 'public.projects', 'public.tasks', 'public.work_logs',
    'public.chat_rooms', 'public.chat_messages', 'public.approvals', 'public.payments', 'public.project_budget_lines',
    'public.approval_routes', 'public.notifications', 'public.research_items', 'public.brand_contacts',
    'public.email_templates', 'public.agent_tokens',
    'public.sales_prospects', 'public.sales_interviews', 'public.web_inquiries', 'public.mail_index', 'public.drive_index',
    'design.price_refs', 'design.g2b_items'
  ] loop
    if pg_catalog.to_regclass(v_name) is not null then
      execute pg_catalog.format('select count(*) from %s', v_name) into v_count;
      v_tables := v_tables || jsonb_build_object(split_part(v_name, '.', 2), v_count);
    end if;
  end loop;

  return jsonb_build_object(
    'db_size_bytes', pg_catalog.pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o),
    'connections', (select count(*) from pg_catalog.pg_stat_activity where datname = current_database()),
    'max_connections', current_setting('max_connections')::int,
    'active_members', (select count(*) from public.profiles p where p.active),
    'tables', v_tables,
    'generated_at', now()
  );
end;
$$;
