// 마감재 · 기구 라이브러리 칸 (2026-11-17 대표 지시 '마감재와 각종 기구들을 저장해서 바로 사용할 수 있게 만들어')
// 기본 제공 + 회사가 저장한 것 + 이 프로젝트 스펙북의 마감재를 한 목록에서 찾아, 누르면 바로 마감을 넣거나 평면에 놓는다.
// 평면 작업 공간(DesignPlan)의 오른쪽 칸에 들어간다. 자료 모양과 저장은 lib/designLibrary · lib/designApi 가 맡는다.
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { BookmarkPlus, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from './ui'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import type { SpecItem } from '../lib/design'
import type { PlanItem } from '../lib/designPlan'
import { finishLook, ITEM_SHAPES, itemShape, resolveFinish, type FinishKind, type ItemShape } from '../lib/designPlanLook'
import { BUILTIN_LIBRARY, LIBRARY_FINISH_GROUPS, LIBRARY_FIXTURE_GROUPS, finishText, itemToFixture, validLibraryData, type LibraryEntry, type LibraryFinish, type LibraryFixture, type LibraryKind } from '../lib/designLibrary'
import { ShapeIcon } from './DesignPlanSymbols'
import './DesignPlanLibrary.css'

type Target = 'wall' | 'floor' | 'ceiling' | 'base'
type Row = LibraryEntry & { origin: 'builtin' | 'saved' | 'project' }
type Draft =
  | { type: 'finish'; from: 'selected' | 'new'; code: string; name: string; kind: FinishKind; color: string; use: Target[]; group: string }
  | { type: 'fixture'; name: string; group: string; shape: ItemShape; shapeSet: boolean; w: string; d: string; h: string; z: string; unit: string }

const ALL = '전체', MINE = '내 저장', PROJECT = '이 프로젝트'
const TARGETS: [Target, string][] = [['wall', '벽'], ['floor', '바닥'], ['ceiling', '천장'], ['base', '걸레받이']]
const USE_LABEL: Record<Target, string> = { wall: '벽', floor: '바닥', ceiling: '천장', base: '걸레받이' }
const KIND_LABEL: Record<FinishKind, string> = {
  paint: '도장', wallpaper: '벽지', wood: '목재 · 마루', tile: '타일', stone: '석재', metal: '금속', glass: '유리', fabric: '패브릭', carpet: '카펫', vinyl: '필름 · 데코타일', concrete: '콘크리트', plain: '그 밖',
}
const KINDS = Object.keys(KIND_LABEL) as FinishKind[]
const USE_BY_KIND: Record<FinishKind, Target[]> = {
  paint: ['wall', 'ceiling'], wallpaper: ['wall', 'ceiling'], wood: ['floor', 'wall', 'base'], tile: ['wall', 'floor'], stone: ['wall', 'floor', 'base'], metal: ['wall', 'base'],
  glass: ['wall'], fabric: ['wall'], carpet: ['floor'], vinyl: ['floor', 'wall'], concrete: ['wall', 'floor'], plain: ['wall', 'floor', 'ceiling', 'base'],
}
const FALLBACK: Record<Target, FinishKind> = { wall: 'paint', floor: 'wood', ceiling: 'paint', base: 'wood' }
const UNIT_OPTIONS: [string, string, LibraryFixture['measure']][] = [['EA', '개 (EA)', 'count'], ['m', '길이 (m)', 'length'], ['m2', '면적 (㎡)', 'area']]
const SHAPE_SET = new Set<string>(ITEM_SHAPES.map(([k]) => k))
const SHAPE_LABEL = new Map<string, string>(ITEM_SHAPES)
const shapeOf = (s: unknown): ItemShape => (typeof s === 'string' && SHAPE_SET.has(s) ? (s as ItemShape) : 'box')
const comma = (n: number) => Math.round(Number(n) || 0).toLocaleString('ko-KR')
const sizeText = (x: LibraryFixture) => `${comma(x.w)} × ${comma(x.d)} × ${comma(x.h)}`
const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)

const RECENT_KEY = 'wkly-design-lib-recent'
type Recent = Record<LibraryKind, string[]>
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 10) : [])
function readRecent(): Recent {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}') as Record<string, unknown>; return { finish: ids(v?.finish), fixture: ids(v?.fixture) } } catch { return { finish: [], fixture: [] } }
}
function writeRecent(r: Recent) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)) } catch { /* 저장하지 못해도 쓰는 데는 지장이 없다 */ } }

/** 마감 글에서 재료 번호와 이름을 나눈다: 'PT-01 수성 페인트 백색' → PT-01 · 수성 페인트 백색 */
function splitCode(text: string): { code: string; name: string } {
  const t = text.trim()
  const m = t.match(/^([A-Za-z]{2,3})[-\s]?(\d{1,3})(?!\d)\s*(.*)$/)
  return m ? { code: `${m[1].toUpperCase()}-${m[2].padStart(2, '0')}`, name: m[3].trim() } : { code: '', name: t }
}

export function DesignPlanLibrary({ specs, target, onTarget, canApplyWall, selectedItem, selectedFinish, onFinish, onFixture, placing }: {
  specs: SpecItem[]; trades: { code: string; name: string }[]; target: Target; onTarget(t: Target): void; canApplyWall: boolean
  selectedItem: PlanItem | null; selectedFinish: string | null; onFinish(text: string, entry: LibraryFinish): void; onFixture(f: LibraryFixture): void
  /** 놓고 있는 기구의 이름 (없으면 null) */ placing: string | null
}) {
  const { api, me, toast } = useApp()
  const { data: saved, error, loading, reload } = useAsync(() => (typeof api.listPlanLibrary === 'function' ? api.listPlanLibrary() : Promise.resolve([] as LibraryEntry[])), [], [] as LibraryEntry[])
  const [tab, setTab] = useState<LibraryKind>('finish')
  const [group, setGroup] = useState<Record<LibraryKind, string>>({ finish: ALL, fixture: ALL })
  const [q, setQ] = useState('')
  const [recent, setRecent] = useState<Recent>(readRecent)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const project: Row[] = []
    for (const s of specs ?? []) {
      if (s.book !== 'materials' || s.status === 'dropped') continue
      const code = (s.code ?? '').trim()
      const name = [s.name, s.spec].map(v => (v ?? '').trim()).filter(Boolean).join(' ')
      if (!code && !name) continue
      const lk = finishLook([code, name].filter(Boolean).join(' '), 'plain')
      const note = [s.maker, s.location].map(v => (v ?? '').trim()).filter(Boolean).join(' · ')
      project.push({ id: `p-${s.id}`, kind: 'finish', group: PROJECT, name: [code, name].filter(Boolean).join(' '), data: { code, name, kind: lk.kind, color: lk.color, use: USE_BY_KIND[lk.kind], ...(note ? { note } : {}) }, builtin: false, origin: 'project' })
    }
    const mine: Row[] = (saved ?? []).filter(e => e && (e.kind === 'finish' || e.kind === 'fixture') && validLibraryData(e.kind, e.data)).map(e => ({ ...e, origin: 'saved' as const }))
    return [...project, ...mine, ...BUILTIN_LIBRARY.map(e => ({ ...e, origin: 'builtin' as const }))]
  }, [specs, saved])

  const groups = tab === 'finish' ? [ALL, PROJECT, ...LIBRARY_FINISH_GROUPS, MINE] : [ALL, ...LIBRARY_FIXTURE_GROUPS, MINE]
  const cur = group[tab]
  const ofTab = useMemo(() => rows.filter(r => r.kind === tab), [rows, tab])
  const counts = useMemo(() => ({ [PROJECT]: ofTab.filter(r => r.origin === 'project').length, [MINE]: ofTab.filter(r => r.origin === 'saved').length }) as Record<string, number>, [ofTab])
  const words = useMemo(() => q.trim().toLowerCase().split(/\s+/).filter(Boolean), [q])
  const shown = useMemo(() => ofTab.filter(r => {
    if (cur === MINE ? r.origin !== 'saved' : cur === PROJECT ? r.origin !== 'project' : cur !== ALL && r.group !== cur) return false
    if (!words.length) return true
    const d = r.data as Partial<LibraryFinish & LibraryFixture>
    const hay = [r.name, r.group, d.code, d.name, d.note, d.spec, r.kind === 'finish' ? KIND_LABEL[d.kind as FinishKind] : SHAPE_LABEL.get(String(d.shape)), r.origin === 'saved' ? MINE : ''].filter(Boolean).join(' ').toLowerCase()
    return words.every(w => hay.includes(w))
  }), [ofTab, cur, words])
  const sections = useMemo(() => {
    const order = [PROJECT, MINE, ...(tab === 'finish' ? LIBRARY_FINISH_GROUPS : LIBRARY_FIXTURE_GROUPS)]
    const by = new Map<string, Row[]>()
    for (const r of shown) { const key = r.origin === 'project' ? PROJECT : r.group || MINE; by.set(key, [...(by.get(key) ?? []), r]) }
    return [...by.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
  }, [shown, tab])
  const recentRows = useMemo(() => recent[tab].map(id => ofTab.find(r => r.id === id)).filter((r): r is Row => !!r).slice(0, 8), [recent, tab, ofTab])

  const remember = (r: Row) => setRecent(old => { const next = { ...old, [r.kind]: [r.id, ...old[r.kind].filter(x => x !== r.id)].slice(0, 10) }; writeRecent(next); return next })
  const pickFinish = (r: Row) => {
    const f = r.data as LibraryFinish
    onFinish(finishText(f), f)
    if (target !== 'wall' || canApplyWall) remember(r)
  }
  const pickFixture = (r: Row) => { const x = r.data as LibraryFixture; onFixture({ ...x, shape: shapeOf(x.shape) }); remember(r) }
  const inUse = (f: LibraryFinish) => {
    const now = (selectedFinish ?? '').trim().toUpperCase()
    if (!now) return false
    const code = f.code.trim().toUpperCase()
    return now === finishText(f).toUpperCase() || (!!code && (now === code || now.startsWith(`${code} `)))
  }
  const canDelete = (r: Row) => r.origin === 'saved' && (me.role === 'admin' || !r.created_by || r.created_by === me.id)

  const save = async (entry: { kind: LibraryKind; group: string; name: string; data: LibraryFinish | LibraryFixture }, ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      await api.savePlanLibrary(entry)
      toast(ok)
      setDraft(null); setQ(''); setTab(entry.kind); setGroup(g => ({ ...g, [entry.kind]: MINE }))
      reload()
    } catch (e) { toast(friendlyError(e)) } finally { setBusy(false) }
  }
  const remove = async (r: Row) => {
    if (busy) return
    setBusy(true)
    try { await api.deletePlanLibrary(r.id); toast('라이브러리에서 지웠습니다'); reload() } catch (e) { toast(friendlyError(e)) } finally { setBusy(false); setConfirm(null) }
  }
  const saveSelectedItem = () => {
    if (!selectedItem) return
    const data = itemToFixture(selectedItem)
    const same = rows.some(r => r.origin === 'saved' && r.kind === 'fixture' && r.name === data.name && (r.data as LibraryFixture).w === data.w && (r.data as LibraryFixture).d === data.d && (r.data as LibraryFixture).h === data.h)
    if (same) { toast('같은 이름 · 크기의 부품이 이미 저장되어 있습니다'); setGroup(g => ({ ...g, fixture: MINE })); return }
    void save({ kind: 'fixture', group: MINE, name: data.name, data }, `'${data.name}' 을 라이브러리에 저장했습니다. 다음부터 눌러서 바로 놓을 수 있습니다`)
  }
  const openSelectedFinish = () => {
    const text = (selectedFinish ?? '').trim()
    if (!text) return
    const full = resolveFinish(text, specs ?? [])
    let { code, name } = splitCode(text)
    if (!name) name = splitCode(full).name
    const lk = finishLook(full, FALLBACK[target])
    setDraft({ type: 'finish', from: 'selected', code, name, kind: lk.kind, color: isHex(lk.color) ? lk.color : '#ecebe6', use: [target], group: MINE })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!draft) return
    if (draft.type === 'finish') {
      const name = draft.name.trim(), code = draft.code.trim().toUpperCase()
      if (!name && !code) { toast('마감 이름을 적어 주세요'); return }
      if (!draft.use.length) { toast('쓰는 곳을 하나 이상 골라 주세요'); return }
      const data: LibraryFinish = { code, name: name || KIND_LABEL[draft.kind], kind: draft.kind, color: isHex(draft.color) ? draft.color.toLowerCase() : '#ecebe6', use: draft.use }
      void save({ kind: 'finish', group: draft.group || MINE, name: finishText(data), data }, `'${finishText(data)}' 을 라이브러리에 저장했습니다`)
      return
    }
    const name = draft.name.trim()
    const [w, d, h, z] = [draft.w, draft.d, draft.h, draft.z].map(v => Math.round(Number(v) || 0))
    if (!name) { toast('기구 이름을 적어 주세요'); return }
    if (!(w > 0 && d > 0 && h > 0)) { toast('가로 · 세로 · 높이를 mm 로 적어 주세요'); return }
    const unit = UNIT_OPTIONS.find(u => u[0] === draft.unit) ?? UNIT_OPTIONS[0]
    const data: LibraryFixture = { name, shape: draft.shape, w: Math.min(w, 20000), d: Math.min(d, 20000), h: Math.min(h, 20000), ...(z > 0 ? { z: Math.min(z, 10000) } : {}), unit: unit[0], measure: unit[2] }
    void save({ kind: 'fixture', group: draft.group || MINE, name, data }, `'${name}' 을 라이브러리에 저장했습니다`)
  }

  const finishCard = (r: Row) => {
    const f = r.data as LibraryFinish
    const fits = f.use.includes(target)
    const on = inUse(f)
    const where = f.use.map(u => USE_LABEL[u as Target] ?? '').filter(Boolean).join(' · ')
    return (
      <div key={r.id} className={`dpl-card fin${on ? ' on' : ''}${fits ? '' : ' off'}`}>
        <button type="button" className="dpl-main" onClick={() => pickFinish(r)} title={`${finishText(f)}${f.note ? ` — ${f.note}` : ''}\n${fits ? `눌러서 ${USE_LABEL[target]}에 넣습니다` : `보통 ${where}에 쓰는 마감입니다. 눌러서 ${USE_LABEL[target]}에 넣을 수도 있습니다`}`}>
          <span className={`dpl-sw k-${KIND_LABEL[f.kind] ? f.kind : 'plain'}`} style={{ '--c': isHex(f.color) ? f.color : '#ecebe6' } as CSSProperties} aria-hidden="true">{on && <em>쓰는 중</em>}</span>
          <span className="dpl-txt"><b>{f.code || KIND_LABEL[f.kind] || '마감'}</b><span className="nm">{f.name}</span><i>{where}</i></span>
        </button>
        {canDelete(r) && del(r)}
      </div>
    )
  }
  const fixtureCard = (r: Row) => {
    const x = r.data as LibraryFixture
    const on = !!placing && placing === x.name
    return (
      <div key={r.id} className={`dpl-card fix${on ? ' on' : ''}`}>
        <button type="button" className="dpl-main" onClick={() => pickFixture(r)} title={`${x.name} — 가로 ${comma(x.w)} · 세로 ${comma(x.d)} · 높이 ${comma(x.h)} mm${x.z ? ` · 바닥에서 ${comma(x.z)} mm` : ''}\n눌러서 평면에 놓습니다`}>
          <span className="dpl-ico" aria-hidden="true"><ShapeIcon shape={shapeOf(x.shape)} size={36} /></span>
          <span className="dpl-txt"><span className="nm strong">{x.name}</span><i>{sizeText(x)}</i></span>
        </button>
        {canDelete(r) && del(r)}
      </div>
    )
  }
  const del = (r: Row) => confirm === r.id
    ? <span className="dpl-del-ask"><button type="button" disabled={busy} onClick={() => void remove(r)}>지우기</button><button type="button" onClick={() => setConfirm(null)}>그대로</button></span>
    : <button type="button" className="dpl-del" aria-label={`${r.name} 지우기`} title="라이브러리에서 지웁니다" onClick={() => setConfirm(r.id)}><Trash2 size={12} /></button>

  const emptyText = words.length ? '찾는 것이 없습니다. 낱말을 줄이거나 다른 묶음을 골라 보세요.'
    : cur === MINE ? (tab === 'finish' ? '아직 저장한 마감이 없습니다. 아래 "새 마감 추가" 나 "지금 마감 저장" 으로 모아 두면 다음 프로젝트에서도 바로 씁니다.' : '아직 저장한 기구가 없습니다. 평면에서 부품을 고르고 아래 "고른 부품 저장" 을 누르면 여기에 모입니다.')
      : cur === PROJECT ? '이 프로젝트 스펙북에 아직 마감재가 없습니다. 스펙북에 마감재를 넣으면 여기에 나옵니다.' : '이 묶음에는 아직 아무것도 없습니다.'

  return (
    <div className="dpl">
      <div className="dpl-tabs" role="tablist" aria-label="라이브러리 종류">
        {([['finish', '마감재'], ['fixture', '기구 · 가구']] as [LibraryKind, string][]).map(([k, label]) =>
          <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setDraft(null); setConfirm(null) }}>{label}</button>)}
      </div>

      {tab === 'fixture' && placing && <p className="dpl-placing" role="status"><b>{placing}</b> 놓는 중 — 평면을 눌러 놓으세요 (Esc 로 끝)</p>}

      {tab === 'finish' && <div className="dpl-target">
        <span className="dpl-label">넣을 곳</span>
        <div className="dpl-chips" role="group" aria-label="마감을 넣을 곳">
          {TARGETS.map(([k, label]) => <button type="button" key={k} className={`dpl-chip${target === k ? ' on' : ''}${k === 'wall' && !canApplyWall ? ' dim' : ''}`} aria-pressed={target === k}
            title={k === 'wall' && !canApplyWall ? '평면에서 벽을 먼저 골라 주세요' : `${label}에 마감을 넣습니다`} onClick={() => onTarget(k)}>{label}</button>)}
        </div>
        <p className={`dpl-hint${target === 'wall' && !canApplyWall ? ' warn' : ''}`}>
          {target === 'wall' ? (canApplyWall ? '마감을 누르면 고른 벽에 바로 들어갑니다.' : '평면에서 벽을 먼저 고른 뒤 마감을 눌러 주세요.') : `마감을 누르면 이 공간의 ${USE_LABEL[target]} 마감으로 들어갑니다.`}
          {selectedFinish && <> 지금 <b>{selectedFinish}</b></>}
        </p>
      </div>}

      <label className="dpl-search">
        <Search size={13} aria-hidden="true" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'finish' ? '번호 · 이름으로 찾기 (예: 타일)' : '이름으로 찾기 (예: 소파, 선반)'} aria-label="라이브러리에서 찾기" />
        {q && <button type="button" aria-label="찾는 글 지우기" onClick={() => setQ('')}><X size={12} /></button>}
      </label>

      <div className="dpl-chips" role="group" aria-label="묶음">
        {groups.map(g => <button type="button" key={g} className={`dpl-chip${cur === g ? ' on' : ''}`} aria-pressed={cur === g} onClick={() => setGroup(old => ({ ...old, [tab]: g }))}>{g}{(g === MINE || g === PROJECT) && counts[g] > 0 && <i>{counts[g]}</i>}</button>)}
      </div>

      {recentRows.length > 0 && !words.length && <div className="dpl-recent-wrap">
        <span className="dpl-label">최근 사용</span>
        <div className="dpl-recent">
          {recentRows.map(r => r.kind === 'finish'
            ? <button type="button" key={r.id} title={r.name} onClick={() => pickFinish(r)}><span className="dot" style={{ '--c': isHex((r.data as LibraryFinish).color) ? (r.data as LibraryFinish).color : '#ecebe6' } as CSSProperties} aria-hidden="true" /><span>{(r.data as LibraryFinish).code || (r.data as LibraryFinish).name}</span></button>
            : <button type="button" key={r.id} title={r.name} onClick={() => pickFixture(r)}><ShapeIcon shape={shapeOf((r.data as LibraryFixture).shape)} size={18} /><span>{r.name}</span></button>)}
        </div>
      </div>}

      {error && <p className="dpl-warn" role="status">저장해 둔 라이브러리를 불러오지 못했습니다. 기본 제공 목록은 그대로 쓸 수 있습니다. <button type="button" className="dpl-link" onClick={reload}>다시 불러오기</button></p>}

      <div className="dpl-list" aria-busy={loading}>
        {sections.map(([name, list]) => <section key={name} className="dpl-sec">
          {(cur === ALL || words.length > 0) && <h4>{name}<i>{list.length}</i></h4>}
          <div className="dpl-grid">{list.map(r => (r.kind === 'finish' ? finishCard(r) : fixtureCard(r)))}</div>
        </section>)}
        {!sections.length && <p className="dpl-empty">{emptyText}</p>}
      </div>

      <div className="dpl-save">
        <span className="dpl-label">라이브러리에 저장</span>
        {tab === 'finish' ? <div className="dpl-actions">
          <button type="button" className="dpl-act" disabled={!selectedFinish || busy} title={selectedFinish ? `'${selectedFinish}' 을 라이브러리에 저장합니다` : '마감이 들어간 벽(또는 바닥 · 천장)을 고르면 저장할 수 있습니다'} onClick={openSelectedFinish}><BookmarkPlus size={12} />{target === 'wall' ? '고른 벽의 마감을 저장' : `지금 ${USE_LABEL[target]} 마감을 저장`}</button>
          <button type="button" className="dpl-act" disabled={busy} onClick={() => setDraft({ type: 'finish', from: 'new', code: '', name: '', kind: FALLBACK[target], color: '#e8e4da', use: [target], group: MINE })}><Plus size={12} />새 마감 추가</button>
        </div> : <div className="dpl-actions">
          <button type="button" className="dpl-act" disabled={!selectedItem || busy} title={selectedItem ? `'${selectedItem.name}' 을 크기 · 모양 그대로 저장합니다` : '평면에서 부품을 하나 고르면 저장할 수 있습니다'} onClick={saveSelectedItem}><BookmarkPlus size={12} />고른 부품을 라이브러리에 저장</button>
          <button type="button" className="dpl-act" disabled={busy} onClick={() => setDraft({ type: 'fixture', name: '', group: MINE, shape: 'box', shapeSet: false, w: '600', d: '600', h: '900', z: '', unit: 'EA' })}><Plus size={12} />새 기구 추가</button>
        </div>}
        {tab === 'fixture' && !selectedItem && <p className="dpl-hint">평면에서 부품을 하나 고르면 크기 · 모양 그대로 저장할 수 있습니다.</p>}

        {draft?.type === 'finish' && tab === 'finish' && <form className="dpl-form" onSubmit={submit}>
          <b className="dpl-form-title">{draft.from === 'selected' ? '지금 마감을 라이브러리에 저장' : '새 마감 추가'}</b>
          <div className="dpl-form-grid">
            <label><span>번호</span><input value={draft.code} maxLength={12} placeholder="예: PT-09" onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} /></label>
            <label className="grow"><span>이름</span><input value={draft.name} maxLength={60} placeholder="예: 수성 페인트 크림" autoFocus onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label><span>재료 종류</span><select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as FinishKind })}>{KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
            <label><span>색</span><span className="dpl-color"><input type="color" value={isHex(draft.color) ? draft.color : '#ecebe6'} aria-label="마감 색" onChange={e => setDraft({ ...draft, color: e.target.value })} /><span className={`dpl-sw k-${draft.kind}`} style={{ '--c': isHex(draft.color) ? draft.color : '#ecebe6' } as CSSProperties} aria-hidden="true" /></span></label>
            <label className="grow"><span>묶음</span><select value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value })}>{[MINE, ...LIBRARY_FINISH_GROUPS].map(g => <option key={g} value={g}>{g}</option>)}</select></label>
          </div>
          <div className="dpl-form-use"><span>쓰는 곳</span>{TARGETS.map(([k, label]) => <label key={k} className={draft.use.includes(k) ? 'on' : ''}><input type="checkbox" checked={draft.use.includes(k)} onChange={() => setDraft({ ...draft, use: draft.use.includes(k) ? draft.use.filter(u => u !== k) : [...draft.use, k] })} />{label}</label>)}</div>
          <div className="dpl-form-foot"><Button size="sm" kind="outline" onClick={() => setDraft(null)}>닫기</Button><Button size="sm" type="submit" disabled={busy}>{busy ? '저장 중…' : '저장'}</Button></div>
        </form>}

        {draft?.type === 'fixture' && tab === 'fixture' && <form className="dpl-form" onSubmit={submit}>
          <b className="dpl-form-title">새 기구 추가</b>
          <div className="dpl-form-grid">
            <label className="grow"><span>이름</span><input value={draft.name} maxLength={60} placeholder="예: 진열 테이블 1800" autoFocus onChange={e => setDraft({ ...draft, name: e.target.value, shape: draft.shapeSet ? draft.shape : itemShape(e.target.value) })} /></label>
            <label><span>모양</span><span className="dpl-shape"><ShapeIcon shape={draft.shape} size={26} /><select value={draft.shape} onChange={e => setDraft({ ...draft, shape: shapeOf(e.target.value), shapeSet: true })}>{ITEM_SHAPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></span></label>
            <label><span>묶음</span><select value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value })}>{[MINE, ...LIBRARY_FIXTURE_GROUPS].map(g => <option key={g} value={g}>{g}</option>)}</select></label>
            {([['w', '가로 (mm)'], ['d', '세로 (mm)'], ['h', '높이 (mm)'], ['z', '바닥에서 띄움 (mm)']] as ['w' | 'd' | 'h' | 'z', string][]).map(([k, label]) =>
              <label key={k} className="num"><span>{label}</span><input inputMode="numeric" value={draft[k]} placeholder={k === 'z' ? '벽걸이만' : ''} onChange={e => setDraft({ ...draft, [k]: e.target.value.replace(/\D/g, '').slice(0, 5) })} /></label>)}
            <label><span>세는 법</span><select value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })}>{UNIT_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
          </div>
          <div className="dpl-form-foot"><Button size="sm" kind="outline" onClick={() => setDraft(null)}>닫기</Button><Button size="sm" type="submit" disabled={busy}>{busy ? '저장 중…' : '저장'}</Button></div>
        </form>}
      </div>
    </div>
  )
}
