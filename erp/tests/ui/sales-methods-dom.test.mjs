import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('method proposals show as approval cards and reload after a decision', async () => {
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
   const {SalesMethodProposals}=await server.ssrLoadModule('/src/components/SalesMethodProposals.tsx')
   let rows=[{id:'p1',action:'추가',name:'전시 주최사 협력',signal:'박람회 일정 공개',offer:'참가사 부스 묶음 제안',first_step:'주최사 사무국 문의',reason:'팝업 신호 4건에 맞는 방법 없음',created_at:'2026-11-16T00:00:00Z'},{id:'p2',action:'중지',name:'공공 용역 입찰 참여',signal:'',offer:'',first_step:'',reason:'반려 3건 승인 0건',created_at:'2026-11-16T00:00:01Z'}]
   const decided=[],api={listSalesMethodProposals:async()=>rows,decideSalesMethodProposal:async(id,decision)=>{decided.push([id,decision]);rows=rows.filter(r=>r.id!==id)}}
   await act(async()=>{root.render(el(SalesMethodProposals,{api,canDecide:true}))})
   await act(async()=>{await new Promise(r=>setTimeout(r,20))})
   assert.equal(screen.getAllByRole('article').length,2)
   assert.ok(screen.getByText('참가사 부스 묶음 제안'));assert.ok(screen.getByText(/반려 3건 승인 0건/))
   await act(async()=>{fireEvent.click(screen.getAllByRole('button',{name:'승인'})[0])})
   await act(async()=>{await new Promise(r=>setTimeout(r,20))})
   assert.deepEqual(decided,[['p1','승인']]);assert.equal(screen.getAllByRole('article').length,1)
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'반려'}))})
   await act(async()=>{await new Promise(r=>setTimeout(r,20))})
   assert.deepEqual(decided[1],['p2','반려']);assert.equal(screen.queryByRole('region',{name:'영업 방법 개선 제안'}),null)
  } finally {
   await act(async()=>{root.unmount()})
   await server.close()
   dom.window.close()
  }
})
