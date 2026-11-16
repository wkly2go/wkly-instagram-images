import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('evidence UI keeps failures explicit and history lazy, bounded and read-only', async () => {
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
   const {SalesDataStatus,SalesSourceHistory}=await server.ssrLoadModule('/src/components/SalesEvidence.tsx')
   let fail=false,queries=[]
   const row=v=>({id:v,version:v,origin:v===1?'baseline':'collection',captured_at:'2026-11-15T00:00:00Z',last_collected_at:'2026-11-15T00:00:00Z',source_updated_at:null,snapshot:{name:'시험 브랜드',source:'공식 참가사',entity_kind:'회사',organization:'시험 회사',evidence:'보존 원문 '+v,contact:'work@example.test',source_url:'javascript:alert(1)',blocked:false}})
   const api={getSalesDataReadiness:async()=>{if(fail)throw new Error('서버 연결 확인 필요');return {counts:{total:20,companies:10,people:5,unclassified:5,content_verified:2,blocked:1,missing_source:3,missing_contact:4,linked_opportunities:1},new_today:2,baseline:18,sending_enabled:false,sending_status:'발송 승인 연결 전'}},getSalesSourceVersions:async(id,before)=>{queries.push([id,before]);return before===null?Array.from({length:20},(_,i)=>row(21-i)):[row(1)]}}
   await act(async()=>root.render(el(SalesDataStatus,{api,revision:0})))
   assert.match(document.body.textContent,/오늘 신규 자료 2건/);assert.match(document.body.textContent,/최초 이관 자료 18건/)
   assert.match(document.body.textContent,/발송 연결 전/);assert.equal(document.querySelectorAll('input,textarea').length,0)
   fail=true
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'자료 상태 새로고침'})))
   assert.match(screen.getByRole('alert').textContent,/서버 연결/)
   assert.doesNotMatch(document.body.textContent,/오늘 신규 자료/)
   await act(async()=>root.render(el(SalesSourceHistory,{api,id:'one'})))
   assert.equal(queries.length,0)
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'출처 변경 이력 보기'})))
   assert.deepEqual(queries,[['one',null]])
   assert.equal(screen.getAllByRole('listitem').length,20);assert.equal(document.querySelectorAll('a').length,0)
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이전 이력 더 보기'})))
   assert.deepEqual(queries.at(-1),['one',2]);assert.match(document.body.textContent,/기존 자료 최초 이관/)
   assert.equal(screen.getByRole('button',{name:'이전 이력 더 보기'}).disabled,true)
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'최근 이력'})))
   assert.deepEqual(queries.at(-1),['one',null])
   await act(async()=>root.render(el(SalesSourceHistory,{api,id:'two'})))
   assert.deepEqual(queries.at(-1),['two',null])
  } finally {await act(async()=>root.unmount());await server.close();dom.window.close()}
})
