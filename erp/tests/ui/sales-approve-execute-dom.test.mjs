import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('a prepared plan shows what will be sent and is approved in one step; an unprepared one keeps plain approval', async () => {
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
   const {SalesDeskChat}=await server.ssrLoadModule('/src/components/SalesDeskChat.tsx')
   const row=(id,title)=>({id,status:'승인 대기',revision:2,report_date:'2026-11-16',created_at:'2026-11-16T00:00:0'+id+'Z',decided_at:null,decided_by:null,feedback:'',error:'',auto_slot:null,preparation_before_approval:true,preparation_status:'완료',preparation_error:'',preparation:null,sources:[],targets:[],plan:{title,customer:'브랜드',offer:'제안',why_now:'지금',evidence_ids:[]}})
   const pkg=(ok)=>({id:'pkg',version:3,fingerprint:'f',current:true,can_approve:ok,status:ok?'승인 대기':'준비 중',created_at:'',checked_at:'',blockers:ok?[]:['수신자 범위 규칙이 아직 정해지지 않았습니다.'],events:[],payload:{title:'t',transport_enabled:ok,sender:ok?'info@wkly.test':null,research:'',checks:[],attachments:[{name:'proposal.md',mime:'text/markdown',content:'x'}],schedule:{at:'2026-11-16T02:00:00Z',expires_at:'2026-11-16T06:00:00Z',timezone:'Asia/Seoul',per_recipient_limit:1,followups:''},messages:ok?[{channel:'email',recipient:'buyer@brand.kr',company:'브랜드',person:null,source_ids:[],subject:'제안 제목',body:'보낼 문안 본문'}]:[]}})
   const approved=[],plain=[]
   const plans={items:[row('1','준비된 기획'),row('2','막힌 기획')],busy:false,error:'',onApprove:r=>plain.push(r.id),onReject(){},onOpen(){},onPlan(){},loadExecution:async r=>pkg(r.id==='1'),onApproveExecute:(r,p)=>approved.push([r.id,p.id,p.version,p.fingerprint])}
   await act(async()=>{root.render(el(SalesDeskChat,{api:{listSalesDesk:async()=>[],submitSalesDesk:async()=>''},agents:[],canSubmit:true,operational:true,plans}))})
   await act(async()=>{await new Promise(r=>setTimeout(r,30))})
   assert.ok(screen.getByText('승인하면 이대로 실행됩니다'));assert.ok(screen.getByText('브랜드 (buyer@brand.kr)'));assert.ok(screen.getByText('보낼 문안 본문'))
   assert.ok(screen.getByText(/실행은 다음이 해결되면 이어집니다: 수신자 범위 규칙/))
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'준비된 기획 승인하고 실행'}))})
   assert.deepEqual(approved,[['1','pkg',3,'f']]);assert.equal(screen.queryByRole('button',{name:'막힌 기획 승인하고 실행'}),null)
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'막힌 기획 승인'}))});assert.deepEqual(plain,['2'])
  } finally {
   await act(async()=>{root.unmount()})
   await server.close()
   dom.window.close()
  }
})
