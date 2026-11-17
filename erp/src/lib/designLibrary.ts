// 마감재 · 기구 라이브러리 (2026-11-17 대표 지시 '마감재와 각종 기구들을 저장해서 바로 사용할 수 있게 만들어')
// 기본 제공(아래 목록) + 회사 저장(design.plan_library) 을 평면 · 3D 작업 공간에서 눌러 바로 적용 · 배치한다.
// 치수는 mm 실제 크기. 값은 흔히 쓰는 표준 크기이며 견적 금액과는 무관하다 (금액은 견적 엔진만 계산).
import type { PlanItem } from './designPlan.ts'
import { ITEM_SHAPES, itemShape, type FinishKind, type ItemShape } from './designPlanLook.ts'

export type LibraryKind = 'finish' | 'fixture'
export type FinishUse = 'wall' | 'floor' | 'ceiling' | 'base'
export interface LibraryFinish { code: string; name: string; kind: FinishKind; /** #rrggbb */ color: string; use: FinishUse[]; note?: string }
export interface LibraryFixture {
  name: string; shape: ItemShape; w: number; d: number; h: number
  /** 바닥에서 띄운 높이 mm (벽걸이) */ z?: number
  unit: string; measure: 'count' | 'area' | 'length'
  /** 공종 이름에서 찾을 낱말 (정규식 글) */ trade?: string
  /** 저장할 때의 공종 코드 (있으면 이것을 먼저 쓴다) */ trade_code?: string
  spec?: string; finish?: string
}
export interface LibraryEntry { id: string; kind: LibraryKind; group: string; name: string; data: LibraryFinish | LibraryFixture; builtin: boolean; created_by?: string | null; created_at?: string }

export const LIBRARY_FINISH_GROUPS = ['도장 · 벽지', '타일 · 석재', '바닥재', '금속 · 유리', '천장 · 기타']
export const LIBRARY_FIXTURE_GROUPS = ['가구', '진열 · 집기', '조명기구', '위생기구', '주방 · 가전', '식물 · 소품']

const W: FinishUse[] = ['wall'], F: FinishUse[] = ['floor'], WC: FinishUse[] = ['wall', 'ceiling'], WF: FinishUse[] = ['wall', 'floor'], WB: FinishUse[] = ['wall', 'base'], C: FinishUse[] = ['ceiling']
const fin = (group: string, code: string, name: string, kind: FinishKind, color: string, use: FinishUse[], note?: string): LibraryEntry => ({ id: `b-f-${code.toLowerCase()}`, kind: 'finish', group, name: `${code} ${name}`, data: { code, name, kind, color, use, note }, builtin: true })
const FINISHES: LibraryEntry[] = [
  fin('도장 · 벽지', 'PT-01', '수성 페인트 백색', 'paint', '#f4f2ec', WC), fin('도장 · 벽지', 'PT-02', '수성 페인트 아이보리', 'paint', '#efe6d2', WC),
  fin('도장 · 벽지', 'PT-03', '수성 페인트 라이트 그레이', 'paint', '#d5d6d2', WC), fin('도장 · 벽지', 'PT-04', '수성 페인트 그레이', 'paint', '#b9bbb6', W),
  fin('도장 · 벽지', 'PT-05', '수성 페인트 차콜', 'paint', '#6f716e', W), fin('도장 · 벽지', 'PT-06', '수성 페인트 세이지 그린', 'paint', '#a9b8a2', W),
  fin('도장 · 벽지', 'PT-07', '수성 페인트 베이지', 'paint', '#dccfb4', W), fin('도장 · 벽지', 'PT-08', '수성 페인트 테라코타', 'paint', '#c9744b', W),
  fin('도장 · 벽지', 'WC-01', '실크 벽지 화이트', 'wallpaper', '#f2efe7', W), fin('도장 · 벽지', 'WC-02', '실크 벽지 아이보리', 'wallpaper', '#ece4d2', W),
  fin('도장 · 벽지', 'SH-01', '인테리어 필름 화이트', 'vinyl', '#f1efe9', W, '문 · 가구 · 몰딩 리폼'), fin('도장 · 벽지', 'SH-02', '인테리어 필름 오크 무늬', 'wood', '#d2b07a', W),
  fin('타일 · 석재', 'TL-01', '포세린 타일 600각 그레이', 'tile', '#b9bbb6', WF), fin('타일 · 석재', 'TL-02', '포세린 타일 600각 아이보리', 'tile', '#e6dfcf', WF),
  fin('타일 · 석재', 'TL-03', '도기질 타일 300각 화이트', 'tile', '#f1f0ea', W), fin('타일 · 석재', 'TL-04', '모자이크 타일 화이트', 'tile', '#ecebe4', W),
  fin('타일 · 석재', 'TL-05', '테라조 타일 라이트 그레이', 'tile', '#d9d5cc', WF), fin('타일 · 석재', 'ST-01', '대리석 화이트', 'stone', '#e8e6e1', WF),
  fin('타일 · 석재', 'ST-02', '화강석 그레이', 'stone', '#a9aaa6', F), fin('타일 · 석재', 'ST-03', '인조 대리석 아이보리', 'stone', '#ebe4d6', ['wall', 'floor', 'base']),
  fin('바닥재', 'WF-01', '원목 마루 오크 내추럴', 'wood', '#d2b07a', F), fin('바닥재', 'WF-02', '원목 마루 월넛', 'wood', '#7a5a3c', F),
  fin('바닥재', 'WF-03', '강마루 애쉬 그레이', 'wood', '#b7ab9a', F), fin('바닥재', 'VS-01', '데코타일 우드 내추럴', 'wood', '#cdb388', F),
  fin('바닥재', 'VS-02', '데코타일 스톤 그레이', 'vinyl', '#b4b5b0', F), fin('바닥재', 'CP-01', '타일 카펫 그레이', 'carpet', '#9fa19c', F),
  fin('바닥재', 'CP-02', '타일 카펫 베이지', 'carpet', '#c8bda6', F), fin('바닥재', 'CT-01', '노출 콘크리트 (에폭시 코팅)', 'concrete', '#a9a9a4', WF),
  fin('금속 · 유리', 'MT-01', '스테인리스 헤어라인 실버', 'metal', '#c8ccd0', WB), fin('금속 · 유리', 'MT-02', '황동 브라스', 'metal', '#c9a04f', WB),
  fin('금속 · 유리', 'MT-03', '분체 도장 금속 차콜', 'metal', '#5f6266', WB), fin('금속 · 유리', 'GL-01', '투명 강화 유리', 'glass', '#bcd6de', W),
  fin('금속 · 유리', 'GL-02', '불투명 유리 (샌드 블라스트)', 'glass', '#dfe9ea', W),
  fin('천장 · 기타', 'AC-01', '흡음 천장재 화이트', 'plain', '#efeee8', C), fin('천장 · 기타', 'FB-01', '패브릭 패널 베이지', 'fabric', '#cfc6b6', W),
  fin('천장 · 기타', 'FB-02', '패브릭 패널 그레이', 'fabric', '#aeb0ab', W), fin('천장 · 기타', 'WP-01', '무늬목 패널 오크', 'wood', '#cfae78', W),
]

const FURN = '가구|집기', ELEC = '전기|조명', PLUMB = '설비|위생', WOODT = '목공|가구|집기'
let n = 0
const fx = (group: string, name: string, shape: ItemShape, w: number, d: number, h: number, more: Partial<LibraryFixture> = {}): LibraryEntry => ({
  id: `b-x-${(++n).toString().padStart(3, '0')}`, kind: 'fixture', group, name,
  data: { name, shape, w, d, h, unit: 'EA', measure: 'count', trade: FURN, ...more }, builtin: true,
})
const FIXTURES: LibraryEntry[] = [
  fx('가구', '1인 소파', 'sofa', 900, 850, 800), fx('가구', '2인 소파', 'sofa', 1600, 900, 800), fx('가구', '3인 소파', 'sofa', 2100, 900, 800),
  fx('가구', '라운지 체어', 'chair', 750, 800, 780), fx('가구', '의자', 'chair', 450, 500, 800), fx('가구', '바 스툴', 'chair', 400, 400, 750),
  fx('가구', '벤치 1500', 'bench', 1500, 450, 450), fx('가구', '소파 테이블', 'table', 1200, 600, 450), fx('가구', '사이드 테이블', 'round', 500, 500, 550),
  fx('가구', '4인 테이블', 'table', 1200, 750, 720), fx('가구', '6인 테이블', 'table', 1800, 900, 720), fx('가구', '원형 테이블 Φ900', 'round', 900, 900, 720),
  fx('가구', '회의 테이블 2400', 'table', 2400, 1200, 720), fx('가구', '책상 1400', 'table', 1400, 700, 720), fx('가구', '책장 800', 'shelf', 800, 300, 2000),
  fx('가구', '수납장 1200', 'cabinet', 1200, 450, 800), fx('가구', '붙박이장 (m 당)', 'cabinet', 1000, 600, 2300, { unit: 'm', measure: 'length', trade: WOODT }),
  fx('가구', '침대 싱글', 'bed', 1000, 2000, 500), fx('가구', '침대 퀸', 'bed', 1500, 2000, 500), fx('가구', '침대 킹', 'bed', 1600, 2000, 500),
  fx('진열 · 집기', '진열 선반 1200', 'shelf', 1200, 400, 1800), fx('진열 · 집기', '진열 선반 900', 'shelf', 900, 400, 1800), fx('진열 · 집기', '벽 선반 (m 당)', 'shelf', 1000, 300, 40, { z: 1500, unit: 'm', measure: 'length', trade: WOODT }),
  fx('진열 · 집기', '행거 1200', 'shelf', 1200, 500, 1600), fx('진열 · 집기', '쇼케이스 1200', 'counter', 1200, 600, 1000), fx('진열 · 집기', '진열 테이블 1500', 'table', 1500, 750, 850),
  fx('진열 · 집기', '카운터 1800', 'counter', 1800, 600, 1000), fx('진열 · 집기', '안내 데스크 2400', 'counter', 2400, 700, 1050), fx('진열 · 집기', '계산대 1200', 'counter', 1200, 600, 950),
  fx('진열 · 집기', '포토월 3000', 'screen', 3000, 150, 2400, { trade: WOODT }), fx('진열 · 집기', '그래픽 패널 1200', 'screen', 1200, 60, 2400, { trade: '사인|그래픽|목공' }),
  fx('진열 · 집기', '배너 600', 'screen', 600, 300, 1800, { trade: '사인|그래픽' }), fx('진열 · 집기', '단상 2400', 'platform', 2400, 1200, 300, { trade: WOODT }),
  fx('진열 · 집기', '무대 3600 (㎡ 당)', 'platform', 3600, 2400, 450, { unit: 'm2', measure: 'area', trade: WOODT }), fx('진열 · 집기', '체험 테이블 1800', 'table', 1800, 800, 900),
  fx('진열 · 집기', '피팅룸 1200', 'box', 1200, 1200, 2200, { trade: WOODT }), fx('진열 · 집기', '창고 선반 (랙) 1200', 'shelf', 1200, 500, 2000),
  fx('조명기구', '매입등 (다운라이트) 3인치', 'downlight', 90, 90, 60, { trade: ELEC, spec: 'DL · 3인치' }), fx('조명기구', '매입등 (다운라이트) 6인치', 'downlight', 170, 170, 80, { trade: ELEC, spec: 'DL · 6인치' }),
  fx('조명기구', '펜던트 조명 Φ400', 'pendant', 400, 400, 900, { trade: ELEC }), fx('조명기구', '펜던트 조명 Φ600', 'pendant', 600, 600, 1000, { trade: ELEC }),
  fx('조명기구', '레일 조명 (m 당)', 'downlight', 1000, 40, 60, { unit: 'm', measure: 'length', trade: ELEC, spec: '레일 · 스폿' }), fx('조명기구', '라인 조명 (m 당)', 'downlight', 1000, 50, 40, { unit: 'm', measure: 'length', trade: ELEC, spec: 'LED 라인' }),
  fx('조명기구', '플로어 스탠드', 'light', 350, 350, 1600, { trade: ELEC }), fx('조명기구', '테이블 스탠드', 'light', 250, 250, 500, { trade: ELEC, z: 720 }),
  fx('위생기구', '양변기', 'toilet', 400, 700, 780, { trade: PLUMB }), fx('위생기구', '소변기', 'toilet', 400, 350, 700, { trade: PLUMB, z: 500 }),
  fx('위생기구', '세면대', 'basin', 600, 450, 850, { trade: PLUMB }), fx('위생기구', '세면대 (카운터형) 1200', 'basin', 1200, 550, 850, { trade: PLUMB }),
  fx('위생기구', '욕조 1500', 'bathtub', 1500, 750, 550, { trade: PLUMB }), fx('위생기구', '샤워부스 900', 'box', 900, 900, 2000, { trade: PLUMB, finish: 'GL-01 투명 강화 유리' }),
  fx('위생기구', '청소용 개수대', 'sink', 600, 500, 850, { trade: PLUMB }),
  fx('주방 · 가전', '싱크대 2400', 'sink', 2400, 600, 850, { trade: '주방|가구|설비' }), fx('주방 · 가전', '아일랜드 1800', 'counter', 1800, 900, 900, { trade: '주방|가구' }),
  fx('주방 · 가전', '상부장 (m 당)', 'cabinet', 1000, 350, 700, { z: 1500, unit: 'm', measure: 'length', trade: '주방|가구' }), fx('주방 · 가전', '냉장고', 'appliance', 900, 800, 1800, { trade: '가전|집기|가구' }),
  fx('주방 · 가전', '쇼케이스 냉장고', 'appliance', 650, 650, 1900, { trade: '가전|집기|가구' }), fx('주방 · 가전', '세탁기', 'appliance', 600, 650, 850, { trade: '가전|집기|가구' }),
  fx('주방 · 가전', '스탠드 에어컨', 'appliance', 400, 400, 1850, { trade: '설비|공조|가전' }), fx('주방 · 가전', '커피 머신', 'appliance', 500, 600, 600, { z: 900, trade: '가전|집기|가구' }),
  fx('주방 · 가전', 'TV 65인치 (벽걸이)', 'tv', 1450, 80, 840, { z: 900, trade: '전기|가전|집기' }), fx('주방 · 가전', '모니터 43인치 (벽걸이)', 'tv', 970, 70, 570, { z: 1200, trade: '전기|가전|집기' }),
  fx('식물 · 소품', '화분 (대)', 'plant', 500, 500, 1600), fx('식물 · 소품', '화분 (중)', 'plant', 350, 350, 900), fx('식물 · 소품', '러그 2000', 'rug', 2000, 1400, 20),
  fx('식물 · 소품', '러그 3000', 'rug', 3000, 2000, 20), fx('식물 · 소품', '전신 거울', 'screen', 600, 50, 1800), fx('식물 · 소품', '휴지통', 'box', 300, 300, 600),
]

/** 기본 제공 라이브러리 (builtin · id 'b-…') */
export const BUILTIN_LIBRARY: LibraryEntry[] = [...FINISHES, ...FIXTURES]

/** 벽 · 실 마감에 적는 글: 'PT-01 수성 페인트 백색' */
export const finishText = (f: LibraryFinish) => [f.code.trim(), f.name.trim()].filter(Boolean).join(' ')

/** 기구에 맞는 공종 코드. 낱말이 맞는 공종이 없으면 '' — 화면에서 고르게 한다 */
export function fixtureTrade(f: LibraryFixture, trades: { code: string; name: string }[]): string {
  if (f.trade_code && trades.some(t => t.code === f.trade_code)) return f.trade_code
  for (const word of (f.trade ?? FURN).split('|').map(s => s.trim()).filter(Boolean)) {
    const hit = trades.find(t => t.name.includes(word))
    if (hit) return hit.code
  }
  // 맞는 공종이 없으면 '기타' — 공종이 비면 수량표에서 빠지므로 비워 두지 않는다
  return trades.find(t => t.code === 'T99')?.code ?? ''
}

const SHAPES = new Set<string>(ITEM_SHAPES.map(([k]) => k))
const size = (v: unknown, fallback: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x > 0 ? Math.min(x, 20000) : fallback }

/** 라이브러리 기구 → 평면 부품 (at = 왼쪽 위 모서리 mm) */
export function fixtureToItem(f: LibraryFixture, at: { x: number; y: number }, trades: { code: string; name: string }[], id: string): PlanItem {
  const z = Number(f.z)
  return {
    id, x: Math.round(at.x), y: Math.round(at.y), w: size(f.w, 600), d: size(f.d, 600), h: size(f.h, 900), rot: 0,
    name: f.name.trim(), trade_code: fixtureTrade(f, trades), spec: f.spec?.trim() ?? '', unit: f.unit || 'EA', measure: f.measure ?? 'count', section: null,
    shape: SHAPES.has(f.shape) ? f.shape : 'box', ...(Number.isFinite(z) && z > 0 ? { z: Math.round(z) } : {}), ...(f.finish?.trim() ? { finish: f.finish.trim() } : {}),
  }
}

/** 평면 부품 → 라이브러리 기구 (저장용). 모양은 이름으로 알아본 것까지 적고, 공종 코드도 같이 남긴다 */
export function itemToFixture(it: PlanItem): LibraryFixture {
  return {
    name: it.name.trim() || '부품', shape: itemShape(it.name, it.shape && SHAPES.has(it.shape) ? it.shape : null), w: size(it.w, 600), d: size(it.d, 600), h: size(it.h, 900),
    ...(it.trade_code ? { trade_code: it.trade_code } : {}),
    ...(it.z && it.z > 0 ? { z: Math.round(it.z) } : {}), unit: it.unit || 'EA', measure: it.measure ?? 'count',
    ...(it.spec?.trim() ? { spec: it.spec.trim() } : {}), ...(it.finish?.trim() ? { finish: it.finish.trim() } : {}),
  }
}

/** 저장된 자료가 라이브러리 항목으로 쓸 수 있는 모양인지 (DB · 다른 사람이 저장한 값은 믿지 않는다) */
export function validLibraryData(kind: LibraryKind, data: unknown): data is LibraryFinish | LibraryFixture {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (kind === 'finish') return typeof d.name === 'string' && typeof d.code === 'string' && typeof d.kind === 'string' && /^#[0-9a-f]{6}$/i.test(String(d.color)) && Array.isArray(d.use)
  return typeof d.name === 'string' && typeof d.shape === 'string' && [d.w, d.d, d.h].every(v => Number.isFinite(Number(v)) && Number(v) > 0)
}
