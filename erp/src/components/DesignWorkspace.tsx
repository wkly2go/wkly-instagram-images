// 설계 프로젝트 작업 환경 (2026-11-17 대표 지시 '작업 환경을 개선해야 해 · 환경개선에 특화 작업해')
//  - 넓게 보기: 프로젝트가 열려 있는 동안 채팅 칸 · 오른쪽 일정 칸을 숨겨 작업 칸을 넓힌다 (html[data-design-wide] · Design.css)
//  - 단계 표시줄: 한 줄 · 넘치면 옆으로 밀기 · 지금 단계가 보이게 · 위에 붙음
//  - 작업 진행 띠: 작업 처리기(맥)에 맡긴 일이 어떻게 되고 있는지 모든 단계에서 보임
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { Button } from './ui'
import { ask } from './Ask'
import { useApp } from '../lib/app'
import type { DesignJob } from '../lib/design'

const readFlag = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v === '1'
  } catch {
    return fallback
  }
}
const writeFlag = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    /* 저장하지 못해도 화면은 그대로 쓴다 */
  }
}

/** 이 기기에 기억하는 켬 · 끔 */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => readFlag(key, fallback))
  const set = useCallback((v: boolean) => { setOn(v); writeFlag(key, v) }, [key])
  return [on, set]
}

/** 넓게 보기 — 기본 켬. 화면을 떠나거나 프로젝트가 닫히면 표시를 지워 원래 화면으로 돌아간다 */
export function useDesignWide(active: boolean): [boolean, (v: boolean) => void] {
  const [wide, setWide] = useStoredFlag('wkly-design-wide', true)
  useEffect(() => {
    if (!active || !wide) return
    const root = document.documentElement
    root.setAttribute('data-design-wide', '1')
    return () => root.removeAttribute('data-design-wide')
  }, [active, wide])
  return [wide, setWide]
}

// ─────────────────────────────── 단계 표시줄
export type StepState = 'none' | 'doing' | 'review' | 'done' | 'stale'
export const STEP_STATE: Record<StepState, string> = { none: '시작 전', doing: '진행 중', review: '검토 대기', done: '완료', stale: '갱신 필요' }
export interface StepInfo<K extends string> { key: K; label: string; note: string; state: StepState }

export function DesignStepBar<K extends string>({ steps, current, onGo, admin, onOrders }: { steps: StepInfo<K>[]; current: K; onGo: (k: K) => void; admin: boolean; onOrders: () => void }) {
  const ref = useRef<HTMLElement>(null)
  // 좁아서 한 줄에 다 안 들어가면 지금 단계가 가운데 오게 옆으로만 민다 (화면 위아래는 건드리지 않음)
  useEffect(() => {
    const nav = ref.current
    const el = nav?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!nav || !el || nav.scrollWidth <= nav.clientWidth) return
    nav.scrollLeft = Math.max(0, el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2)
  }, [current, steps.length])
  return (
    <nav className="design-steps" aria-label="프로젝트 단계" ref={ref}>
      {steps.map((s, i) => (
        <button type="button" key={s.key} className={`design-step ${s.state}${current === s.key ? ' on' : ''}`} aria-current={current === s.key ? 'step' : undefined}
          title={`${i + 1}. ${s.label} · ${STEP_STATE[s.state]}${s.note ? ` · ${s.note}` : ''}`} onClick={() => onGo(s.key)}>
          <span className="n">{i + 1}</span>
          <span className="l"><b>{s.label}</b><small><i className="dot" aria-hidden="true" />{STEP_STATE[s.state]}{s.note ? ` · ${s.note}` : ''}</small></span>
        </button>
      ))}
      {admin && (
        <button type="button" className="design-step link" title="실행 · 발주 (관리자 화면으로)" onClick={onOrders}>
          <span className="n">{steps.length + 1}</span><span className="l"><b>실행 · 발주</b><small>관리자 화면</small></span>
        </button>
      )}
    </nav>
  )
}

/** 단계 내용 맨 아래: 이전 단계 · 다음 단계 */
export function DesignStepNav<K extends string>({ steps, current, onGo }: { steps: StepInfo<K>[]; current: K; onGo: (k: K) => void }) {
  const i = steps.findIndex(s => s.key === current)
  const prev = i > 0 ? steps[i - 1] : null
  const next = i >= 0 && i < steps.length - 1 ? steps[i + 1] : null
  return (
    <div className="design-step-nav" role="group" aria-label="단계 이동">
      {prev ? <Button size="sm" kind="outline" onClick={() => onGo(prev.key)}><ChevronLeft size={13} aria-hidden="true" /> 이전 단계 · {prev.label}</Button> : <span />}
      <span className="t-cap">{i + 1} / {steps.length} 단계</span>
      {next ? <Button size="sm" onClick={() => onGo(next.key)}>다음 단계 · {next.label} <ChevronRight size={13} aria-hidden="true" /></Button> : <span />}
    </div>
  )
}

// ─────────────────────────────── 작업 진행 (작업 처리기에 맡긴 일)
const JOB_NAMES: Record<string, string> = { 'estimate.build': '견적 계산', 'po.build': '발주서 초안 만들기' }
export const jobName = (kind: string) => JOB_NAMES[kind] ?? '자동 작업'
const jobActive = (j: DesignJob) => j.status === 'queued' || j.status === 'running'
const STUCK_MS = 120_000
const CLOSED_KEY = 'wkly-design-job-closed'

/** 실패 이유를 쉬운 말로 (원문은 '자세히' 뒤에 둔다) */
export function plainJobError(kind: string, error: string | null): string {
  const e = error ?? ''
  if (/단가|price/i.test(e)) return '단가를 찾지 못한 항목이 있습니다. 단가를 확인한 뒤 다시 실행해 주세요.'
  if (/수량|placement|quantity/i.test(e)) return '수량표에 문제가 있습니다. 수량표를 확인한 뒤 다시 실행해 주세요.'
  if (/timeout|timed out|network|fetch|연결/i.test(e)) return '작업 처리기와 연결이 끊겼습니다. 잠시 뒤 다시 실행해 주세요.'
  return kind === 'po.build' ? '실행 내역과 협력사를 확인한 뒤 다시 실행해 주세요.' : '수량표와 단가를 확인한 뒤 다시 실행해 주세요.'
}

const elapsedText = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}초`
  if (s < 3600) return `${Math.floor(s / 60)}분 ${s % 60}초`
  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`
}

/**
 * 프로젝트 단위로 작업 상태를 확인한다 — 진행 중인 것이 있을 때만 5초마다, 없으면 1분마다(다른 사람 · 스케치업이 맡긴 일을 알아채는 정도).
 * 화면을 보고 있는 동안 끝나거나 실패하면 알림을 띄우고 onSettled 로 알려 준다.
 */
export function useDesignJobs(projectId: string, onSettled: (job: DesignJob) => void) {
  const { api, toast, version } = useApp()
  const [jobs, setJobs] = useState<DesignJob[]>([])
  const seen = useRef<Map<string, DesignJob['status']> | null>(null)
  const opened = useRef(Date.now())
  const settled = useRef(onSettled)
  settled.current = onSettled
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const load = useCallback(async () => {
    let list: DesignJob[]
    try {
      list = [...(await api.listDesignJobs(projectId))].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    } catch {
      return // 한 번 못 읽은 것은 다음 확인 때 다시
    }
    if (!alive.current) return
    const before = seen.current
    seen.current = new Map(list.map(j => [j.id, j.status]))
    if (before) {
      for (const j of list) {
        if (jobActive(j)) continue
        const was = before.get(j.id)
        const fresh = was === undefined && Date.parse(j.created_at) >= opened.current - 5000
        if (was === 'queued' || was === 'running' || fresh) {
          toast(j.status === 'failed' ? `${jobName(j.kind)}을(를) 끝내지 못했습니다. 위쪽 작업 띠의 '자세히'에서 이유를 볼 수 있습니다` : `${jobName(j.kind)}이(가) 끝났습니다`)
          settled.current(j)
        }
      }
    }
    setJobs(list)
  }, [api, projectId, toast])
  const active = jobs.some(jobActive)
  useEffect(() => { void load() }, [load, version])
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) void load() }, active ? 5000 : 60_000)
    return () => window.clearInterval(t)
  }, [active, load])
  return { jobs, active, reload: load }
}

/** 프로젝트 머리 아래 얇은 띠: 진행 중인 작업 · 걸린 시간 · 작업 처리기 무응답 안내 · 마지막 실패 */
export function DesignJobStrip({ jobs }: { jobs: DesignJob[] }) {
  const running = jobs.filter(jobActive)
  const [now, setNow] = useState(() => Date.now())
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem(CLOSED_KEY) ?? '' } catch { return '' } })
  useEffect(() => {
    if (!running.length) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running.length])
  const failed = !running.length && jobs[0]?.status === 'failed' && jobs[0].id !== closed ? jobs[0] : null
  if (!running.length && !failed) return null
  const stuck = running.some(j => j.status === 'queued' && now - Date.parse(j.created_at) > STUCK_MS)
  const close = (id: string) => { setClosed(id); try { localStorage.setItem(CLOSED_KEY, id) } catch { /* 이 기기에 기억하지 못해도 닫힌다 */ } }
  return (
    <div className={`design-jobs${stuck ? ' stuck' : ''}${failed ? ' fail' : ''}`} role="status" aria-live="polite">
      {running.map(j => (
        <span className="design-job" key={j.id}>
          <Loader2 size={13} className="design-spin" aria-hidden="true" />
          <b>{jobName(j.kind)} {j.status === 'queued' ? '대기 중' : '중'}</b> · {elapsedText(now - Date.parse(j.created_at))}
        </span>
      ))}
      {stuck && <span className="design-job-warn" role="alert"><AlertTriangle size={13} aria-hidden="true" /> 작업 처리기(맥)가 응답하지 않습니다. 맥에서 작업 처리기가 켜져 있는지 확인해 주세요.</span>}
      {failed && <>
        <span className="design-job-warn" role="alert"><AlertTriangle size={13} aria-hidden="true" /> <b>{jobName(failed.kind)}을(를) 끝내지 못했습니다.</b> {plainJobError(failed.kind, failed.error)}</span>
        {failed.error && <details className="design-job-more"><summary>자세히</summary><pre>{failed.error}</pre></details>}
        <button type="button" className="btn btn-ghost btn-sm design-job-close" onClick={() => close(failed.id)}>닫기</button>
      </>}
    </div>
  )
}

// ─────────────────────────────── 안전 장치
/** 불러오지 못했을 때: 빈 화면 대신 이유와 '다시 시도' */
export function LoadError({ message, error, onRetry }: { message: string; error?: string | null; onRetry: () => void }) {
  return (
    <div className="design-load-error" role="alert">
      <AlertTriangle size={14} aria-hidden="true" />
      <span><b>{message}</b>{error ? ` ${error}` : ''}</span>
      <Button size="sm" kind="outline" onClick={onRetry}><RefreshCw size={12} aria-hidden="true" /> 다시 시도</Button>
    </div>
  )
}

/** 지우기 전에 한 번 묻는다 */
export const confirmDelete = (what: string) => ask(`${what} 지울까요? 지우면 되돌릴 수 없습니다.`)

// 저장하지 않은 입력이 있는 칸 — 단계를 옮기기 전에 묻는다
const unsaved = new Map<string, string>()
export function useUnsaved(key: string, label: string, dirty: boolean) {
  useEffect(() => {
    if (dirty) unsaved.set(key, label)
    else unsaved.delete(key)
    return () => { unsaved.delete(key) }
  }, [key, label, dirty])
}
export async function confirmLeave(): Promise<boolean> {
  const labels = [...new Set(unsaved.values())]
  if (!labels.length) return true
  return ask(`저장하지 않은 입력이 있습니다 (${labels.join(' · ')}). 다른 곳으로 가면 사라집니다. 그래도 옮길까요?`)
}
