import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('failed instructions are hidden and a plan report opens inside its card', async () => {
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
   const userEvent=require('@testing-library/user-event').default.setup({document:window.document})
   const snapshot={at:'2026-11-15T00:00:00Z',scope:'DB',matched_total:0,sources:[],coverage:[],pipeline:[]}
   const msg=(id,seq,text)=>({id,sequence:seq,owner_id:'admin',agent_name:'분석 팀원',instruction:text,action:'보고서',status:'완료',reply:'답변 '+text,report:null,snapshot,created_at:`2026-11-1${seq}T00:00:00Z`,finished_at:null})
   const rows=[msg('11111111-1111-4111-8111-111111111111',1,'실패한 지시'),msg('22222222-2222-4222-8222-222222222222',2,'최근 지시')]
   rows[0].status='실패'
   const plan={id:'33333333-3333-4333-8333-333333333333',status:'승인 대기',revision:1,created_at:'2026-11-13T00:00:00Z',report_date:'2026-11-13',preparation_before_approval:false,plan:{title:'시험 기획',customer:'고객',offer:'제안',why_now:'이유',category:'민간',steps:[]}}
   let openId=null
   const render=()=>root.render(el(SalesDeskChat,{api,agents:[],canSubmit:true,operational:true,plans:{items:[plan],busy:false,error:'',onApprove(){},onReject(){},onPlan(){},onOpen:row=>{openId=openId===row.id?null:row.id;render()},get openId(){return openId},detail:()=>el('p',null,'보고서 본문')}}))
   const api={listSalesDesk:async()=>rows,submitSalesDesk:async()=>'',listSalesDeskFolds:async()=>[],foldSalesDesk:async()=>{}}
   await act(async()=>{render()})
   await act(async()=>{await new Promise(r=>setTimeout(r,30))})
   // failed instruction is hidden until asked for
   assert.equal(screen.queryByText(/실패한 지시$/),null)
   assert.ok(screen.getByText(/실패한 지시 1건은 숨겼습니다/))
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'실패한 지시 보기'}))})
   assert.ok(screen.getByText(/보고서 · 실패한 지시/))
   // the full report opens inside the plan's own card
   assert.equal(screen.queryByText('보고서 본문'),null)
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'자세히 보기'}))})
   const detail=screen.getByText('보고서 본문')
   assert.ok(detail.closest('#sales-plan-'+plan.id))
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'자세히 닫기'}))})
   assert.equal(screen.queryByText('보고서 본문'),null)
  } finally {
   await act(async()=>root.unmount())
   await server.close()
  }
})
