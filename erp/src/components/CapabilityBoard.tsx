// 관리 › 능력 지표 (2026-11-19 대표 지시 '모든 수치가 80이상이 나오도록')
// 일곱 축의 점수를 서버가 계산식으로 매일 재고, 여기서는 오늘 값 · 목표(80) · 지난주와의 차이 · 축을 끌어내리는 세부 지표를 보여 준다.
// 체험 모드 · 서버 함수가 없는 동안에는 칸 자체를 숨긴다(지어낸 숫자를 보이지 않는다).
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import { belowTarget, CAPABILITY_AXES, CAPABILITY_TARGET, readBuildStats, scoreChange, scoreOf, valueLabel, weakestMetric, type CapabilityAxisKey, type CapabilityItem, type CapabilityResult } from '../lib/capability'
import './CapabilityBoard.css'

export function CapabilityBoard() {
  const { api, toast } = useApp()
  const [data, setData] = useState<CapabilityResult | null>(null)
  const [open, setOpen] = useState<CapabilityAxisKey | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      // 빌드에서만 알 수 있는 값(첫 화면 묶음 크기 · 시험 수 · 설명서 수)을 먼저 넘기고 → 오늘 값을 받는다
      try {
        const stats = readBuildStats(await (await fetch('/version.json', { cache: 'no-store' })).json())
        if (stats) await api.adminCapabilityBuild(stats)
      } catch {
        /* 개발 서버 · 체험 모드에는 version.json 이 없다 */
      }
      const r = await api.adminCapability(false).catch(() => null)
      if (alive) setData(r)
    })()
    return () => {
      alive = false
    }
  }, [api])

  const today = data?.today
  if (!today) return null
  const total = scoreOf(today.scores, 'total')
  const low = belowTarget(today.scores)
  const refresh = async () => {
    setBusy(true)
    try {
      setData(await api.adminCapability(true))
      toast('능력 지표를 지금 값으로 다시 쟀습니다.')
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">능력 지표</span>
        <span className="cap">매일 00:05 자동 집계 · 목표 {CAPABILITY_TARGET}점 · 세로줄이 목표</span>
      </div>
      <div className="cap-board">
        <div className="cap-head">
          <span className={`cap-total${total !== null && total < CAPABILITY_TARGET ? ' low' : ''}`}>종합 {total ?? '-'}점</span>
          <span className="t-small">{low.length ? `목표에 못 미친 축 ${low.length}개: ${low.map(a => `${a.label} ${a.score}`).join(' · ')}` : '모든 축이 목표를 넘었습니다.'}</span>
          <span className="grow" />
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={13} aria-hidden="true" /> 지금 다시 재기
          </button>
        </div>
        <div className="cap-list">
          {CAPABILITY_AXES.map(a => {
            const score = scoreOf(today.scores, a.key)
            const delta = scoreChange(data.history, a.key)
            const metrics = today.metrics[a.key] ?? []
            const weak = weakestMetric(metrics)
            const isLow = score !== null && score < CAPABILITY_TARGET
            const shown = open === a.key
            return (
              <div key={a.key}>
                <button type="button" className="cap-row" onClick={() => setOpen(shown ? null : a.key)} aria-expanded={shown} title={a.hint}>
                  <b>{a.label}</b>
                  <span className={`cap-bar${isLow ? ' low' : ''}`} role="img" aria-label={`${a.label} ${score ?? 0}점 · 목표 ${CAPABILITY_TARGET}점`}>
                    <i style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }} />
                  </span>
                  <span className={`cap-score${isLow ? ' low' : ''}`}>{score ?? '-'}</span>
                  <span className={`cap-delta${delta === null || delta === 0 ? '' : delta > 0 ? ' up' : ' down'}`}>{delta === null ? '' : `${delta > 0 ? '+' : ''}${delta}`}</span>
                  {shown ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                </button>
                {shown && (
                  <div className="cap-detail">
                    <span className="t-small">{a.hint}{isLow && weak ? ` — 가장 낮은 곳: ${weak.name} (${weak.score}점)` : ''}</span>
                    {metrics.map(m => (
                      <div className="cap-metric" key={m.name}>
                        <b>{m.name}</b>
                        <span>{valueLabel(m)}</span>
                        <span className={`cap-score${typeof m.score === 'number' && m.score < CAPABILITY_TARGET ? ' low' : ''}`}>{m.score ?? '-'}</span>
                        <span className="rule">{m.rule}</span>
                        {m.items && m.items.length > 0 && (
                          <span className="cap-items">
                            {m.items.map(i => (
                              <span key={i.name} className={`cap-chip${chipTone(i)}`} title={i.note ?? (typeof i.n === 'number' ? `최근 30일 ${i.n}건` : undefined)}>
                                {i.name}
                                {typeof i.n === 'number' ? ` ${i.n}` : ''}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <span className="t-cap">점수는 사람이 매기지 않고 정해 둔 계산식으로 잽니다. 줄을 누르면 세부 지표와 기준이 보입니다. 실사용 · 안정성은 최근 기록으로 재므로 팀이 쓰는 만큼, 장애 없이 지난 날만큼 오릅니다.</span>
      </div>
    </section>
  )
}

/** 초록 = 됨 · 쓰임, 노랑 = 부분 · 조금, 빨강 = 안 됨 · 안 쓰임 */
function chipTone(i: CapabilityItem): string {
  if (i.ok === false || i.use === 0 || i.state === 'none') return ' off'
  if (i.use === 0.5 || i.state === 'partial') return ' half'
  return ''
}
