-- WKLY ERP 0011: 채팅 사진 · 파일 첨부
--   파일은 비공개 저장소(chat-files)에 '<방 id>/<무작위>/<파일 이름>' 으로 올리고,
--   그 방을 볼 수 있는 사람(1:1 대화면 두 사람)만 내려받을 수 있다.
--   메시지에는 attachment(경로 · 이름 · 크기 · 형식)만 남긴다.

alter table public.chat_messages add column attachment jsonb;
alter table public.chat_messages add constraint chat_messages_attachment_check check (
  attachment is null or (
    jsonb_typeof(attachment) = 'object'
    and (attachment->>'path') like room_id::text || '/%'
    and coalesce(attachment->>'name', '') <> ''
  )
);
comment on column public.chat_messages.attachment is '첨부 파일 {path, name, size, type}. 파일은 chat-files 저장소';

-- 저장소 (비공개, 한 파일 20MB 까지)
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 20971520)
on conflict (id) do nothing;

-- 파일 경로의 첫 칸(방 id)으로 볼 수 있는 방인지 확인
create function public.chat_file_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_active_member() and public.chat_room_visible(split_part(p_name, '/', 1)::uuid)
    else false
  end;
$$;
revoke execute on function public.chat_file_visible(text) from public, anon;
grant execute on function public.chat_file_visible(text) to authenticated;

create policy chat_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-files' and (select public.chat_file_visible(name)));
create policy chat_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-files' and (select public.chat_file_visible(name)));
create policy chat_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-files' and (owner_id = (select auth.uid())::text or (select public.is_admin())));
