import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('sales conversation saves selected assignee, retains failed input and reloads stored reports', async () => {
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
   let fail=true,submitted=[],rows=[]
   const snapshot={at:'2026-11-15T00:00:00Z',scope:'DB 최신 12건',matched_total:0,sources:[],coverage:[],pipeline:[]}
   const api={listSalesDesk:async()=>rows,submitSalesDesk:async(...args)=>{submitted.push(args);if(fail)throw new Error('연결 오류');rows=[{id:args[0],sequence:1,owner_id:'admin',agent_name:'분석 팀원',instruction:args[3],action:args[2],status:'완료',reply:'자료 부족',report:{title:'팝업 분석 보고서',summary:'자료 부족',findings:[{text:'확인된 대상 없음',evidence_ids:[]}],recommendations:['시스템 후속 조사'],limitations:['발주 미확인']},snapshot,created_at:snapshot.at,finished_at:snapshot.at}];return args[0]}}
   const props={api,agents:[{id:'agent',name:'분석 팀원'}],canSubmit:true,operational:true}
   await act(async()=>root.render(el(SalesDeskChat,props)))
   await act(async()=>userEvent.selectOptions(screen.getByLabelText('지시할 AI 팀원'),'agent'))
   await act(async()=>userEvent.type(screen.getByLabelText('AI 팀원에게 지시할 내용'),'팝업 분석 보고서 만들어줘'))
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'업무 지시 보내기'})))
   assert.match(screen.getByRole('alert').textContent,/연결 오류/)
   assert.equal(screen.getByLabelText('AI 팀원에게 지시할 내용').value,'팝업 분석 보고서 만들어줘')
   fail=false
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'업무 지시 보내기'})))
   assert.equal(submitted[0][0],submitted[1][0]);assert.deepEqual(submitted[1].slice(1),['agent','보고서','팝업 분석 보고서 만들어줘'])
   assert.equal(screen.getByLabelText('AI 팀원에게 지시할 내용').value,'')
   assert.ok(screen.getByRole('region',{name:'AI 분석 보고서'}));assert.ok(screen.getByRole('button',{name:'보고서 저장 (.md)'}))
   await act(async()=>root.render(el('div')))
   await act(async()=>root.render(el(SalesDeskChat,props)))
   assert.ok(screen.getByText('팝업 분석 보고서'))
   await act(async()=>root.render(el(SalesDeskChat,{...props,canSubmit:false})))
   assert.equal(screen.getByRole('button',{name:'업무 지시 보내기'}).closest('fieldset').disabled,true)
   // Proposals sit in the conversation: approve in place, or reject with a direction.
   const calls=[],plan=(over={})=>({id:'p1',report_date:'2026-11-15',status:'승인 대기',plan:{title:'성수 팝업 브랜드 제안',customer:'식음료 브랜드',offer:'팝업 부스 설계',why_now:'보도 확인',recommendations:[]},sources:[],source_status:[],feedback:'',error:'',revision:3,created_at:'2026-11-15T01:00:00Z',decided_at:null,decided_by:null,...over})
   const plans=(items,over={})=>({items,busy:false,error:'',onApprove:r=>calls.push(['approve',r.id]),onReject:(r,reason,replan)=>calls.push(['reject',r.id,reason,replan]),onOpen:r=>calls.push(['open',r.id]),onPlan:d=>calls.push(['plan',d]),execution:r=>el('p',null,'실행 묶음 '+r.id),...over})
   await act(async()=>root.render(el(SalesDeskChat,{...props,plans:plans([plan(),plan({id:'p2',status:'승인 대기',preparation_before_approval:true,preparation_status:'준비 중',plan:{title:'준비 중인 안',customer:'c',offer:'o',why_now:'w'}}),plan({id:'p3',status:'승인',preparation_before_approval:true,preparation_status:'완료',plan:{title:'승인된 안',customer:'c',offer:'o',why_now:'w'}})])})))
   assert.ok(screen.getByRole('article',{name:'기획안 제안 · 성수 팝업 브랜드 제안'}))
   assert.match(screen.getByRole('status').textContent,/승인 대기 2건 · 실행 준비·진행 1건/)
   const before=submitted.length;await act(async()=>fireEvent.click(screen.getByRole('button',{name:'참여 가능한 나라장터 용역 공고 정리'})))
   assert.deepEqual(submitted[before].slice(2),['보고서','참여 가능한 나라장터 용역 공고 정리'])
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'새 기획안 받기'})));assert.deepEqual(calls.pop(),['plan',''])
   assert.equal(screen.getByRole('button',{name:'준비 중인 안 승인'}).disabled,true)
   assert.equal(screen.queryByRole('button',{name:'승인된 안 승인'}),null);assert.ok(screen.getByText('실행 묶음 p3'));assert.equal(screen.queryByText('실행 묶음 p2'),null)
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'성수 팝업 브랜드 제안 승인'})))
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'성수 팝업 브랜드 제안 반려'})))
   assert.equal(screen.getByRole('button',{name:'반려하고 다시 기획'}).disabled,true)
   await act(async()=>userEvent.type(screen.getByLabelText('반려 사유 · 바꿀 방향'),'대상을 좁혀서'))
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'반려하고 다시 기획'})))
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이 내용으로 기획안 만들기'})))
   assert.deepEqual(calls.slice(0,2),[['approve','p1'],['reject','p1','대상을 좁혀서',true]]);assert.equal(calls[2][0],'plan');assert.match(calls[2][1],/팝업 분석 보고서/)
   await act(async()=>root.render(el(SalesDeskChat,{...props,canSubmit:false,plans:plans([plan()],{error:'승인 실패'})})))
   assert.equal(screen.queryByRole('button',{name:'성수 팝업 브랜드 제안 승인'}),null);assert.match(screen.getByRole('alert').textContent,/승인 실패/)
  } finally {await act(async()=>root.unmount());await server.close();dom.window.close()}
})
