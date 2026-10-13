-- WKLY ERP 0008: 채팅 읽음 표시
--   채팅방은 활성 팀원 모두에게 열려 있으므로, 누가 어디까지 읽었는지(chat_reads)도 활성 팀원이 모두 볼 수 있게 한다.
--   쓰기(insert/update/delete)는 그대로 본인 행만.
drop policy if exists chat_reads_select on public.chat_reads;
create policy chat_reads_select on public.chat_reads
  for select to authenticated
  using ((select public.is_active_member()));

-- Realtime: 상대가 읽으면 내 화면의 읽음 표시가 바로 바뀌도록
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reads'
     )
  then
    alter publication supabase_realtime add table public.chat_reads;
  end if;
end;
$$;
