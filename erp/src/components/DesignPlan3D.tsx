// 평면을 세운 3D 보기 (2026-11-17 대표 지시 '평면과 3D 작업공간을 더욱 현실에 맞게')
// 마감 글에서 알아본 재료 색 · 무늬, 열린 문과 창, 모양을 알아볼 수 있는 가구 · 기구, 해와 그림자, 크기 가늠용 사람(키 1.7m).
// 보기: 조감(돌려 보기) · 위에서 · 눈높이(방 안을 걸어 다니기). 3D 파일(.glb) 저장 · 스케치업 등에서 만든 모델 열기는 모두 이 기기 안에서만 한다.
// three 는 이 화면을 열 때만 불러온다 (DesignPlan 이 lazy 로 부름). 장면 · 카메라는 lib/designPlan3dEngine 이 맡는다.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BrickWall, Download, FolderOpen, PanelTop, PersonStanding, Scan, Sun, Trash2, X } from 'lucide-react'
import type { PlanGeometry } from '../lib/designPlan'
import { finishLook, type FinishKind, type FinishLook } from '../lib/designPlanLook'
import { PlanEngine, type ModelInfo, type ViewFlags, type ViewMode } from '../lib/designPlan3dEngine'
import './DesignPlan3D.css'

const MODES: [ViewMode, string, string][] = [
  ['orbit', '조감', '비스듬히 내려다봅니다. 끌어서 돌리고 휠로 확대합니다'],
  ['top', '위에서', '바로 위에서 내려다봅니다. 돌아가지 않고, 끌면 옮겨집니다'],
  ['eye', '눈높이', '방 안에 서서 봅니다 (눈높이 1.6m). 끌어서 둘러보고 휠로 앞뒤로 걷습니다'],
]
const HINT: Record<ViewMode, string> = {
  orbit: '끌어서 돌리기 · 휠로 확대 · 오른쪽 단추로 옮기기',
  top: '끌어서 옮기기 · 휠로 확대',
  eye: '끌어서 둘러보기 · 휠로 앞뒤 · 바닥을 두 번 눌러 그 자리로',
}
/** 손가락으로 쓰는 화면(휴대폰 · 태블릿)의 조작 안내 */
const TOUCH_HINT: Record<ViewMode, string> = {
  orbit: '한 손가락으로 돌리기 · 두 손가락으로 확대 · 옮기기',
  top: '한 손가락으로 옮기기 · 두 손가락으로 확대',
  eye: '끌어서 둘러보기 · 바닥을 두 번 눌러 그 자리로 · 화살표로 걷기',
}
const css = (el: Element, name: string, fallback: string) => getComputedStyle(el).getPropertyValue(name).trim() || fallback
const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)
const meters = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2))

export default function DesignPlan3D({ plan, selected, look = finishLook, name }: {
  plan: PlanGeometry
  selected: string | null
  look?: (finish?: string | null, fallback?: FinishKind) => FinishLook
  name?: string
}) {
  const root = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), picker = useRef<HTMLInputElement>(null), fileBox = useRef<HTMLDivElement>(null)
  const engine = useRef<PlanEngine | null>(null)
  const [mode, setMode] = useState<ViewMode>('orbit')
  const [flags, setFlags] = useState<ViewFlags>({ person: true, shadow: true, ceiling: true, cut: true })
  const [failed, setFailed] = useState(false)
  const [lost, setLost] = useState(false)
  const [empty, setEmpty] = useState(true)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [model, setModel] = useState<ModelInfo | null>(null)

  useEffect(() => {
    const el = stage.current
    if (!el) return
    let e: PlanEngine
    try {
      e = new PlanEngine(el, { pink: css(el, '--pink', '#fd37be'), ground: css(el, '--dp3-ground', '#ececea'), onEmpty: setEmpty, onLost: setLost })
    } catch {
      // 그래픽 가속이 꺼져 있거나 기기가 받쳐 주지 않을 때: 평면은 그대로 쓸 수 있게 안내만 한다
      setFailed(true)
      return
    }
    engine.current = e
    // 개발 서버에서는 자동 시험이 엔진을 들여다볼 수 있게 (운영 빌드에는 들어가지 않는다)
    const dev = import.meta.env.DEV ? (window as unknown as { __dp3?: PlanEngine | null }) : null
    if (dev) dev.__dp3 = e
    return () => { engine.current = null; if (dev && dev.__dp3 === e) dev.__dp3 = null; e.dispose() }
  }, [])
  useEffect(() => { engine.current?.setPlan(plan, look, selected) }, [plan, look, selected])
  useEffect(() => { engine.current?.setFlags(flags) }, [flags])
  useEffect(() => { engine.current?.setMode(mode) }, [mode])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), note.bad ? 10000 : 7000)
    return () => clearTimeout(t)
  }, [note])
  // 파일 메뉴는 바깥을 누르거나 Esc 로 닫는다
  useEffect(() => {
    if (!menu) return
    const down = (ev: PointerEvent) => { if (!(ev.target instanceof Node) || !fileBox.current?.contains(ev.target)) setMenu(false) }
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMenu(false) }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [menu])

  const title = (name ?? '').trim() || '평면 3D 모델'
  const hint = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? TOUCH_HINT : HINT)[mode]
  const save = async () => {
    const e = engine.current
    if (!e || busy) return
    setMenu(false)
    setBusy('3D 파일을 만드는 중…')
    try {
      const blob = await e.exportGlb(title)
      const a = document.createElement('a'), url = URL.createObjectURL(blob)
      a.href = url
      a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '평면 3D 모델'}.glb`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      setNote({ text: `3D 파일을 저장했습니다 (${fileSize(blob.size)}). 스케치업 · 블렌더 같은 3D 프로그램에서 열 수 있습니다.` })
    } catch {
      setNote({ text: '3D 파일을 만들지 못했습니다. 잠시 뒤 다시 눌러 주세요.', bad: true })
    } finally {
      setBusy('')
    }
  }
  const open = async (list: FileList | null) => {
    const files = list ? Array.from(list) : []
    if (picker.current) picker.current.value = ''
    const e = engine.current
    if (!e || !files.length || busy) return
    setBusy('3D 모델을 여는 중…')
    try {
      const info = await e.loadModel(files)
      setModel(info)
      if (mode === 'eye') setMode('orbit')
      setNote({ text: `모델을 평면 옆에 놓았습니다 · 가로 ${meters(info.size[0])} × 세로 ${meters(info.size[2])} × 높이 ${meters(info.size[1])}m${info.shrunk ? ' (mm 로 저장된 모델로 보고 줄였습니다)' : ''}` })
    } catch (err) {
      setNote({ text: err instanceof Error && err.message ? err.message : '3D 파일을 열지 못했습니다.', bad: true })
    } finally {
      setBusy('')
    }
  }
  const dropModel = () => { engine.current?.clearModel(); setModel(null); setMenu(false); setNote({ text: '열어 본 모델을 지웠습니다.' }) }
  // 눈높이에서는 방향키(또는 W A S D)로 걷고 돌아본다 — 이 칸을 누른 뒤에만
  const onKey = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    const e = engine.current
    if (!e || mode !== 'eye' || ev.target !== ev.currentTarget || ev.altKey || ev.ctrlKey || ev.metaKey) return
    const c = ev.code
    if (c === 'ArrowUp' || c === 'KeyW') e.walkBy(0.5)
    else if (c === 'ArrowDown' || c === 'KeyS') e.walkBy(-0.5)
    else if (c === 'ArrowLeft' || c === 'KeyA') e.turnBy(0.26)
    else if (c === 'ArrowRight' || c === 'KeyD') e.turnBy(-0.26)
    else return
    // 평면 화면의 단축키(방향키로 부품 옮기기 등)와 겹치지 않게 여기서 끝낸다
    ev.preventDefault()
    ev.stopPropagation()
  }
  const toggle = (k: keyof ViewFlags) => setFlags(f => ({ ...f, [k]: !f[k] }))

  return (
    <div ref={root} className={`design-plan-3d dp3 dp3-${mode}`} tabIndex={failed ? -1 : 0} onKeyDown={onKey} role="group" aria-label="평면을 세운 3D 보기">
      <div ref={stage} className="dp3-stage" role="img" aria-label={`평면을 세운 3D 모델. ${hint}`} />
      {failed ? (
        <p className="dp3-msg">이 기기에서는 3D 를 보여 드릴 수 없습니다. 브라우저의 그래픽 가속이 꺼져 있는지 확인해 주세요. 평면 그리기와 수량은 그대로 쓸 수 있습니다.</p>
      ) : (
        <>
          <div className="dp3-bar" role="toolbar" aria-label="3D 보기 도구">
            <div className="dp3-seg" role="group" aria-label="보는 방법">
              {MODES.map(([k, label, tip]) => <button type="button" key={k} className="dp3-chip" aria-pressed={mode === k} title={tip} onClick={() => setMode(k)}>{label}</button>)}
            </div>
            <div className="dp3-seg dp3-tools" role="group" aria-label="보기 설정 · 파일">
              <button type="button" className="dp3-chip" aria-pressed={flags.person} aria-label="사람" title="키 1.7m 사람을 세워 크기를 가늠합니다" onClick={() => toggle('person')}><PersonStanding size={13} aria-hidden /><span>사람</span></button>
              <button type="button" className="dp3-chip" aria-pressed={flags.shadow} aria-label="그림자" title="해가 만드는 그림자를 켜고 끕니다" onClick={() => toggle('shadow')}><Sun size={13} aria-hidden /><span>그림자</span></button>
              {mode === 'orbit' && <button type="button" className="dp3-chip" aria-pressed={flags.cut} aria-label="벽 낮춤" title="보는 쪽을 가리는 벽을 낮춰 안이 보이게 합니다. 끄면 모든 벽이 제 높이로 섭니다" onClick={() => toggle('cut')}><BrickWall size={13} aria-hidden /><span>벽 낮춤</span></button>}
              {mode === 'eye' && <button type="button" className="dp3-chip" aria-pressed={flags.ceiling} aria-label="천장" title="천장을 덮거나 엽니다 (천장 마감 색)" onClick={() => toggle('ceiling')}><PanelTop size={13} aria-hidden /><span>천장</span></button>}
              <button type="button" className="dp3-chip" aria-label="맞춤" title={mode === 'eye' ? '처음 자리(문 앞)로 돌아갑니다' : '전체가 보이게 맞춥니다'} onClick={() => engine.current?.fit()}><Scan size={13} aria-hidden /><span>맞춤</span></button>
              <div className="dp3-file" ref={fileBox}>
                <button type="button" className="dp3-chip" aria-haspopup="menu" aria-expanded={menu} aria-label="파일" title="3D 파일 저장 · 다른 프로그램에서 만든 모델 열기" onClick={() => setMenu(m => !m)}><FolderOpen size={13} aria-hidden /><span>파일</span></button>
                {menu && (
                  <div className="dp3-menu" role="menu" aria-label="3D 파일">
                    <button type="button" role="menuitem" disabled={!!busy || empty} onClick={save}><Download size={13} aria-hidden />3D 파일 저장 (.glb)</button>
                    <button type="button" role="menuitem" disabled={!!busy} onClick={() => { setMenu(false); picker.current?.click() }}><FolderOpen size={13} aria-hidden />스케치업 등 3D 모델 열기 (.glb · .gltf)</button>
                    {model && <button type="button" role="menuitem" onClick={dropModel}><Trash2 size={13} aria-hidden />모델 지우기</button>}
                    <p>파일은 이 기기 안에서만 읽고 저장합니다 (어디에도 올라가지 않습니다). .gltf 는 함께 저장된 .bin · 그림 파일도 같이 골라 주세요.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          {empty && !lost && <p className="dp3-msg dp3-soft">평면에 벽이나 부품을 그리면 여기에 3D 로 세워집니다.</p>}
          {lost && <p className="dp3-msg">그래픽 장치가 잠시 멈췄습니다. 곧 다시 그립니다. 그대로면 화면을 새로 고쳐 주세요.</p>}
          <div className="dp3-foot">
            {(busy || note) && <p className={`dp3-note${note?.bad && !busy ? ' bad' : ''}`} role="status">{busy || note?.text}</p>}
            {model && <p className="dp3-model" title={model.name}><span>{model.name}</span><button type="button" aria-label="모델 지우기" title="모델 지우기" onClick={dropModel}><X size={12} aria-hidden /></button></p>}
            {!empty && <p className="dp3-hint">{hint}</p>}
            {mode === 'eye' && !empty && (
              <div className="dp3-walk" role="group" aria-label="걷기">
                <button type="button" className="dp3-chip" aria-label="왼쪽 보기" title="왼쪽 보기" onClick={() => engine.current?.turnBy(0.35)}><ArrowLeft size={13} aria-hidden /></button>
                <button type="button" className="dp3-chip" aria-label="앞으로" title="앞으로 한 걸음" onClick={() => engine.current?.walkBy(0.6)}><ArrowUp size={13} aria-hidden /></button>
                <button type="button" className="dp3-chip" aria-label="뒤로" title="뒤로 한 걸음" onClick={() => engine.current?.walkBy(-0.6)}><ArrowDown size={13} aria-hidden /></button>
                <button type="button" className="dp3-chip" aria-label="오른쪽 보기" title="오른쪽 보기" onClick={() => engine.current?.turnBy(-0.35)}><ArrowRight size={13} aria-hidden /></button>
              </div>
            )}
          </div>
          <input ref={picker} type="file" hidden multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,model/gltf-binary,model/gltf+json" onChange={ev => open(ev.target.files)} />
        </>
      )}
    </div>
  )
}
