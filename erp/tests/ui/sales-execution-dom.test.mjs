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
   const decisions=[],api={getSalesExecution:async()=>structuredClone(row),decideSalesExecution:async(...args)=>{decisions.push(args);row={...row,version:2,fingerprint:'hash-two',can_approve:false,status:'재검토',current:false};throw new Error('자료가 변경되었습니다.')}}
   await act(async()=>root.render(el(SalesExecutionReview,{api,strategyId:'strategy',revision:3,canDecide:true})))
   assert.equal(screen.getByRole('button',{name:'이 버전의 외부 연락 승인'}).disabled,true)
   assert.ok(screen.getByText('company@example.com'));assert.ok(screen.getByText('확인된 검토 문안'));assert.ok(screen.getByText('정확한 제안 자료'))
   assert.match(screen.getByText(/제안 시각/).textContent,/제안 시각/)
   row={...row,status:'승인 대기',can_approve:true,dispatch:{connected:false,note:'실제 발송 처리기 미연결',jobs:[{id:'job',package_id:'packet',recipient:'company@example.com',state:'unknown',reason:'결과 불명 · 자동 재발송 중단',scheduled_at:'2026-11-16T01:00:00Z',finished_at:null,created_at:'2026-11-15T01:00:00Z'}]}}
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'실행안 새로고침'})))
   assert.ok(screen.getByText('결과 확인 필요'));assert.ok(screen.getByText('결과 불명 · 자동 재발송 중단'))
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이 버전의 외부 연락 승인'})))
   assert.deepEqual(decisions,[['packet',1,'hash-one','승인']]);assert.ok(screen.getByText('자료가 변경되었습니다.'))
   assert.equal(screen.getByRole('button',{name:'이 버전의 외부 연락 승인'}).disabled,true)
   assert.equal(screen.getByRole('button',{name:'실행안 보류'}).disabled,true)
   await act(async()=>root.render(el(SalesExecutionReview,{api,strategyId:'strategy',revision:3,canDecide:false})))
   assert.equal(screen.queryByRole('button',{name:'이 버전의 외부 연락 승인'}),null)
  } finally {await act(async()=>root.unmount());await server.close();dom.window.close()}
})
