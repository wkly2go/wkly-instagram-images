// 현장 실측 (대표 지시 2026-11-04)
//   "현장 체크리스트 및 실측자료를 하단 업무 · 근태 옆에 · 안에서 프로젝트를 고르고 사진을 찍어 올린 다음 거기에 실측을 바로
//    · 도면을 올려서 그 위에 찍은 사진을 배치"
//   - 사진 실측: 찍기(휴대폰 카메라) · 앨범 → 사진을 누르면 두 점을 찍어 치수 선 · 값(mm) 입력 · 메모 · 체크리스트 항목 연결
//   - 도면: 도면 이미지 올리기 → 사진을 골라 도면 위를 누르면 그 자리에 핀 · 핀을 누르면 사진 · 치수
//   - 체크리스트: 프로젝트의 현장 실측 체크리스트 (구분별)
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Check, ImagePlus, ListChecks, MapPin, Trash2, Upload, X } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SiteSurveySection } from '../components/SiteSurvey'
import { Button, SectionHead } from '../components/ui'
import { useAction, useApp, useAsync } from '../lib/app'
import type { Project, SiteMark, SitePlan, SiteShot, SiteSurveyItem } from '../lib/types'

type Tab = 'photo' | 'plan' | 'check'
const LAST = 'wkly-site-project'
const LAST_TAB = 'wkly-site-tab'
const readLast = () => {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}

/** 저장소 경로 → 볼 수 있는 주소 (서명 1시간 · 화면 안에서 기억) */
function useSignedUrl(path: string | null | undefined) {
  const { api } = useApp()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!path) return setUrl(null)
    api
      .sitePhotoUrl(path)
      .then(u => alive && setUrl(u))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [api, path])
  return url
}

/** 프로젝트 고르기: 상태별로 묶어서 (대표 지시 2026-11-06 "프로젝트를 구분해줘") · 묶음 안은 연번 최신순 */
const STATUS_GROUPS: [Project['status'], string][] = [
  ['진행', '진행 중'],
  ['기획', '기획 · 준비'],
  ['보류', '보류'],
  ['NIC', 'NIC (수주 안 됨)'],
  ['완료', '완료'],
]
function ProjectOptions({ projects, exclude }: { projects: Project[]; exclude?: string }) {
  return (
    <>
      {STATUS_GROUPS.map(([st, label]) => {
        const list = projects.filter(p => p.status === st && p.id !== exclude).sort((a, b) => (b.code ?? '').localeCompare(a.code ?? ''))
        return list.length ? (
          <optgroup key={st} label={`${label} · ${list.length}`}>
            {list.map(p => (
              <option key={p.id} value={p.id}>
                {p.code ? `${p.code} ` : ''}
                {p.name}
              </option>
            ))}
          </optgroup>
        ) : null
      })}
    </>
  )
}

export function Site() {
  const { api, version } = useApp()
  const { data: projects } = useAsync(() => api.listProjects(), [version], [] as Project[])
  const active = useMemo(() => projects.filter(p => p.status === '진행' || p.status === '기획').sort((a, b) => (b.code ?? '').localeCompare(a.code ?? '')), [projects])
  const [pid, setPid] = useState<string | null>(readLast())
  const project = projects.find(p => p.id === pid) ?? active[0] ?? null
  // 체크리스트가 맨 앞 · 기본 (대표 지시 2026-11-04 "현장 실측에 체크리스트도") · 마지막에 본 탭 기억
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      const t = localStorage.getItem(LAST_TAB)
      return t === 'photo' || t === 'plan' || t === 'check' ? t : 'check'
    } catch {
      return 'check'
    }
  })
  const setTab = (t: Tab) => {
    setTabState(t)
    try {
      localStorage.setItem(LAST_TAB, t)
    } catch {
      /* 기억 못 해도 괜찮음 */
    }
  }
  const { data: survey } = useAsync(() => (project ? api.listSurvey(project.id).catch(() => [] as SiteSurveyItem[]) : Promise.resolve([] as SiteSurveyItem[])), [project?.id, version, tab], [] as SiteSurveyItem[])
  const surveyDone = survey.filter(i => i.status === '확인' || i.status === '해당없음').length
  const choose = (id: string) => {
    setPid(id)
    try {
      localStorage.setItem(LAST, id)
    } catch {
      /* 기억 못 해도 괜찮음 */
    }
  }
  return (
    <Shell active="site">
      <section className="section site-top">
        <SectionHead title="현장 실측" />
        <label className="site-pick">
          <span>프로젝트</span>
          <select className="select" value={project?.id ?? ''} onChange={e => choose(e.target.value)}>
            <ProjectOptions projects={projects} />
          </select>
        </label>
        <div className="site-tabs" role="tablist">
          {(
            [
              ['check', '체크리스트', ListChecks],
              ['photo', '사진 실측', Camera],
              ['plan', '도면', MapPin],
            ] as const
          ).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              <Icon size={16} /> {label}
              {k === 'check' && survey.length > 0 && <small className="site-tab-n">{surveyDone}/{survey.length}</small>}
            </button>
          ))}
        </div>
      </section>
      {!project ? (
        <section className="section">
          <span className="t-cap">프로젝트가 없습니다.</span>
        </section>
      ) : tab === 'photo' ? (
        <PhotoTab key={project.id} project={project} projects={projects} />
      ) : tab === 'plan' ? (
        <PlanTab key={project.id} project={project} projects={projects} />
      ) : (
        <section className="section">
          <SiteSurveySection key={project.id} project={project} />
        </section>
      )}
    </Shell>
  )
}

/** 사진 올리기 버튼 (카메라 · 앨범) → 저장소 + site_photos */
function useUpload(project: Project, after?: (shots: SiteShot[]) => void) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const upload = (files: FileList | null) =>
    files?.length &&
    run(async () => {
      const out: SiteShot[] = []
      for (const f of Array.from(files)) {
        const up = await api.uploadSitePhoto(project.id, f)
        out.push(await api.saveSitePhoto({ project_id: project.id, path: up.path, marks: [] }))
      }
      after?.(out)
    }, `사진 ${files.length}장을 올렸습니다.`)
  return { busy, upload }
}

/** 고른 사진 · 도면을 다른 프로젝트(방)로 옮기기 (대표 지시 2026-11-06 "현장실측에 있는 자료 선택해서 다른 방으로 옮기게")
 *  - 사진: 체크리스트 항목 연결 · 도면 핀은 풀림 (그 프로젝트 것이라서)
 *  - 도면: 그 도면에 핀으로 놓인 사진도 같이 옮김 */
function MoveBar({ count, projects, from, busy, onMove, onCancel, what }: { count: number; projects: Project[]; from: string; busy: boolean; onMove: (to: string) => void; onCancel: () => void; what: string }) {
  const [to, setTo] = useState('')
  return (
    <div className="site-move">
      <b>{count ? `${what} ${count}개 고름` : `옮길 ${what}을(를) 누르세요`}</b>
      <select className="select" value={to} onChange={e => setTo(e.target.value)} aria-label="옮길 프로젝트">
        <option value="">옮길 프로젝트 고르기</option>
        <ProjectOptions projects={projects} exclude={from} />
      </select>
      <Button size="sm" disabled={busy || !count || !to} onClick={() => onMove(to)}>
        옮기기
      </Button>
      <Button size="sm" kind="ghost" onClick={onCancel}>
        취소
      </Button>
    </div>
  )
}

function PhotoTab({ project, projects }: { project: Project; projects: Project[] }) {
  const { api, version } = useApp()
  const { busy: moving, run } = useAction()
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked(v => (v.includes(id) ? v.filter(x => x !== id) : [...v, id]))
  const { data: shots, reload } = useAsync(() => api.listSitePhotos(project.id).catch(() => [] as SiteShot[]), [project.id, version], [] as SiteShot[])
  const { data: items } = useAsync(() => api.listSurvey(project.id).catch(() => [] as SiteSurveyItem[]), [project.id, version], [] as SiteSurveyItem[])
  const [openId, setOpenId] = useState<string | null>(null)
  const { busy, upload } = useUpload(project, s => {
    reload()
    if (s.length === 1) setOpenId(s[0].id)
  })
  const open = shots.find(s => s.id === openId) ?? null
  return (
    <section className="section">
      <div className="site-upload">
        <label className={`btn btn-blue site-cam ${busy ? 'disabled' : ''}`}>
          <Camera size={18} /> 사진 찍기
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={e => (upload(e.target.files), (e.target.value = ''))} />
        </label>
        <label className={`btn btn-outline ${busy ? 'disabled' : ''}`}>
          <ImagePlus size={18} /> 앨범에서
          <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={e => (upload(e.target.files), (e.target.value = ''))} />
        </label>
      </div>
      <div className="row">
        <span className="t-cap grow">사진을 누르면 두 점을 찍어 치수 선을 긋고 값을 적습니다.</span>
        {shots.length > 0 && !picking && (
          <Button size="sm" kind="outline" onClick={() => setPicking(true)}>
            골라서 옮기기
          </Button>
        )}
      </div>
      {picking && (
        <MoveBar
          what="사진"
          count={picked.length}
          projects={projects}
          from={project.id}
          busy={moving}
          onCancel={() => (setPicking(false), setPicked([]))}
          onMove={to =>
            void run(async () => {
              for (const s of shots.filter(x => picked.includes(x.id))) await api.saveSitePhoto({ id: s.id, project_id: to, path: s.path, survey_item_id: null, plan_id: null, plan_x: null, plan_y: null })
              setPicking(false)
              setPicked([])
              reload()
            }, `사진 ${picked.length}장을 ${projects.find(p => p.id === to)?.name ?? '다른 프로젝트'}(으)로 옮겼습니다.`)
          }
        />
      )}
      {shots.length === 0 ? (
        <div className="site-empty">아직 사진이 없습니다. 현장에서 [사진 찍기]를 눌러 시작하세요.</div>
      ) : (
        <div className="site-grid">
          {shots.map(s => (
            <Thumb key={s.id} shot={s} item={items.find(i => i.id === s.survey_item_id)} picked={picking ? picked.includes(s.id) : undefined} onOpen={() => (picking ? toggle(s.id) : setOpenId(s.id))} />
          ))}
        </div>
      )}
      {/* 화면 전체를 덮는 편집 창은 맨 바깥(body)에 (부모 칸에 잘리지 않게) */}
      {open && createPortal(<MeasureEditor key={open.id} shot={open} items={items} onClose={() => setOpenId(null)} onSaved={reload} />, document.body)}
    </section>
  )
}

function Thumb({ shot, item, onOpen, picked }: { shot: SiteShot; item?: SiteSurveyItem; onOpen: () => void; picked?: boolean }) {
  const url = useSignedUrl(shot.path)
  return (
    <button type="button" className={`site-thumb${picked ? ' picked' : ''}`} onClick={onOpen} aria-pressed={picked}>
      {picked !== undefined && <span className={`site-pick-box${picked ? ' on' : ''}`}>{picked ? <Check size={14} /> : null}</span>}
      {url ? <img src={url} alt="현장 사진" loading="lazy" /> : <span className="site-thumb-ph" />}
      <span className="site-thumb-meta">
        {shot.marks.length ? <b>치수 {shot.marks.length}</b> : <span>치수 없음</span>}
        {item ? <span className="truncate">{item.item}</span> : shot.memo ? <span className="truncate">{shot.memo}</span> : null}
      </span>
    </button>
  )
}

/** 치수 선 그리기 · 값 */
function MarkLayer({ marks, draft, aspect }: { marks: SiteMark[]; draft?: { x: number; y: number } | null; aspect: number }) {
  // viewBox: 가로 1000 · 세로 1000/aspect (사진 비율 그대로)
  const H = 1000 / aspect
  return (
    <svg className="site-svg" viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {marks.map((m, i) => {
        const x1 = m.x1 * 1000
        const y1 = m.y1 * H
        const x2 = m.x2 * 1000
        const y2 = m.y2 * H
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const label = m.value ? `${m.value}` : `#${i + 1}`
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="mk-line-bg" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="mk-line" />
            <circle cx={x1} cy={y1} r={9} className="mk-end" />
            <circle cx={x2} cy={y2} r={9} className="mk-end" />
            <rect x={mx - label.length * 13 - 10} y={my - 24} width={label.length * 26 + 20} height={48} className="mk-tag" />
            <text x={mx} y={my + 12} className="mk-text">
              {label}
            </text>
          </g>
        )
      })}
      {draft && <circle cx={draft.x * 1000} cy={draft.y * H} r={14} className="mk-draft" />}
    </svg>
  )
}

function MeasureEditor({ shot, items, onClose, onSaved }: { shot: SiteShot; items: SiteSurveyItem[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const url = useSignedUrl(shot.path)
  const [marks, setMarks] = useState<SiteMark[]>(shot.marks ?? [])
  const [first, setFirst] = useState<{ x: number; y: number } | null>(null)
  const [aspect, setAspect] = useState(4 / 3)
  const [memo, setMemo] = useState(shot.memo ?? '')
  const [itemId, setItemId] = useState(shot.survey_item_id ?? '')
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const valRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editIdx != null) valRef.current?.focus()
  }, [editIdx])
  const tap = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    const pt = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
    if (!first) return setFirst(pt)
    const next = [...marks, { x1: first.x, y1: first.y, x2: pt.x, y2: pt.y, value: '' }]
    setMarks(next)
    setFirst(null)
    setEditIdx(next.length - 1)
  }
  const save = () =>
    run(async () => {
      await api.saveSitePhoto({ id: shot.id, project_id: shot.project_id, path: shot.path, marks: marks.filter(m => Math.hypot(m.x2 - m.x1, m.y2 - m.y1) > 0.005), memo: memo.trim() || null, survey_item_id: itemId || null })
      // 체크리스트 항목과 연결했고 그 항목 치수가 비어 있으면 첫 치수 값을 가로에 채움
      const it = items.find(i => i.id === itemId)
      const v = Number((marks.find(m => m.value)?.value ?? '').replace(/[^\d.]/g, ''))
      if (it && v && it.width_mm == null) await api.saveSurveyItem({ id: it.id, project_id: it.project_id, item: it.item, width_mm: v })
      onSaved()
      onClose()
    }, '실측을 저장했습니다.')
  const remove = () =>
    run(async () => {
      await api.deleteSitePhoto(shot.id)
      onSaved()
      onClose()
    }, '사진을 지웠습니다.')
  return (
    <div className="site-editor" role="dialog" aria-label="사진 실측">
      <div className="site-editor-bar">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
          <X size={20} />
        </button>
        <b className="grow">사진 실측</b>
        <Button size="sm" onClick={save} disabled={busy}>
          <Check size={14} /> 저장
        </Button>
      </div>
      <div className="site-editor-body">
        <span className="site-hint">{first ? '끝점을 누르세요' : '사진에서 재고 싶은 곳의 시작점을 누르세요'}</span>
        <div className="ms-photo" ref={box} onPointerUp={tap}>
          {url && <img src={url} alt="현장 사진" draggable={false} onLoad={e => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 4 / 3)} />}
          <MarkLayer marks={marks} draft={first} aspect={aspect} />
        </div>
        <div className="site-marks">
          {marks.length === 0 && <span className="t-cap">아직 치수가 없습니다.</span>}
          {marks.map((m, i) => (
            <label key={i} className="site-mark-row">
              <span className="site-mark-no">{i + 1}</span>
              <input
                ref={editIdx === i ? valRef : undefined}
                inputMode="decimal"
                value={m.value}
                placeholder="치수 (mm)"
                onChange={e => setMarks(marks.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
              <span className="t-cap">mm</span>
              <button type="button" className="icon-btn sm" aria-label="치수 지우기" onClick={() => setMarks(marks.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            </label>
          ))}
        </div>
        <label className="site-field">
          <span>체크리스트</span>
          <select className="select" value={itemId} onChange={e => setItemId(e.target.value)}>
            <option value="">연결 안 함</option>
            {items.map(i => (
              <option key={i.id} value={i.id}>
                {i.no}. [{i.category}] {i.item}
              </option>
            ))}
          </select>
        </label>
        <label className="site-field">
          <span>메모</span>
          <input className="input" value={memo} onChange={e => setMemo(e.target.value)} placeholder="위치 · 기준점 · 특이사항" />
        </label>
        <button type="button" className="site-del" onClick={remove} disabled={busy}>
          <Trash2 size={14} /> 이 사진 지우기
        </button>
      </div>
    </div>
  )
}

function PlanTab({ project, projects }: { project: Project; projects: Project[] }) {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const { data, reload } = useAsync(
    async () => {
      const [plans, shots] = await Promise.all([api.listSitePlans(project.id).catch(() => [] as SitePlan[]), api.listSitePhotos(project.id).catch(() => [] as SiteShot[])])
      return { plans, shots }
    },
    [project.id, version],
    { plans: [] as SitePlan[], shots: [] as SiteShot[] },
  )
  const [planId, setPlanId] = useState<string | null>(null)
  const plan = data.plans.find(p => p.id === planId) ?? data.plans[0] ?? null
  const [placing, setPlacing] = useState<string | null>(null)
  const [movingPlan, setMovingPlan] = useState(false)
  const [peek, setPeek] = useState<string | null>(null)
  const planUrl = useSignedUrl(plan?.path)
  const box = useRef<HTMLDivElement>(null)
  const { upload: uploadShots, busy: shotBusy } = useUpload(project, s => {
    reload()
    if (s[0]) setPlacing(s[0].id)
  })
  const addPlan = (files: FileList | null) =>
    files?.[0] &&
    run(async () => {
      const f = files[0]
      const up = await api.uploadSitePhoto(project.id, f)
      const p = await api.saveSitePlan({ project_id: project.id, path: up.path, name: f.name.replace(/\.[^.]+$/, '') || '도면' })
      setPlanId(p.id)
      reload()
    }, '도면을 올렸습니다.')
  const tap = (e: React.PointerEvent) => {
    if (!placing || !plan) return
    const r = box.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    const shot = data.shots.find(s => s.id === placing)
    if (!shot) return
    run(async () => {
      await api.saveSitePhoto({ id: shot.id, project_id: shot.project_id, path: shot.path, plan_id: plan.id, plan_x: x, plan_y: y })
      setPlacing(null)
      reload()
    }, '도면에 사진을 놓았습니다.')
  }
  const pins = data.shots.filter(s => plan && s.plan_id === plan.id && s.plan_x != null && s.plan_y != null)
  const loose = data.shots.filter(s => !plan || s.plan_id !== plan.id)
  const peekShot = data.shots.find(s => s.id === peek)
  return (
    <section className="section">
      <div className="site-upload">
        <label className={`btn btn-blue ${busy ? 'disabled' : ''}`}>
          <Upload size={18} /> 도면 올리기
          <input type="file" accept="image/*" hidden disabled={busy} onChange={e => (addPlan(e.target.files), (e.target.value = ''))} />
        </label>
        <label className={`btn btn-outline ${shotBusy ? 'disabled' : ''}`}>
          <Camera size={18} /> 찍어서 배치
          <input type="file" accept="image/*" capture="environment" hidden disabled={shotBusy} onChange={e => (uploadShots(e.target.files), (e.target.value = ''))} />
        </label>
      </div>
      <span className="t-cap">도면은 이미지(JPG · PNG)로 올립니다. PDF 도면은 화면 캡처나 이미지로 저장해 올려 주세요.</span>
      {data.plans.length > 0 && (movingPlan ? (
        <MoveBar
          what="도면"
          count={plan ? 1 : 0}
          projects={projects}
          from={project.id}
          busy={busy}
          onCancel={() => setMovingPlan(false)}
          onMove={to =>
            plan &&
            void run(async () => {
              await api.saveSitePlan({ id: plan.id, project_id: to, path: plan.path, name: plan.name })
              for (const s of data.shots.filter(x => x.plan_id === plan.id)) await api.saveSitePhoto({ id: s.id, project_id: to, path: s.path, survey_item_id: null, plan_id: plan.id, plan_x: s.plan_x, plan_y: s.plan_y })
              setMovingPlan(false)
              setPlanId(null)
              reload()
            }, `도면 '${plan.name}'과 핀 사진을 ${projects.find(p => p.id === to)?.name ?? '다른 프로젝트'}(으)로 옮겼습니다.`)
          }
        />
      ) : (
        <div className="row">
          <span className="t-cap grow">{plan ? `지금 도면: ${plan.name} · 핀 사진 ${data.shots.filter(x => x.plan_id === plan.id).length}장` : ''}</span>
          <Button size="sm" kind="outline" onClick={() => setMovingPlan(true)}>
            이 도면 다른 프로젝트로 옮기기
          </Button>
        </div>
      ))}
      {data.plans.length > 1 && (
        <div className="site-plan-pick">
          {data.plans.map(p => (
            <button key={p.id} type="button" className={`chip ${plan?.id === p.id ? 'active' : ''}`} onClick={() => setPlanId(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      {!plan ? (
        <div className="site-empty">도면이 없습니다. [도면 올리기]로 평면도 이미지를 올리세요.</div>
      ) : (
        <>
          {placing && <div className="site-hint on">도면에서 이 사진을 찍은 자리를 누르세요 · <button type="button" onClick={() => setPlacing(null)}>취소</button></div>}
          <div className={`site-plan ${placing ? 'placing' : ''}`} ref={box} onPointerUp={tap}>
            {planUrl && <img src={planUrl} alt={plan.name} draggable={false} />}
            {pins.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`site-pin ${peek === s.id ? 'on' : ''}`}
                style={{ left: `${(s.plan_x ?? 0) * 100}%`, top: `${(s.plan_y ?? 0) * 100}%` }}
                onPointerUp={e => (e.stopPropagation(), !placing && setPeek(peek === s.id ? null : s.id))}
                aria-label={`사진 ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          {peekShot && <PinPeek shot={peekShot} onMove={() => (setPlacing(peekShot.id), setPeek(null))} onClose={() => setPeek(null)} />}
          <SectionHead title="도면에 놓을 사진" count={loose.length ? String(loose.length) : undefined} />
          {loose.length === 0 ? (
            <span className="t-cap">모든 사진이 이 도면에 놓여 있습니다.</span>
          ) : (
            <div className="site-strip">
              {loose.map(s => (
                <PickThumb key={s.id} shot={s} on={placing === s.id} onPick={() => setPlacing(placing === s.id ? null : s.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function PickThumb({ shot, on, onPick }: { shot: SiteShot; on: boolean; onPick: () => void }) {
  const url = useSignedUrl(shot.path)
  return (
    <button type="button" className={`site-pick-thumb ${on ? 'on' : ''}`} onClick={onPick} aria-pressed={on}>
      {url ? <img src={url} alt="현장 사진" loading="lazy" /> : <span className="site-thumb-ph" />}
      {shot.marks.length > 0 && <b>{shot.marks.length}</b>}
    </button>
  )
}

function PinPeek({ shot, onMove, onClose }: { shot: SiteShot; onMove: () => void; onClose: () => void }) {
  const url = useSignedUrl(shot.path)
  const [aspect, setAspect] = useState(4 / 3)
  return (
    <div className="site-peek">
      <div className="ms-photo small">
        {url && <img src={url} alt="현장 사진" onLoad={e => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 4 / 3)} />}
        <MarkLayer marks={shot.marks} aspect={aspect} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <span className="t-small grow">{shot.memo || (shot.marks.length ? `치수 ${shot.marks.map(m => m.value || '?').join(' · ')}` : '치수 없음')}</span>
        <button type="button" className="quick-btn" onClick={onMove}>
          <MapPin size={13} /> 위치 옮기기
        </button>
        <button type="button" className="icon-btn sm" onClick={onClose} aria-label="닫기">
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
