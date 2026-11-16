-- 받은 메일에서 만든 영업 후보 가운데 서비스 자동 알림(영수증 · 인증 · 로그인 · 댓글 알림)과
-- 우리에게 온 광고 메일은 발주 수요가 아니다. 영업 대상에서 빼서 기획 근거에 섞이지 않게 한다.
-- 대표가 직접 검토한 후보는 건드리지 않는다.
begin;
create function private.sales_mail_noise(p_contact text,p_evidence text) returns text language sql immutable set search_path='' as $$
 with e as (select lower(substring(coalesce(p_contact,'') from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')) email),
 k as (select split_part(split_part(email,'@',1),'+',1) local_part,split_part(email,'@',2) domain from e)
 select case
  when local_part ~ '^(no[-_]?reply|do[-_]?not[-_]?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|bounces?|postmaster|newsletter|digest|billing|invoices?|receipts?|payments?|verify|verification|updates?|onboarding|bot|automated)$'
   or domain ~ '^(mail|email|e|notifications?|newsletter|news|updates?|account|youraccount|bounce|em[0-9]*)\.' or domain ~ '(facebookmail|slack-mail|buffermail)\.com$'
   or coalesce(p_evidence,'') ~* '(invoice|receipt|영수증|결제 ?(완료|내역)|verify your|confirm your email|인증 ?(번호|코드)|코드: ?[0-9]|new login|로그인했습니다|terms of service|unsubscribe|초대했습니다|새 메시지가 있습니다|included .* credits|api key|무료로 체험|your summary of)' then '알림'
  when coalesce(p_evidence,'') ~ '\(광고\)|\[광고\]|수신거부' then '광고'
 end from k
$$;
create function private.sales_mail_noise_gate() returns trigger language plpgsql set search_path='' as $$
declare kind text;
begin
 if new.source<>'민간 영업 후보' or new.reviewed_assessment is not null then return new; end if;
 kind:=private.sales_mail_noise(new.contact,new.evidence);
 if kind='알림' then
  new.assessment:='제외';new.score:=0;new.reasons:='영업 대상 아님: 서비스 자동 알림 메일';new.next_action:='조치 없음';
 elsif kind='광고' then
  new.assessment:='보류';new.score:=least(new.score,20);new.reasons:='발주 수요 아님: 우리에게 온 광고·제안 메일';new.next_action:='조치 없음 · 협력사가 필요할 때 참고';
 end if;
 return new;
end $$;
create trigger sales_mail_noise_gate before insert or update on public.sales_prospects for each row execute function private.sales_mail_noise_gate();
update public.sales_prospects set revision=revision+1 where source='민간 영업 후보' and reviewed_assessment is null and private.sales_mail_noise(contact,evidence) is not null and assessment not in ('제외','보류');
revoke all on function private.sales_mail_noise(text,text),private.sales_mail_noise_gate() from public,anon,authenticated;
commit;
