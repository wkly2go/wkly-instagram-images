// 평면 · 3D 를 현실에 가깝게 (2026-11-17 대표 지시 '평면과 3D 작업공간을 더욱 현실에 맞게')
// 마감 글(PT-01 수성 페인트 백색)에서 재료 종류와 색을, 부품 이름(소파 · 진열 선반)에서 모양을 알아본다.
// 외부 자료 · 유료 도구 없이 글만으로 정한다. 모르면 중립 값 — 지어내지 않는다.

export type FinishKind = 'paint' | 'wallpaper' | 'wood' | 'tile' | 'stone' | 'metal' | 'glass' | 'fabric' | 'carpet' | 'vinyl' | 'concrete' | 'plain'
export interface FinishLook { kind: FinishKind; /** #rrggbb */ color: string; roughness: number; metalness: number; /** 알아본 근거 (화면 안내용) */ label: string }

/** 재료 번호 앞 글자 → 재료 종류 (표본 도면의 번호 체계) */
const CODE_KIND: Record<string, FinishKind> = {
  PT: 'paint', WP: 'wallpaper', WC: 'wallpaper', SH: 'vinyl', VS: 'vinyl', TL: 'tile', ST: 'stone', AS: 'stone', MT: 'metal', GL: 'glass',
  AC: 'plain', FB: 'fabric', LE: 'fabric', WF: 'wood', WD: 'wood', CP: 'carpet', CT: 'concrete',
}
const KIND_WORDS: [RegExp, FinishKind][] = [
  [/원목|우드|목재|합판|마루|오크|월넛|애쉬|티크|자작|무늬목|wood|oak|walnut/i, 'wood'],
  [/타일|tile|포세린|자기질/i, 'tile'],
  [/대리석|마블|화강|석재|테라조|인조석|stone|marble|terrazzo/i, 'stone'],
  [/카펫|carpet|러그/i, 'carpet'],
  [/스테인리스|스텐|sus|금속|메탈|철판|알루미늄|황동|브라스|갈바|metal|steel/i, 'metal'],
  [/유리|글라스|glass|미러|거울/i, 'glass'],
  [/패브릭|원단|천|가죽|fabric|leather/i, 'fabric'],
  [/콘크리트|노출|몰탈|에폭시|concrete|mortar/i, 'concrete'],
  [/벽지|도배|wallpaper/i, 'wallpaper'],
  [/장판|데코타일|비닐|시트|필름|pvc|lvt/i, 'vinyl'],
  [/페인트|도장|paint|수성|유성/i, 'paint'],
]
const KIND_BASE: Record<FinishKind, { color: string; roughness: number; metalness: number }> = {
  paint: { color: '#f3f1ea', roughness: 0.92, metalness: 0 }, wallpaper: { color: '#efece3', roughness: 0.95, metalness: 0 }, wood: { color: '#c9a36b', roughness: 0.7, metalness: 0 },
  tile: { color: '#e3e1da', roughness: 0.45, metalness: 0 }, stone: { color: '#d8d5cd', roughness: 0.4, metalness: 0 }, metal: { color: '#c2c6c9', roughness: 0.35, metalness: 0.85 },
  glass: { color: '#bcd6de', roughness: 0.08, metalness: 0 }, fabric: { color: '#cfc6b6', roughness: 1, metalness: 0 }, carpet: { color: '#b9b3a6', roughness: 1, metalness: 0 },
  vinyl: { color: '#d9d2c0', roughness: 0.6, metalness: 0 }, concrete: { color: '#b0b0aa', roughness: 0.85, metalness: 0 }, plain: { color: '#ecebe6', roughness: 0.9, metalness: 0 },
}
/** 색 낱말 → 색. 먼저 맞는 것이 이긴다 (긴 낱말을 앞에) */
const COLOR_WORDS: [RegExp, string][] = [
  [/다크\s*그레이|진회색|차콜|charcoal/i, '#6f716e'], [/라이트\s*그레이|연회색/i, '#d5d6d2'], [/그레이|회색|gray|grey/i, '#b9bbb6'],
  [/아이보리|크림|미색|ivory|cream/i, '#efe6d2'], [/베이지|beige|샌드/i, '#dccfb4'], [/화이트|백색|흰색|white/i, '#f4f2ec'],
  [/블랙|흑색|검정|black/i, '#45474a'], [/월넛|다크\s*브라운|walnut/i, '#7a5a3c'], [/브라운|갈색|brown/i, '#94704c'], [/오크|내추럴|natural|oak|자작|애쉬/i, '#d2b07a'],
  [/네이비|navy/i, '#2f4368'], [/블루|청색|파랑|blue/i, '#6f93b8'], [/민트|mint/i, '#a9d1c2'], [/그린|녹색|초록|green|올리브/i, '#7e9a79'],
  [/버건디|와인/i, '#7a3340'], [/레드|적색|빨강|red/i, '#b5574b'], [/핑크|분홍|pink/i, '#e3a9b5'], [/옐로|노랑|황색|yellow|머스타드/i, '#e2c35c'],
  [/테라코타|오렌지|주황|orange/i, '#c9744b'], [/골드|금색|황동|브라스|gold|brass/i, '#c9a04f'], [/실버|은색|스테인리스|스텐|sus|silver/i, '#c8ccd0'],
]

/** 마감 글 → 재료 종류 · 색. 글이 없으면 fallback 종류의 중립 색 */
export function finishLook(text?: string | null, fallback: FinishKind = 'plain'): FinishLook {
  const t = (text ?? '').trim()
  if (!t) return { kind: fallback, ...KIND_BASE[fallback], label: '' }
  const code = t.toUpperCase().match(/^[A-Z]{2,3}(?=[-\s]?\d)/)?.[0] ?? ''
  const kind = KIND_WORDS.find(([re]) => re.test(t))?.[1] ?? CODE_KIND[code] ?? fallback
  const word = COLOR_WORDS.find(([re]) => re.test(t))
  const base = KIND_BASE[kind]
  // 금속 색 낱말(골드 · 실버)은 금속으로 본다
  const metal = kind === 'metal' || (!!word && /골드|금색|황동|브라스|gold|brass|실버|은색|스테인리스|스텐|sus|silver/i.test(t) && !KIND_WORDS.slice(0, 4).some(([re]) => re.test(t)))
  return { kind: metal ? 'metal' : kind, color: word?.[1] ?? base.color, roughness: metal ? 0.35 : base.roughness, metalness: metal ? 0.85 : base.metalness, label: [code || null, word ? word[0].source.split('|')[0].replace(/\\s\*/g, ' ') : null].filter(Boolean).join(' · ') }
}

/** 스펙북의 재료 번호(PT-01)로 적힌 마감이면 그 재료의 이름 · 규격을 붙여 색 낱말을 찾을 수 있게 한다 */
export function resolveFinish(text: string | undefined | null, specs: { code?: string | null; name?: string | null; spec?: string | null }[]): string {
  const t = (text ?? '').trim()
  if (!t) return ''
  const code = t.toUpperCase().match(/^[A-Z]{2,3}[-\s]?\d+/)?.[0]?.replace(/\s/g, '')
  const hit = code ? specs.find(s => (s.code ?? '').toUpperCase().replace(/\s/g, '') === code) : undefined
  return hit ? [t, hit.name, hit.spec].filter(Boolean).join(' ') : t
}

export type ItemShape = 'table' | 'round' | 'chair' | 'bench' | 'sofa' | 'bed' | 'shelf' | 'counter' | 'cabinet' | 'plant' | 'rug' | 'light' | 'pendant' | 'downlight' | 'screen' | 'tv' | 'platform' | 'toilet' | 'basin' | 'bathtub' | 'sink' | 'appliance' | 'box'
export const ITEM_SHAPES: [ItemShape, string][] = [
  ['box', '상자'], ['table', '테이블'], ['round', '원형 테이블'], ['chair', '의자'], ['bench', '벤치'], ['sofa', '소파'], ['bed', '침대'], ['shelf', '선반 · 진열'],
  ['counter', '카운터'], ['cabinet', '수납장'], ['plant', '식물'], ['rug', '러그'], ['light', '스탠드 조명'], ['pendant', '펜던트 조명'], ['downlight', '매입등'],
  ['screen', '패널 · 사인'], ['tv', 'TV · 모니터'], ['platform', '단상 · 무대'], ['toilet', '양변기'], ['basin', '세면대'], ['bathtub', '욕조'], ['sink', '싱크대'], ['appliance', '가전'],
]
const SHAPE_WORDS: [RegExp, ItemShape][] = [
  [/소파|쇼파|카우치|sofa|couch/i, 'sofa'], [/벤치|bench/i, 'bench'], [/의자|체어|스툴|chair|stool/i, 'chair'],
  [/원형\s*테이블|라운드\s*테이블|원탁|round/i, 'round'], [/침대|bed/i, 'bed'],
  [/카운터|계산대|리셉션|안내\s*데스크|인포|바\s*테이블|counter|reception/i, 'counter'],
  [/테이블|탁자|책상|데스크|작업대|table|desk/i, 'table'],
  [/선반|진열|랙|행거|책장|쇼케이스|디스플레이|매대|shelf|rack|display/i, 'shelf'],
  [/수납|캐비닛|서랍|락커|붙박이|장롱|cabinet|locker/i, 'cabinet'],
  [/양변기|변기|toilet/i, 'toilet'], [/세면대|세면기|basin|lavatory/i, 'basin'], [/욕조|bathtub/i, 'bathtub'], [/싱크|개수대|sink/i, 'sink'],
  [/냉장고|세탁기|건조기|에어컨|식기세척|오븐|정수기|가전|refrigerator|washer/i, 'appliance'], [/TV|티브이|모니터|디스플레이\s*패널|monitor/i, 'tv'],
  [/화분|식물|플랜트|조경|나무|plant|tree/i, 'plant'], [/러그|카펫|매트|rug|mat/i, 'rug'],
  [/펜던트|샹들리에|pendant/i, 'pendant'], [/매입등|다운라이트|downlight|레일등|스폿/i, 'downlight'], [/조명|스탠드|램프|lamp|light/i, 'light'],
  [/단상|무대|스테이지|플랫폼|포디움|데크|platform|stage|podium/i, 'platform'],
  [/파티션|포토월|배너|현수막|사인|사이니지|스크린|패널|그래픽|월$|wall|sign|screen|panel/i, 'screen'],
]
/** 부품 이름 → 모양. 모르면 상자 */
export function itemShape(name: string, explicit?: string | null): ItemShape {
  if (explicit && ITEM_SHAPES.some(([k]) => k === explicit)) return explicit as ItemShape
  return SHAPE_WORDS.find(([re]) => re.test(name))?.[1] ?? 'box'
}
/** 모양별 기본 색 (3D · 평면 기호). UI 색(초록 · 분홍)과 겹치지 않는 가구 색 */
export const SHAPE_COLOR: Record<ItemShape, string> = {
  table: '#c9a36b', round: '#c9a36b', chair: '#b8a58c', bench: '#c2ab86', sofa: '#b9b2a6', bed: '#e6e1d6', shelf: '#d9cdb6', counter: '#e9e5db', cabinet: '#d6cbb7',
  plant: '#6f9468', rug: '#c7b9a6', light: '#f1e2b0', pendant: '#f1e2b0', downlight: '#f6efd2', screen: '#dfe3e6', tv: '#5a5f66', platform: '#cdbfa6',
  toilet: '#f4f4f1', basin: '#f4f4f1', bathtub: '#f4f4f1', sink: '#d9dcde', appliance: '#dfe2e4', box: '#d8d2c4',
}

const hex = (c: string) => { const m = c.replace('#', ''); return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16)) }
/** 색 섞기 (0 = a, 1 = b) */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
