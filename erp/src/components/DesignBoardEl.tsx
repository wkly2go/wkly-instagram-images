// 제안 보드의 요소 그리기 — 판 · 발표 보기 · 인쇄가 같은 모양으로 같이 쓴다.
// 스펙 카드 · 일람표 · 사진은 스펙북과 투시도를 그때그때 읽어 그린다 (보드에는 번호만 저장).
// 글자 크기는 화면 글자가 아니라 16:9 페이지(가로 1600) 안의 문서 글자라 페이지 단위 숫자로 준다.
import { createContext, useContext, type CSSProperties } from 'react'
import { SPEC_BOOKS, SPEC_STATUS, type DesignRender, type SpecBook, type SpecItem } from '../lib/design'
import { finishLook, resolveFinish, type FinishKind, type FinishLook } from '../lib/designPlanLook'
import { BUILTIN_LIBRARY, finishText, type LibraryFinish } from '../lib/designLibrary'
import type { BoardEl, BoardPage } from '../lib/designBoard'

export interface BoardData { specs: SpecItem[]; images: Record<string, string>; renders: DesignRender[] }
export const BoardDataContext = createContext<BoardData>({ specs: [], images: {}, renders: [] })

export const TEXT_PX = { title: 64, sub: 36, body: 24 } as const
export const INK = '#141414'
export const KIND_LABEL: Record<FinishKind, string> = {
  paint: '도장', wallpaper: '벽지', wood: '목재', tile: '타일', stone: '석재', metal: '금속', glass: '유리', fabric: '패브릭', carpet: '카펫', vinyl: '시트 · 필름', concrete: '콘크리트', plain: '',
}
export const STATUS_KEYS = ['review', 'selected', 'confirmed', 'dropped'] as const

/** 스펙 항목의 마감 색 (사진이 없을 때 견본으로 보여 준다) */
export function specLook(item: Pick<SpecItem, 'code' | 'name' | 'spec' | 'finish'>, specs: SpecItem[]): FinishLook {
  return finishLook(resolveFinish([item.code, item.name, item.spec, item.finish].filter(Boolean).join(' '), specs), 'plain')
}
/** 마감 글의 색: 기본 라이브러리에 있는 마감이면 그 색, 아니면 글에서 알아본다 */
export function swatchLook(text: string | undefined, specs: SpecItem[]): FinishLook {
  const t = (text ?? '').trim()
  const lib = BUILTIN_LIBRARY.find(e => e.kind === 'finish' && finishText(e.data as LibraryFinish) === t)
  if (lib) { const d = lib.data as LibraryFinish; return { ...finishLook(t, d.kind), kind: d.kind, color: d.color } }
  return finishLook(resolveFinish(t, specs), 'plain')
}
/** 재료 종류에 맞는 견본 무늬 (색 위에 옅은 결) */
export function swatchStyle(look: FinishLook): CSSProperties {
  const c = look.color
  const img: Partial<Record<FinishKind, [string, string?]>> = {
    wood: ['repeating-linear-gradient(90deg, rgba(60,40,20,.10) 0 2px, rgba(255,255,255,.05) 2px 9px, transparent 9px 58px), linear-gradient(180deg, rgba(255,255,255,.14), rgba(0,0,0,.05))'],
    tile: ['linear-gradient(rgba(255,255,255,.75) 3px, transparent 3px), linear-gradient(90deg, rgba(255,255,255,.75) 3px, transparent 3px)', '72px 72px'],
    stone: ['radial-gradient(ellipse at 20% 30%, rgba(255,255,255,.5), transparent 45%), radial-gradient(ellipse at 75% 70%, rgba(0,0,0,.06), transparent 50%), linear-gradient(120deg, transparent 46%, rgba(255,255,255,.35) 48%, transparent 51%)'],
    metal: ['linear-gradient(115deg, rgba(255,255,255,.6), transparent 34%, rgba(255,255,255,.4) 56%, transparent 78%), repeating-linear-gradient(0deg, rgba(255,255,255,.12) 0 1px, transparent 1px 4px)'],
    glass: ['linear-gradient(135deg, rgba(255,255,255,.75), transparent 48%, rgba(255,255,255,.3) 80%)'],
    fabric: ['repeating-linear-gradient(45deg, rgba(0,0,0,.05) 0 2px, transparent 2px 7px), repeating-linear-gradient(-45deg, rgba(255,255,255,.14) 0 2px, transparent 2px 7px)'],
    carpet: ['radial-gradient(rgba(0,0,0,.08) 1.5px, transparent 1.6px)', '9px 9px'],
    concrete: ['radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.3), transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(0,0,0,.07), transparent 55%)'],
    vinyl: ['linear-gradient(180deg, rgba(255,255,255,.18), transparent)'],
  }
  const hit = img[look.kind]
  return { backgroundColor: c, backgroundImage: hit?.[0], backgroundSize: hit?.[1] }
}

export function textStyle(el: BoardEl): CSSProperties {
  const s = el.style ?? {}, size = s.size ?? 'body'
  return { fontSize: TEXT_PX[size], lineHeight: size === 'title' ? 1.18 : size === 'sub' ? 1.3 : 1.5, fontWeight: s.bold ? (size === 'title' ? 800 : 700) : 400, textAlign: s.align ?? (el.type === 'rect' ? 'center' : 'left'), color: s.color ?? INK }
}

function StatusMark({ status }: { status: SpecItem['status'] }) {
  return <span className={`dbd-st dbd-st-${status}`}>{SPEC_STATUS[status] ?? status}</span>
}

/** 스펙 항목의 사진 또는 마감 견본 (목록의 작은 그림 · 카드의 큰 그림) */
export function SpecThumb({ item, className = '' }: { item: SpecItem; className?: string }) {
  const { specs, images } = useContext(BoardDataContext)
  const photo = images[item.id]
  if (photo) return <span className={`dbd-thumb ${className}`}><img src={photo} alt="" draggable={false} /></span>
  const look = specLook(item, specs)
  return <span className={`dbd-thumb ${className}`} style={swatchStyle(look)} title={KIND_LABEL[look.kind] || undefined} />
}

function SpecCard({ el }: { el: BoardEl }) {
  const { specs } = useContext(BoardDataContext)
  const item = specs.find(s => s.id === el.spec_id)
  if (!item) return <div className="dbd-card dbd-card-gone"><b>스펙북에서 지워진 항목</b><span>이 카드는 지워도 됩니다.</span></div>
  const wide = el.w > el.h * 1.35
  const meta = [item.maker, item.location].filter(Boolean).join(' · ')
  return (
    <div className={`dbd-card${wide ? ' wide' : ''}${item.status === 'dropped' ? ' dropped' : ''}`}>
      <SpecThumb item={item} className="dbd-card-pic" />
      <div className="dbd-card-body">
        <div className="dbd-card-top"><b className="dbd-card-code">{item.code || SPEC_BOOKS[item.book]?.split(' ')[0] || '스펙'}</b><StatusMark status={item.status} /></div>
        <b className="dbd-card-name">{item.name}</b>
        {item.spec && <span className="dbd-card-spec">{item.spec}</span>}
        {meta && <span className="dbd-card-meta">{meta}</span>}
      </div>
    </div>
  )
}

function Swatch({ el }: { el: BoardEl }) {
  const { specs } = useContext(BoardDataContext)
  const look = swatchLook(el.finish, specs), t = (el.finish ?? '').trim()
  // 번호만 적힌 마감(PT-01)이면 스펙북의 이름 · 규격을 아래 줄에 붙여 준다
  const more = /^[A-Za-z]{2,3}[-\s]?\d+$/.test(t) ? resolveFinish(t, specs).slice(t.length).trim() : ''
  const sub = [more, KIND_LABEL[look.kind]].filter(Boolean).join(' · ')
  return (
    <div className="dbd-swatch">
      <div className="dbd-swatch-chip" style={swatchStyle(look)} />
      <div className="dbd-swatch-cap"><b>{t || '마감을 골라 주세요'}</b>{sub && <span>{sub}</span>}</div>
    </div>
  )
}

/** 스펙 일람표에 들어가는 항목: 선정 · 확정한 것 (종류를 정했으면 그 종류만) */
export function scheduleRows(specs: SpecItem[], book?: string): SpecItem[] {
  return specs.filter(s => (s.status === 'selected' || s.status === 'confirmed') && (!book || s.book === book)).sort((a, b) => a.book.localeCompare(b.book) || (a.code ?? '').localeCompare(b.code ?? '') || a.name.localeCompare(b.name))
}
function SpecTable({ el }: { el: BoardEl }) {
  const { specs } = useContext(BoardDataContext)
  const rows = scheduleRows(specs, el.book)
  const fit = Math.max(1, Math.floor((el.h - 64 - 46) / 44))
  const show = rows.length > fit ? rows.slice(0, Math.max(1, fit - 1)) : rows
  return (
    <div className="dbd-table">
      <div className="dbd-table-title">{el.book ? `${(SPEC_BOOKS[el.book as SpecBook] ?? el.book).split(' (')[0]} 일람표` : '스펙 일람표'}<span>선정 · 확정 {rows.length}개</span></div>
      <div className="dbd-table-row head"><span>번호</span><span>이름</span><span>규격</span><span>제조사</span><span>상태</span></div>
      {show.map(r => <div className="dbd-table-row" key={r.id}><span>{r.code ?? ''}</span><span>{r.name}</span><span>{r.spec ?? ''}</span><span>{r.maker ?? ''}</span><span><StatusMark status={r.status} /></span></div>)}
      {rows.length === 0 && <div className="dbd-table-none">선정 · 확정한 항목이 아직 없습니다. 스펙 탭에서 상태를 정하면 여기에 바로 나타납니다.</div>}
      {rows.length > show.length && <div className="dbd-table-none">외 {rows.length - show.length}개 — 표를 아래로 늘리면 더 보입니다.</div>}
    </div>
  )
}

function Picture({ el }: { el: BoardEl }) {
  const { specs, images, renders } = useContext(BoardDataContext)
  const [kind, id] = (el.src ?? '').split(/:(.*)/)
  if (kind === 'render') {
    const r = renders.find(x => x.id === id)
    if (r?.data) return <img className="dbd-img" src={r.data} alt={r.title} draggable={false} />
    return <div className="dbd-img-none"><b>{r ? `${r.no} ${r.title}` : '지워진 투시도'}</b><span>{r ? '아직 올린 그림이 없습니다. 평면 · 3D 의 투시도에 그림을 올리면 여기에 나타납니다.' : '이 칸은 지워도 됩니다.'}</span></div>
  }
  const item = specs.find(s => s.id === id), photo = id ? images[id] : undefined
  if (photo) return <img className="dbd-img" src={photo} alt={item?.name ?? ''} draggable={false} />
  return <div className="dbd-img-none"><b>{item ? `${item.code ?? ''} ${item.name}`.trim() : '사진 없음'}</b><span>{item ? '스펙북에 샘플 사진을 올리면 여기에 나타납니다.' : '이 칸은 지워도 됩니다.'}</span></div>
}

export function BoardElView({ el }: { el: BoardEl }) {
  const s = el.style ?? {}
  switch (el.type) {
    case 'text': return <div className="dbd-text" style={{ ...textStyle(el), background: s.fill }}>{el.text || <i className="dbd-ph">두 번 눌러 글을 적으세요</i>}</div>
    case 'note': return <div className="dbd-note" style={{ ...textStyle(el), background: s.fill ?? '#fff3bf' }}>{el.text || <i className="dbd-ph">메모</i>}</div>
    case 'rect': return <div className="dbd-rect" style={{ ...textStyle(el), background: s.fill ?? '#f0f0ee', boxShadow: s.stroke ? `inset 0 0 0 2px ${s.stroke}` : undefined }}>{el.text ? <span>{el.text}</span> : null}</div>
    case 'spec': return <SpecCard el={el} />
    case 'swatch': return <Swatch el={el} />
    case 'table': return <SpecTable el={el} />
    case 'image': return <Picture el={el} />
    default: return null
  }
}

export const elBox = (e: BoardEl): CSSProperties => ({ left: e.x, top: e.y, width: e.w, height: e.h })

/** 읽기만 하는 페이지 한 장 (발표 보기 · 인쇄) */
export function BoardPageView({ page }: { page: BoardPage }) {
  return (
    <div className="dbd-page" style={{ width: page.w, height: page.h, background: page.bg ?? '#fff' }}>
      {[...page.els].sort((a, b) => a.z - b.z).map(e => <div key={e.id} className={`dbd-el dbd-el-${e.type}`} style={elBox(e)}><BoardElView el={e} /></div>)}
    </div>
  )
}

/** 요소 이름 (레이어 목록 · 속성 제목) */
export function elLabel(e: BoardEl, specs: SpecItem[], renders: DesignRender[]): string {
  const cut = (t?: string) => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, 22)
  if (e.type === 'text') return cut(e.text) || '글'
  if (e.type === 'note') return `메모 · ${cut(e.text) || '빈 메모'}`
  if (e.type === 'rect') return cut(e.text) ? `사각형 · ${cut(e.text)}` : '사각형'
  if (e.type === 'spec') { const s = specs.find(x => x.id === e.spec_id); return s ? `스펙 · ${[s.code, s.name].filter(Boolean).join(' ')}` : '스펙 · 지워진 항목' }
  if (e.type === 'swatch') return `견본 · ${cut(e.finish) || '마감 미정'}`
  if (e.type === 'table') return e.book ? `일람표 · ${(SPEC_BOOKS[e.book as SpecBook] ?? e.book).split(' ')[0]}` : '스펙 일람표'
  const [kind, id] = (e.src ?? '').split(/:(.*)/)
  if (kind === 'render') { const r = renders.find(x => x.id === id); return `투시도 · ${r ? r.title : '지워짐'}` }
  const s = specs.find(x => x.id === id)
  return `사진 · ${s ? s.name : '없음'}`
}
