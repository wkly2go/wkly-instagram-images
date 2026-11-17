// 설계 화면 시험용 자료 — 개발 서버에서 VITE_DESIGN_HARNESS=1 일 때만 불러온다 (운영 · 체험 모드 배포에는 들어가지 않음).
// 체험 모드에는 설계 자료를 두지 않으므로(대표 지시 '목업은 올리지 마') 화면 확인 · 자동 시험은 이 파일로 한다.
//   VITE_DESIGN_HARNESS=1 npx vite --port 5181  →  '관리자 (대표)로 입장'  →  /design?id=harness-1&view=plan
import { api } from '../lib/app'
import type { DesignBase, DesignProject, SpecItem } from '../lib/design'
import type { PlanGeometry } from '../lib/designPlan'
import type { LibraryEntry } from '../lib/designLibrary'
import type { ProposalBoard } from '../lib/designBoard'

const project: DesignProject = {
  id: 'harness-1', code: 'AR0000-00', name: '시험 현장 (개발 서버 전용)', address: '서울 성동구', client_name: '시험 거래처', space_type: 'popup', area_m2: 24, budget: null,
  start_date: null, end_date: null, stage: 'plan', model_version: 0, status: 'active', drive_url: null, estimate_rules: {},
}
const base: DesignBase = {
  trades: [['T01', '가설 · 철거'], ['T03', '목공 · 가벽'], ['T04', '금속'], ['T05', '유리'], ['T06', '도장'], ['T07', '필름 · 도배'], ['T08', '타일 · 석재'], ['T09', '바닥'], ['T10', '설비 · 위생'], ['T11', '전기 · 조명'], ['T15', '가구 · 집기'], ['T99', '기타']]
    .map(([code, name], i) => ({ code, name, group_name: '공사', sort: i })),
  units: ['EA', 'm', 'm2', '식', 'SET'],
}
const wall = (id: string, x1: number, y1: number, x2: number, y2: number, kind: 'existing' | 'new' = 'existing', t = 150, finish?: string) => ({ id, x1, y1, x2, y2, t, kind, finish })
let plan: PlanGeometry | null = {
  unit: 'mm', height: 2700,
  walls: [wall('a', 0, 0, 6000, 0, 'existing', 150, 'PT-01'), wall('b', 6000, 0, 6000, 4000, 'existing', 150, 'PT-01'), wall('c', 6000, 4000, 0, 4000), wall('d', 0, 4000, 0, 0, 'existing', 150, 'WC-01'), wall('n', 3800, 0, 3800, 2400, 'new', 100, 'PT-02')],
  openings: [{ id: 'o1', wall: 'c', pos: 1500, width: 900, kind: 'door', to: '홀' }, { id: 'o2', wall: 'a', pos: 1800, width: 1800, kind: 'window' }, { id: 'o3', wall: 'n', pos: 1500, width: 800, kind: 'door', type: '미닫이 도어', to: '창고' }],
  items: [
    { id: 'i1', x: 400, y: 500, w: 2100, d: 900, h: 800, rot: 0, name: '3인 소파', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: null },
    { id: 'i2', x: 900, y: 1800, w: 1200, d: 600, h: 450, rot: 0, name: '소파 테이블', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: null },
    { id: 'i3', x: 4200, y: 300, w: 1500, d: 400, h: 1800, rot: 0, name: '진열 선반', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: '렌탈' },
    { id: 'i4', x: 300, y: 3200, w: 500, d: 500, h: 1400, rot: 0, name: '화분', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: null },
  ],
  rooms: [{ id: 'r1', no: '101', name: '홀', floor: { mat: 'WF-01' }, base: { mat: 'MT-01' }, wall: { mat: 'PT-01' }, ceiling: { mat: 'PT-01' }, ch: 2700, area: 24, perimeter: 20 }],
}
const spec = (code: string, name: string, s: string): SpecItem => ({ id: `s-${code}`, project_id: project.id, book: 'materials', code, name, spec: s, location: null, maker: null, material_id: null, status: 'selected' } as unknown as SpecItem)
const specImages: Record<string, string> = {}
const specs = [spec('PT-01', '수성 페인트', '백색 무광'), spec('PT-02', '수성 페인트', '세이지 그린'), spec('WC-01', '실크 벽지', '아이보리'), spec('WF-01', '원목 마루', '오크 내추럴'), spec('MT-01', '스테인리스 걸레받이', '헤어라인 실버')]

const library: LibraryEntry[] = []
let board: { board: ProposalBoard; updated_at: string; updated_by: string | null } | null = null
const renders = [
  { id: 'rd-1', project_id: project.id, no: 'P-01', title: '홀 투시도', data: null, original_url: null, status: 'draft', note: null, sort: 1 },
  { id: 'rd-2', project_id: project.id, no: 'P-02', title: '카운터 투시도', data: null, original_url: null, status: 'draft', note: null, sort: 2 },
]

export function installDesignHarness() {
  Object.assign(api, {
    planVersionIsWeb: async () => true,
    listPlanLibrary: async () => [...library],
    savePlanLibrary: async (e: Pick<LibraryEntry, 'kind' | 'group' | 'name' | 'data'>) => { const row: LibraryEntry = { ...e, id: `h-${Date.now().toString(36)}`, builtin: false, created_by: 'harness', created_at: new Date().toISOString() }; library.unshift(row); return row },
    deletePlanLibrary: async (id: string) => { const i = library.findIndex(x => x.id === id); if (i >= 0) library.splice(i, 1) },
    watchDesignPlan: (_key: string, who: { id: string; name: string }, on: { peers(list: { id: string; name: string }[]): void }) => { queueMicrotask(() => on.peers([who, { id: 'peer-1', name: '김하늘' }])); return { saved() {}, close() {} } },
    getProposalBoard: async () => (board ? (JSON.parse(JSON.stringify(board)) as typeof board) : null),
    saveProposalBoard: async (_id: string, b: ProposalBoard) => { board = { board: JSON.parse(JSON.stringify(b)) as ProposalBoard, updated_at: new Date().toISOString(), updated_by: 'harness' }; return { updated_at: board.updated_at } },
    listRenders: async () => renders,
    listSpecImages: async () => ({ ...specImages }),
    setSpecImage: async (_pid: string, itemId: string, data: string | null) => { if (data) specImages[itemId] = data; else delete specImages[itemId] },
    updateSpecItem: async (id: string, patch: Partial<SpecItem>) => { const i = specs.findIndex(x => x.id === id); if (i >= 0) specs[i] = { ...specs[i], ...patch } },
    addSpecItem: async (row: Partial<SpecItem>) => { specs.push({ ...spec(String(row.code ?? ''), String(row.name ?? ''), String(row.spec ?? '')), ...row, id: `s-${Date.now().toString(36)}` } as SpecItem) },
    deleteSpecItem: async (id: string) => { const i = specs.findIndex(x => x.id === id); if (i >= 0) specs.splice(i, 1) },
    listProposalSections: async () => [],
    getProposalTemplate: async () => [],

    listDesignProjects: async () => [project],
    getDesignBase: async () => base,
    getDesignPlan: async () => (plan ? (JSON.parse(JSON.stringify(plan)) as PlanGeometry) : null),
    saveDesignPlan: async (_id: string, p: PlanGeometry) => { plan = JSON.parse(JSON.stringify(p)) as PlanGeometry },
    applyDesignPlan: async (_id: string, p: PlanGeometry) => { plan = JSON.parse(JSON.stringify(p)) as PlanGeometry },
    listSpecItems: async () => specs,
  })
  // 자동 시험에서 api 를 바꿔 끼울 수 있게 (예: window.__designHarness.api.listDesignJobs = async () => [...])
  ;(window as unknown as { __designHarness: unknown }).__designHarness = { api, get plan() { return plan }, set plan(p: PlanGeometry | null) { plan = p } }
}
