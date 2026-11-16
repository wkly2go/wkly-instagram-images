import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('older exchanges fold to one line and can be archived and restored', async () => {
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
   const rows=[msg('11111111-1111-4111-8111-111111111111',1,'예전 지시'),msg('22222222-2222-4222-8222-222222222222',2,'최근 지시')]
   let folds=[],calls=[]
   const api={listSalesDesk:async()=>rows,submitSalesDesk:async()=>'',listSalesDeskFolds:async()=>folds,foldSalesDesk:async(kind,id,on,label)=>{calls.push([kind,id,on]);folds=on?[{kind,id,label,folded_at:'2026-11-16T00:00:00Z'}]:[]}}
   await act(async()=>{root.render(el(SalesDeskChat,{api,agents:[],canSubmit:true,operational:true}))})
   await act(async()=>{await new Promise(r=>setTimeout(r,30))})
   // newest stays open (its answer is visible), the older one is a single line
   assert.ok(screen.getByText('답변 최근 지시'))
   assert.equal(screen.queryByText('답변 예전 지시'),null)
   assert.ok(document.querySelector('.sales-desk-compact'))
   await act(async()=>{fireEvent.click(screen.getByText(/보고서 · 예전 지시/))})
   assert.ok(screen.getByText('답변 예전 지시'))
   const archiveButtons=screen.getAllByRole('button',{name:'보관'})
   await act(async()=>{fireEvent.click(archiveButtons[0])})
   assert.deepEqual(calls[0].slice(0,3),['message','11111111-1111-4111-8111-111111111111',true])
   assert.equal(screen.queryByText('답변 예전 지시'),null)
   assert.ok(screen.getByText(/보관함 · 1건/))
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'다시 꺼내기'}))})
   assert.deepEqual(calls[1].slice(0,3),['message','11111111-1111-4111-8111-111111111111',false])
   assert.equal(screen.queryByText(/보관함 ·/),null)
  } finally {
   await act(async()=>root.unmount())
   await server.close()
  }
})
