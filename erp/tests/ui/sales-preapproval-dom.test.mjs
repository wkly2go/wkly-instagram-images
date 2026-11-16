import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('preapproval shows connected targets and prepared materials before enabling a decision; system data tasks stay read-only', async () => {
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
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const { fireEvent, within } = require('@testing-library/dom')
  const user = require('@testing-library/user-event').default.setup({ document })
  const { act, createElement: el } = React
  const mountNode = document.getElementById('test-root')
  let root = createRoot(mountNode)
  try {
    const { api, AppProvider } = await server.ssrLoadModule('/src/lib/app.tsx')
    const { RouterProvider } = await server.ssrLoadModule('/src/lib/router.tsx')
    const {SalesStrategyDesk}=await server.ssrLoadModule('/src/components/SalesStrategyDesk.tsx')
    await api.signIn('admin@thewklyn.com','')
    const profiles=await api.listProfiles(),me=profiles.find(p=>p.role==='admin')
    const source={id:'source',name:'저장 문의',source:'담당자',evidence:'팝업 운영 문의 기록',source_url:'',source_updated_at:null}
    const row={id:'proposal',status:'승인 대기',revision:2,report_date:'2026-11-15',created_at:'2026-11-15T00:00:00Z',decided_at:null,decided_by:null,feedback:'',error:'',preparation_before_approval:true,preparation_status:'준비 중',preparation:null,preparation_error:'',sources:[source],source_status:[],targets:[{source_id:'source',name:'문의 기록',kind:'사람',company:'시험 브랜드',person:'시험 담당자',email:'person@example.com',email_origin:'담당자 DB',status:'저장 연락처 연결',next_action:'시스템의 수신 자격 검증 대상'}],plan:{title:'브랜드 체험 기획',customer:'시험 브랜드',category:'체험',offer:'팝업 운영',opportunity:'문의 기반 가설',why_now:'저장 문의 존재',approach:'공식 창구 검증',effect:'의향 확인',resources:'범위 미정',stop_rule:'수요 없으면 보류',first_message:'제안 연락 초안',evidence_ids:['source'],questions:['예산 자동 확인'],metrics:['회신'],steps:[{action:'자료 보완',output:'출처 목록',day:1}]}}
    const decisions=[]
    api.listSalesStrategies=async()=>({items:[structuredClone(row)],total:1,automatic:true})
    api.listSalesDesk=async()=>[]
    api.listStrategyTasks=async()=>[{id:'task',strategy_id:'proposal',ordinal:1,owner_id:null,executor:'system',title:'자료 보완',output:'출처 목록',due_date:'2026-11-16',status:'대기',result:'',revision:1}]
    api.decideSalesStrategy=async(...args)=>{decisions.push(args);row.status='승인';row.revision=4}
    await act(async()=>root.render(el(RouterProvider,null,el(AppProvider,{me,profiles,version:0,bump(){},toast(){},openQuick(){}},el(SalesStrategyDesk)))))
    const screen=within(document.body)
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'기획 보고서',exact:true})))
    const report=within(screen.getByRole('region',{name:'영업 기획 보고서'}))
    assert.ok(report.getByRole('region',{name:'자동 연결한 영업 대상 DB'}))
    assert.ok(report.getByText('person@example.com'))
    assert.equal(report.getByRole('button',{name:'준비된 기획안 승인'}).disabled,true)
    await act(async()=>user.type(report.getByLabelText('수정·보류 의견'),'예산 범위 검토'))
    row.preparation_status='완료';row.revision=3;row.preparation={research:'저장 사실 검토 요약',proposal:'완성된 검토 제안 초안',contact_draft:'수신자 검증 전 연락 초안',checks:['수신 조건 자동 검증']}
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'기획안 새로고침'})))
    assert.equal(report.getByLabelText('수정·보류 의견').value,'예산 범위 검토')
    assert.equal(report.getByRole('button',{name:'준비된 기획안 승인'}).disabled,false)
    const prepared=report.getByText('완성된 검토 제안 초안'),decision=report.getByRole('group',{name:'대표 결정'})
    assert.ok(prepared.compareDocumentPosition(decision)&Node.DOCUMENT_POSITION_FOLLOWING)
    await act(async()=>fireEvent.click(report.getByRole('button',{name:'준비된 기획안 승인'})))
    assert.deepEqual(decisions,[['proposal',3,'승인','예산 범위 검토']])
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'기획 보고서',exact:true})))
    const tasks=within(screen.getByRole('region',{name:'승인된 영업 실행 업무'}))
    assert.match(tasks.getByText(/까지 · 시스템 처리/).textContent,/시스템 처리/)
    assert.equal(tasks.queryByText('실행 결과 기록'),null)
  } finally {
    await act(async()=>root.unmount())
    await server.close()
    dom.window.close()
  }
})
