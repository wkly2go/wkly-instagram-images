// 캐드 가져오기 · 내보내기 (2026-11-17 대표 지시 '캐드와 스케치업을 활용 가능하게')
// 가져오기: 캐드 도면(DXF)의 벽 선을 평면의 벽으로. 내보내기: 평면 → 캐드 파일(DXF) · 스케치업 스크립트(.rb).
// 모두 브라우저 안에서만 계산한다 — 파일을 서버로 올리지 않고, 외부 도구 · 비용이 없다.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Download, FileUp } from 'lucide-react'
import { Button, Modal } from './ui'
import type { PlanGeometry, PlanWall } from '../lib/designPlan'
import { dxfScale, dxfToWalls, isWallLayer, parseDxf, planToDxf, type DxfDrawing } from '../lib/designDxf'
import { planToSketchupRuby } from '../lib/designSketchup'
import type { FinishKind, FinishLook } from '../lib/designPlanLook'
import './DesignPlanLibrary.css'

const UNITS: [number, string][] = [[1, 'mm (밀리미터)'], [10, 'cm (센티미터)'], [1000, 'm (미터)'], [25.4, '인치'], [304.8, '피트']]
const SKIP_WORDS: Record<string, string> = {
  ARC: '호', CIRCLE: '원', ELLIPSE: '타원', SPLINE: '곡선', INSERT: '블록', TEXT: '글', MTEXT: '글', ATTRIB: '글', ATTDEF: '글', DIMENSION: '치수', LEADER: '지시선', MLEADER: '지시선',
  HATCH: '무늬 채움', SOLID: '채움', POINT: '점', VIEWPORT: '보기 창', '3DFACE': '입체 면', '3DSOLID': '입체', IMAGE: '그림', MLINE: '겹선', XLINE: '보조선', RAY: '보조선',
}
const MAX_BYTES = 40 * 1024 * 1024
const comma = (n: number) => Math.round(n).toLocaleString('ko-KR')
const meters = (mm: number) => (mm / 1000).toFixed(mm >= 100000 ? 0 : 1)

/** 글로 읽기: UTF-8 이 아니면(예전 캐드의 한글 레이어 이름) EUC-KR 로 다시 읽는다 */
function decode(buf: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { /* 아래에서 다시 */ }
  try { return new TextDecoder('euc-kr').decode(buf) } catch { return new TextDecoder().decode(buf) }
}

type Loaded = { name: string; drawing: DxfDrawing }

export function DesignPlanCadImport({ onImport, onClose }: { onImport(walls: PlanWall[], mode: 'replace' | 'add'): void; onClose(): void }) {
  const [file, setFile] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [layers, setLayers] = useState<string[]>([])
  const [scale, setScale] = useState(1)
  const [guessed, setGuessed] = useState(false)
  const [kind, setKind] = useState<PlanWall['kind']>('existing')
  const [pair, setPair] = useState(true)
  const [thickness, setThickness] = useState('100')
  const [mode, setMode] = useState<'replace' | 'add'>('replace')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const read = async (f: File | null | undefined) => {
    if (!f) return
    setError(null)
    const lower = f.name.toLowerCase()
    if (lower.endsWith('.dwg')) { setFile(null); setError('DWG 파일은 바로 읽지 못합니다. 캐드에서 "다른 이름으로 저장 › DXF" 로 저장한 파일을 올려 주세요. 내용은 그대로이고 저장만 한 번 더 하시면 됩니다.'); return }
    if (!lower.endsWith('.dxf')) { setFile(null); setError('DXF 파일만 읽을 수 있습니다. 캐드에서 "다른 이름으로 저장 › DXF" 로 저장해 주세요.'); return }
    if (f.size > MAX_BYTES) { setFile(null); setError('파일이 너무 큽니다 (40MB 까지). 벽 레이어만 남겨 다시 저장해 주세요.'); return }
    setBusy(true)
    try {
      const buf = await f.arrayBuffer()
      const head = new TextDecoder().decode(buf.slice(0, 22))
      if (head.startsWith('AutoCAD Binary DXF')) throw new Error('binary')
      const drawing = parseDxf(decode(buf))
      if (!alive.current) return
      if (!drawing.segments.length) { setFile(null); setError('이 파일에서 선을 찾지 못했습니다. 벽이 블록으로 묶여 있으면 캐드에서 분해한 뒤 다시 저장해 주세요.'); return }
      const walls = drawing.layers.filter(l => isWallLayer(l.name)).map(l => l.name)
      const s = dxfScale(drawing)
      setFile({ name: f.name, drawing }); setLayers(walls.length ? walls : drawing.layers.map(l => l.name)); setScale(s.scale); setGuessed(s.guessed)
    } catch (e) {
      if (!alive.current) return
      setFile(null)
      setError(e instanceof Error && e.message === 'binary' ? '이진 형식의 DXF 는 읽지 못합니다. 캐드에서 저장할 때 형식을 "ASCII DXF" 로 골라 주세요.' : '파일을 읽지 못했습니다. DXF 로 다시 저장해서 올려 주세요.')
    } finally { if (alive.current) setBusy(false) }
  }

  const drawing = file?.drawing ?? null
  const result = useMemo(() => {
    if (!drawing || !layers.length) return null
    try { return dxfToWalls(drawing, { layers, scale, kind, pair, thickness: Math.min(1000, Math.max(30, Number(thickness) || 100)) }) } catch { return null }
  }, [drawing, layers, scale, kind, pair, thickness])
  const size = useMemo(() => {
    if (!drawing) return null
    const want = new Set(layers)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const s of drawing.segments) { if (!want.has(s.layer)) continue; x0 = Math.min(x0, s.x1, s.x2); y0 = Math.min(y0, s.y1, s.y2); x1 = Math.max(x1, s.x1, s.x2); y1 = Math.max(y1, s.y1, s.y2) }
    return Number.isFinite(x0) ? { w: (x1 - x0) * scale, h: (y1 - y0) * scale } : null
  }, [drawing, layers, scale])
  const preview = useMemo(() => {
    const walls = result?.walls ?? []
    if (!walls.length) return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const w of walls) { x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2) }
    const pad = Math.max(x1 - x0, y1 - y0, 1000) * 0.05 + 200
    return { walls: walls.slice(0, 3000), box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`, thin: Math.max(x1 - x0, y1 - y0) / 260 }
  }, [result])
  const skipped = useMemo(() => {
    const by = new Map<string, number>()
    for (const [type, n] of Object.entries(drawing?.skipped ?? {})) { const word = SKIP_WORDS[type] ?? '그 밖의 요소'; by.set(word, (by.get(word) ?? 0) + n) }
    return [...by.entries()].sort((a, b) => b[1] - a[1])
  }, [drawing])

  const count = result?.walls.length ?? 0
  const odd = size ? Math.max(size.w, size.h) < 1000 || Math.max(size.w, size.h) > 300000 : false
  const toggle = (name: string) => setLayers(cur => (cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name]))
  const all = drawing?.layers.map(l => l.name) ?? []

  return (
    <Modal title="캐드 도면 가져오기" onClose={onClose} wide actions={<>
      <Button kind="outline" onClick={onClose}>닫기</Button>
      <Button disabled={!count} onClick={() => { if (result?.walls.length) onImport(result.walls, mode) }}>{count ? `벽 ${comma(count)}개 ${mode === 'replace' ? '로 바꾸기' : '더하기'}` : '가져오기'}</Button>
    </>}>
      <div className="dpk">
        <div className={`dpk-drop${over ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void read(e.dataTransfer.files?.[0]) }}>
          <FileUp size={14} aria-hidden="true" />
          <div className="dpk-drop-text">
            <b>{file ? file.name : '캐드 파일(DXF)을 골라 주세요'}</b>
            <span>{file ? `선 ${comma(file.drawing.segments.length)}개 · 레이어 ${file.drawing.layers.length}개를 읽었습니다` : '여기에 끌어다 놓아도 됩니다. 파일은 이 컴퓨터 안에서만 읽고 다른 곳으로 보내지 않습니다.'}</span>
          </div>
          <Button size="sm" kind="outline" disabled={busy} onClick={() => input.current?.click()}>{busy ? '읽는 중…' : file ? '다른 파일' : '파일 고르기'}</Button>
          <input ref={input} type="file" accept=".dxf,.dwg" className="dpk-file" aria-label="캐드 파일 고르기" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void read(f) }} />
        </div>
        {error && <p className="dpk-error" role="alert">{error}</p>}
        {!file && !error && <p className="dpk-help">DWG 파일은 캐드에서 "다른 이름으로 저장 › DXF" 로 바꿔 올려 주세요. 벽 선(선 · 폴리선)만 읽어 평면의 벽으로 만듭니다. 문 · 창 · 가구는 가져온 뒤 평면에서 놓습니다.</p>}

        {file && drawing && <div className="dpk-grid">
          <div className="dpk-col">
            <div className="dpk-head"><b>벽이 그려진 레이어</b>
              <span className="dpk-links"><button type="button" className="dpk-link" onClick={() => setLayers(all)}>모두</button><button type="button" className="dpk-link" onClick={() => setLayers(all.filter(isWallLayer))}>벽 이름만</button><button type="button" className="dpk-link" onClick={() => setLayers([])}>없음</button></span>
            </div>
            <ul className="dpk-layers" aria-label="레이어">
              {drawing.layers.map(l => <li key={l.name}><label><input type="checkbox" checked={layers.includes(l.name)} onChange={() => toggle(l.name)} /><span className="name" title={l.name}>{l.name}</span><span className="num">선 {comma(l.count)}개 · {meters(l.length * scale)} m</span></label></li>)}
            </ul>

            <div className="dpk-fields">
              <label className="dpk-field"><span>도면 단위{guessed && <i className="dpk-guess">짐작</i>}</span>
                <select value={scale} onChange={e => { setScale(Number(e.target.value)); setGuessed(false) }}>{UNITS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
              </label>
              <label className="dpk-field"><span>한 줄 벽의 두께 (mm)</span>
                <input inputMode="numeric" value={thickness} onChange={e => setThickness(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </label>
            </div>
            <p className={`dpk-size${odd ? ' warn' : ''}`}>{size ? <>전체 크기 약 <b>{meters(size.w)} m × {meters(size.h)} m</b>{odd ? ' — 크기가 실제와 다르면 도면 단위를 바꿔 주세요.' : guessed ? ' — 단위가 적혀 있지 않아 크기로 짐작했습니다. 실제와 맞는지 확인해 주세요.' : ''}</> : '레이어를 하나 이상 골라 주세요.'}</p>

            <div className="dpk-row"><span className="dpk-label">벽 종류</span>
              <div className="dpk-seg" role="group" aria-label="벽 종류">
                <button type="button" className={kind === 'existing' ? 'on' : ''} aria-pressed={kind === 'existing'} onClick={() => setKind('existing')}>기존 벽</button>
                <button type="button" className={kind === 'new' ? 'on' : ''} aria-pressed={kind === 'new'} onClick={() => setKind('new')}>새 가벽</button>
              </div>
            </div>
            <div className="dpk-row"><span className="dpk-label">넣는 방법</span>
              <div className="dpk-seg" role="group" aria-label="넣는 방법">
                <button type="button" className={mode === 'replace' ? 'on' : ''} aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>바꾸기</button>
                <button type="button" className={mode === 'add' ? 'on' : ''} aria-pressed={mode === 'add'} onClick={() => setMode('add')}>더하기</button>
              </div>
            </div>
            <p className="dpk-note">{mode === 'replace' ? '지금 평면의 벽을 이 도면의 벽으로 바꿉니다. 지워진 벽에 있던 문 · 창도 함께 빠지고, 부품과 댓글은 그대로 둡니다. 되돌리기로 돌아갈 수 있습니다.' : '지금 평면은 그대로 두고 이 도면의 벽을 더합니다.'}</p>
            <label className="dpk-check"><input type="checkbox" checked={pair} onChange={e => setPair(e.target.checked)} /><span><b>겹선 벽을 한 벽으로 묶기</b> — 캐드는 벽을 두 줄(양쪽 면)로 그립니다. 나란히 가까운 두 선을 가운데 선 하나와 두께로 묶습니다.</span></label>
          </div>

          <div className="dpk-col">
            <div className="dpk-head"><b>미리 보기</b></div>
            <div className="dpk-preview" aria-label="가져올 벽 미리 보기">
              {preview
                ? <svg viewBox={preview.box} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`벽 ${count}개`}>
                  {preview.walls.map(w => <line key={w.id} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} className={w.kind === 'new' ? 'new' : ''} style={{ strokeWidth: Math.max(w.t, preview.thin) } as CSSProperties} />)}
                </svg>
                : <span>{layers.length ? '벽으로 만들 선이 없습니다. 다른 레이어를 골라 보세요.' : '레이어를 고르면 벽이 보입니다.'}</span>}
            </div>
            <p className="dpk-sum" role="status">{result ? <>벽 <b>{comma(count)}개</b> (묶음 {comma(result.paired)} · 한 줄 {comma(result.single)} · 버림 {comma(result.dropped)})</> : '벽 0개'}</p>
            <p className="dpk-note">묶음은 두 줄을 한 벽으로 합친 것, 한 줄은 짝이 없어 적어 주신 두께로 만든 벽, 버림은 너무 짧아 벽으로 보지 않은 선입니다.</p>
            {skipped.length > 0 && <p className="dpk-note">읽지 않은 것: {skipped.map(([word, n]) => `${word} ${comma(n)}개`).join(' · ')}. 호 · 블록 · 글 등은 읽지 않습니다 — 블록 안의 벽은 캐드에서 분해한 뒤 저장해 주세요.</p>}
          </div>
        </div>}
      </div>
    </Modal>
  )
}

const safeName = (name: string) => (name || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '평면'
function download(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = fileName; a.style.display = 'none'
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function DesignPlanExport({ plan, name, look }: { plan: PlanGeometry; name: string; look: (finish?: string | null, fallback?: FinishKind) => FinishLook }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<{ kind: 'dxf' | 'rb'; file: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 300 })
  const root = useRef<HTMLSpanElement | null>(null)
  const empty = !plan.walls.length && !plan.items.length

  const place = () => {
    const r = root.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(340, window.innerWidth - 16)
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 6, width })
  }
  useEffect(() => {
    if (!open) return
    place()
    const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    const onMove = () => place()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true) }
  }, [open])

  const run = (kind: 'dxf' | 'rb') => {
    setError(null)
    try {
      const base = safeName(name)
      if (kind === 'dxf') { const file = `${base}.dxf`; download(planToDxf(plan), file, 'application/dxf'); setDone({ kind, file }) }
      else { const file = `${base}.rb`; download(planToSketchupRuby(plan, name, look), file, 'text/plain;charset=utf-8'); setDone({ kind, file }) }
    } catch { setDone(null); setError('파일을 만들지 못했습니다. 평면을 저장한 뒤 다시 눌러 주세요.') }
  }

  return (
    <span className="dpk-export" ref={root}>
      <button type="button" className="dpw-text dpk-export-btn" aria-haspopup="menu" aria-expanded={open} title="평면을 캐드 파일이나 스케치업 스크립트로 내려받습니다" onClick={() => { setOpen(v => !v); setDone(null); setError(null) }}><Download size={13} />내보내기</button>
      {open && <div className="dpk-menu" role="menu" style={{ left: at.left, top: at.top, width: at.width }}>
        <button type="button" role="menuitem" disabled={empty} onClick={() => run('dxf')}><b>캐드 파일 (.dxf)</b><span>벽 · 문 · 창 · 부품을 레이어로 나눈 도면입니다. 캐드와 스케치업 Pro 에서 엽니다.</span></button>
        <button type="button" role="menuitem" disabled={empty} onClick={() => run('rb')}><b>스케치업 스크립트 (.rb)</b><span>스케치업에서 벽을 세우고 마감 색 · 부품까지 3D 로 만들어 줍니다.</span></button>
        {empty && <p className="dpk-how">평면에 벽이나 부품을 먼저 그려 주세요.</p>}
        {error && <p className="dpk-how err" role="alert">{error}</p>}
        {done?.kind === 'dxf' && <div className="dpk-how" role="status"><b>{done.file} 을 내려받았습니다</b>
          <ol><li>캐드에서 그대로 엽니다. 단위는 mm 입니다.</li><li>스케치업 Pro 는 파일 › 가져오기 에서 형식을 DXF 로 고르고, 옵션의 단위를 밀리미터로 맞춥니다.</li></ol></div>}
        {done?.kind === 'rb' && <div className="dpk-how" role="status"><b>{done.file} 을 내려받았습니다</b>
          <ol><li>스케치업 › 확장 프로그램 › 개발자 › Ruby 콘솔 을 엽니다.</li><li>아래처럼 적고 Enter 를 누릅니다.<code>load &apos;내려받은 파일 경로&apos;</code></li><li>벽 · 바닥 · 부품이 태그별로 만들어집니다. 마음에 들지 않으면 되돌리기 한 번으로 지워집니다.</li></ol>
          <span>캐드 파일(.dxf)도 스케치업 Pro 의 파일 › 가져오기 로 열 수 있습니다.</span></div>}
      </div>}
    </span>
  )
}
