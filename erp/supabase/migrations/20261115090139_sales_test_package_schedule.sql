-- 시험 주소만 받는 실행 묶음은 다음 영업일이 아니라 다음 정각에 나가게 한다 (발송 흐름 검증용).
begin;
create or replace function private.sales_execution_material(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare m jsonb:=private.sales_execution_material_before_send_gate(p_id); payload jsonb; blockers jsonb; sender text; rule text; proofs jsonb:='{}'; msg jsonb; r text; origin text; proof jsonb; outside integer:=0; until timestamptz; test_at timestamptz;
begin
 if m is null then return null; end if;
 payload:=m->'payload';
 select coalesce(jsonb_agg(b),'[]'::jsonb) into blockers from jsonb_array_elements(m->'blockers') b
  where b#>>'{}' not in ('발신 계정·이메일 발송 권한과 전송 처리가 아직 연결되지 않았습니다.','시스템의 수신 자격·문안·제안 범위 검증이 완료되지 않았습니다.');
 select sender_confirmed into sender from private.sales_sender_readiness where id;
 if sender is not null then payload:=payload||jsonb_build_object('sender',sender,'transport_enabled',true);
 else blockers:=blockers||jsonb_build_array('발신 계정에 메일 보내기 권한이 없습니다. 드라이브 설정에서 구글 계정을 다시 연결해 주세요.'); end if;
 select scope into rule from private.sales_recipient_scope where id;rule:=coalesce(rule,'미정');
 -- A package addressed only to the named test addresses goes out at the next full hour instead of the next working day,
 -- so a send test finishes while the administrator is watching. The hour first shown is kept until it expires.
 if jsonb_array_length(coalesce(payload->'messages','[]'::jsonb))>0 and not exists(select 1 from jsonb_array_elements(payload->'messages') x where not exists(select 1 from private.sales_test_recipients t where t.email=lower(btrim(x->>'recipient')))) then
  select (p.payload->'schedule'->>'at')::timestamptz into test_at from public.sales_execution_packages p where p.strategy_id=p_id and coalesce((p.payload->>'test_run')::boolean,false) and (p.payload->'schedule'->>'expires_at')::timestamptz>now() order by p.version desc limit 1;
  test_at:=coalesce(test_at,date_trunc('hour',now())+interval '1 hour');
  payload:=jsonb_set(jsonb_set(payload,'{schedule,at}',to_jsonb(test_at)),'{schedule,expires_at}',to_jsonb(test_at+interval '4 hours'))||jsonb_build_object('test_run',true);
 end if;
 until:=(payload->'schedule'->>'expires_at')::timestamptz+interval '1 day';
 for msg in select value from jsonb_array_elements(coalesce(payload->'messages','[]'::jsonb)) loop
  r:=lower(btrim(msg->>'recipient'));
  select t->>'email_origin' into origin from jsonb_array_elements(payload->'targets') t where lower(btrim(t->>'email'))=r order by t->>'source_id' limit 1;
  proof:=case
   when exists(select 1 from private.sales_test_recipients x where x.email=r) then jsonb_build_object('evidence','대표가 지정한 사내 시험 수신 주소','purpose','발송 기능 시험')
   when rule in ('거래·문의','공개 창구 포함') and origin in ('담당자 DB','거래처 DB') then jsonb_build_object('evidence','기존 거래처·담당자로 저장된 주소 ('||origin||')','purpose','기존 거래 관계에 따른 제안')
   when rule='공개 창구 포함' and origin='공식 사이트 공개 주소' then jsonb_build_object('evidence','브랜드 공식 사이트가 공개한 문의 주소','purpose','공개 문의 창구를 통한 제휴 제안')
  end;
  if proof is null then outside:=outside+1;
  else proofs:=proofs||jsonb_build_object(r,proof||jsonb_build_object('status','verified','rule',rule,'valid_until',until)); end if;
 end loop;
 if outside>0 then blockers:=blockers||jsonb_build_array(case when rule='미정' then '수신자 범위 규칙이 아직 정해지지 않았습니다. 기획실에서 대표님이 고르면 다시 판정합니다.' else '수신자 범위 규칙('||rule||') 밖의 대상이 '||outside||'곳 있습니다.' end); end if;
 payload:=payload||jsonb_build_object('recipient_verification',proofs,'recipient_scope',rule);
 return jsonb_build_object('payload',payload,'blockers',blockers,'fingerprint',encode(sha256(convert_to(jsonb_build_array(payload,blockers)::text,'UTF8')),'hex'));
end $$;
revoke all on function private.sales_execution_material(uuid) from public,anon,authenticated;
commit;
