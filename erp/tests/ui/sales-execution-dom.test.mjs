import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('execution review blocks unready approval, shows exact material and refreshes stale decisions', async () => {
  const dom = new JSDOM('<main id="test-root"></main>', { url: 'http://localhost/sales?new=1', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver', 'Node', 'NodeFilter', 'EventTarget', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'StorageEvent', 'PopStateEvent', 'getComputedStyle']) {
    const value = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key]
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })
  window.confirm = () => false
  window.scrollTo = () => {}
  HTMLElement.prototype.scrollTo = () => {}
  globalThis.fetch = async () => { throw new Error('Network disabled in sales DOM tests') }

  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false },
    logLevel: 'error',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' },
  })
  const React=require('react'),{act,createElement:el}=React
  const {createRoot}=require('react-dom/client'),{within,fireEvent}=require('@testing-library/dom')
  const root=createRoot(document.getElementById('test-root')),screen=within(document.body)
  try {
   const {SalesExecutionReview}=await server.ssrLoadModule('/src/components/SalesExecutionReview.tsx')
   let row={id:'packet',version:1,fingerprint:'hash-one',current:true,can_approve:false,status:'준비 중',blockers:['발송 연결 검증 필요'],events:[{id:1,kind:'자료 준비',note:'외부 발송 미실행',created_at:'2026-11-15T01:00:00Z'}],payload:{title:'팝업 운영',sender:null,transport_enabled:false,research:'근거 요약',messages:[{recipient:'company@example.com',company:'시험 회사',person:'담당자',subject:'팝업 운영 제안',body:'확인된 검토 문안'}],attachments:[{name:'proposal.md',mime:'text/markdown',content:'정확한 제안 자료'}],schedule:{at:'2026-11-16T01:00:00Z',expires_at:'2026-11-16T05:00:00Z',per_recipient_limit:1,followups:'없음'},checks:[]}}
   row.payload.contact_evidence={version:1,window_days:180,contact_limit:50,contact_total:1,contacts_truncated:false,mail_scan_limit:1000,mail_truncated:false,mail_per_contact_limit:5,scope:'저장 메일 일부 · 실시간 메일함 아님',proposal:{title:'팝업 운영 제안 가설',offer:'체험 행사 운영',customer:'시험 회사',why_now:'저장된 행사 단서'},contacts:[{key:'company@example.com',email:'company@example.com',companies:['시험 회사'],people:['담당자'],sampled_matches:1,excluded:false,ambiguous:false,assessment:'주소 일치 · 수신 목적 검증 전',next_action:'시스템의 원문 자동 검증 대상',outreach_authorized:false,sources:[{id:'source',name:'시험 출처',origin:'거래처',url:'javascript:alert(1)',excerpt:'<img src=x onerror=alert(1)>',signature:'source-hash'}],mail:[{id:'mail-1',thread_id:'thread-1',subject:'체험 행사 문의',excerpt:'검증용 저장 미리보기',sent_at:'2026-11-14T03:00:00Z',synced_at:'2026-11-15T03:00:00Z',address_match:'from',body:{id:'mail-1',status:'retrieved',text:'자동 확보 원문 <img src=x onerror=alert(1)>',truncated:true,direction:'inbound',retrieved_at:'2026-11-15T04:00:00Z'}}]}]}
   row.contact_discovery={total:1,scope:'검증용 웹사이트 후보',companies:[{id:'company',company:'시험 회사',website:'https://example.com',state:'done',checked_at:'2026-11-15T04:00:00Z',attempts:1,note:'공식 소유 검증 전',limited:true,pages:[],candidates:[{email:'biz@example.com',url:'javascript:alert(1)',excerpt:'<script>contact evidence</script>',role:'partnership',domain_match:true,excluded:false,outreach_authorized:false},{email:'privacy@example.com',url:'https://example.com/privacy',excerpt:'개인정보 창구',role:'non_sales',domain_match:true,excluded:true,outreach_authorized:false}]}]}
   row.mail_evidence={state:'done',attempts:1,checked_at:'2026-11-15T04:00:00Z',note:'조회 결과 저장'}
   row.readiness={scope:'현재 DB 자동 점검',sender:{code:'unverified',email:null,can_send:false,can_read:false,checked_at:null,valid_until:null,transport_connected:false},recipients:[{source_id:'source',company:'시험 회사',person:'담당자',email:'company@example.com',origin:'담당자 DB',code:'permission_unverified',next_action:'시스템의 요청 근거 확인 대상'}]}
   row.crm={scope:'제공사 접수와 회신을 분리한 자동 CRM',threads:[{dispatch_id:'dispatch-test',recipient:'company@example.com',stage:'연락 중단',next_action:'후속 발송 차단 · 원문 검증 대상',read_note:'연락 중단 · 후속 발송 차단',created_at:'2026-11-15T03:00:00Z',checked_at:null,last_reply_at:'2026-11-15T04:00:00Z',reply_count:1,replies:[{message_id:'bb22',signal:'stop',text:'메일 보내지 마세요 <script>untrusted</script>',received_at:'2026-11-15T04:00:00Z'}]}]}
   let checks=0
   const decisions=[],api={refreshSalesSender:async()=>{checks++;row.readiness.sender={...row.readiness.sender,code:'read_only',email:'sender@example.com',can_read:true,checked_at:'2026-11-15T03:00:00Z'}},getSalesExecution:async()=>structuredClone(row),decideSalesExecution:async(...args)=>{decisions.push(args);row={...row,version:2,fingerprint:'hash-two',can_approve:false,status:'재검토',current:false};throw new Error('자료가 변경되었습니다.')}}
   await act(async()=>root.render(el(SalesExecutionReview,{api,strategyId:'strategy',revision:3,canDecide:true})))
   assert.equal(screen.getByRole('button',{name:'이 버전의 외부 연락 승인'}).disabled,true)
   assert.ok(screen.getByRole('region',{name:'자동 CRM 활동 기록'}));assert.ok(screen.getByText('연락 중단'));assert.ok(screen.getByText('메일 보내지 마세요 <script>untrusted</script>'));assert.equal(document.querySelectorAll('.sales-crm-report script').length,0)
   assert.equal(checks,1);assert.ok(screen.getByRole('region',{name:'자동 탐색한 회사 연락 창구'}));assert.ok(screen.getByText('biz@example.com'));assert.match(document.body.textContent,/수신 거부 · 연락 제외/);assert.equal(document.querySelectorAll('.sales-contact-evidence script').length,0);assert.ok(screen.getByText('<script>contact evidence</script>'));assert.ok(screen.getByRole('region',{name:'대상별 영업 근거 보고서'}));assert.ok(screen.getByText('주소 일치 · 수신 목적 검증 전',{exact:false}));assert.equal(screen.queryByRole('link',{name:'출처 원문 열기'}),null);assert.equal(document.querySelector('.sales-contact-evidence img'),null);assert.ok(screen.getByText('자동 확보 원문 <img src=x onerror=alert(1)>'));assert.match(document.body.textContent,/일부 내용만 포함/);assert.match(document.body.textContent,/최근 24시간 조회 시도 1\/3회/);assert.ok(screen.getByText('발송 권한 없음'));assert.ok(screen.getByText('시스템의 요청 근거 확인 대상'));assert.ok(screen.getAllByText('company@example.com').length>=1);assert.ok(screen.getByText('확인된 검토 문안'));assert.ok(screen.getByText('정확한 제안 자료'))
   assert.match(screen.getByText(/제안 시각/).textContent,/제안 시각/)
   row={...row,readiness:{...row.readiness,sender:{...row.readiness.sender,code:'ready',can_send:true}},status:'승인 대기',can_approve:true,dispatch:{connected:false,note:'실제 발송 처리기 미연결',jobs:[{id:'job',package_id:'packet',recipient:'company@example.com',state:'unknown',reason:'결과 불명 · 자동 재발송 중단',scheduled_at:'2026-11-16T01:00:00Z',finished_at:null,created_at:'2026-11-15T01:00:00Z'}]}}
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'실행안 새로고침'})))
   assert.ok(screen.getByText('결과 확인 필요'));assert.ok(screen.getByText('결과 불명 · 자동 재발송 중단'))
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이 버전의 외부 연락 승인'})))
   assert.deepEqual(decisions,[['packet',1,'hash-one','승인']]);assert.ok(screen.getByText('자료가 변경되었습니다.'))
   assert.equal(screen.getByRole('button',{name:'이 버전의 외부 연락 승인'}).disabled,true)
   assert.equal(screen.getByRole('button',{name:'실행안 보류'}).disabled,true)
   await act(async()=>root.render(el(SalesExecutionReview,{api,strategyId:'strategy',revision:3,canDecide:false})))
   assert.equal(screen.queryByRole('button',{name:'이 버전의 외부 연락 승인'}),null)
   assert.equal(screen.queryByRole('button',{name:'계정 연결 다시 점검'}),null);assert.equal(checks,1)
  } finally {await act(async()=>root.unmount());await server.close();dom.window.close()}
})
