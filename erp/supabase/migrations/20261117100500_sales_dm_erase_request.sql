-- Instagram DM '삭제 요청' 처리 (2026-11-17 · 개인정보처리방침 /privacy · 데이터 삭제 안내 /data-deletion 와 짝)
-- 받은 DM 이 삭제 요청이면 수신 거부와 같이 막고(더 보내지 않음) 관리자에게 알림 · 실제 삭제는 관리자가 확인 뒤 처리
create or replace function public.sales_dm_receive(p_events jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare e jsonb;n integer:=0;who text;txt text;stop boolean;erase boolean;at timestamptz;
begin
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>100 then raise exception 'Invalid events';end if;
 for e in select value from jsonb_array_elements(p_events) loop
  who:=e->>'ig_user';txt:=left(coalesce(e->>'text',''),2000);
  continue when who is null or who !~ '^[0-9]{5,30}$' or coalesce(e->>'mid','')='' or length(e->>'mid')>300;
  at:=least(now(),coalesce(to_timestamp((e->>'timestamp')::bigint/1000.0),now()));
  erase:=txt ~* '(삭제 ?요청|정보 ?(를 )?(삭제|지워)|지워 ?(주세요|줘)|delete ?my ?data)';
  stop:=erase or txt ~* '(수신 ?거부|연락 ?(하지|그만)|보내지 ?마|그만 ?보내|스팸|unsubscribe|^\s*stop\s*$)';
  insert into private.sales_dm_inbound(mid,ig_user,username,body,received_at,opt_out)
   values(e->>'mid',who,nullif(left(e->>'username',60),''),txt,at,stop) on conflict(mid) do nothing;
  if not found then continue;end if;
  n:=n+1;
  -- 개인정보처리방침(/privacy): 삭제 요청은 10일 안에 처리 · 관리자에게 알림 (알림 제목에 금액 없음)
  if erase then
   insert into public.notifications(user_id,kind,title,body,link)
    select p.id,'영업 자동화','Instagram 개인정보 삭제 요청 · '||coalesce('@'||nullif(left(e->>'username',60),''),who),'10일 안에 이 계정의 DM 기록과 영업 대상 정보를 지우고 결과를 답해 주세요. 더 보내지 않도록 수신 거부로 막아 두었습니다.','/sales'
    from public.profiles p where p.active and p.role='admin';
  end if;
  insert into public.sales_prospects(source,source_key,name,entity_kind,contact,evidence,event_data,source_updated_at,blocked,next_action)
   values('Instagram DM',who,coalesce('@'||nullif(left(e->>'username',60),''),'Instagram '||who),'미분류','ig:'||who,
    'Instagram DM 문의 · '||left(txt,300),jsonb_build_object('ig_user',who,'last_inbound_at',at),at,stop,
    case when stop then '수신 거부 · 연락하지 않음' else '받은 DM 24시간 안에 답장 기획' end)
   on conflict(source,source_key) do update set
    evidence=left('Instagram DM 문의 · '||left(txt,300)||' / '||public.sales_prospects.evidence,1500),
    event_data=public.sales_prospects.event_data||jsonb_build_object('last_inbound_at',at),
    source_updated_at=at,
    blocked=public.sales_prospects.blocked or stop,
    next_action=case when public.sales_prospects.blocked or stop then '수신 거부 · 연락하지 않음' else '받은 DM 24시간 안에 답장 기획' end;
 end loop;
 return n;
end $$;
revoke all on function public.sales_dm_receive(jsonb) from public,anon,authenticated;
grant execute on function public.sales_dm_receive(jsonb) to service_role;
