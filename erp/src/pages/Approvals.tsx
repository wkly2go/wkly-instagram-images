import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { dateLabel, dateTimeLabel, minutesLabel, timeLabel, toDateKey, todayKey, won } from '../lib/date'
import { openGmail } from '../lib/links'
import { maskAccount } from '../lib/finance'
import { Meter } from '../components/charts'
import { Link, useRouter, withQuery } from '../lib/router'
import { APPROVAL_KINDS, CONTRACT_TYPES, type Approval, type ApprovalKind, type ApprovalRoute, type Project, type WorkLog } from '../lib/types'
import { Shell } from '../components/Shell'
import { Board, BoardHead } from '../components/Board'
import { usePanelWide, useRightPanel } from '../components/RightPanel'
import { Button, Chip, Field, KindBadge, KindTag, Modal, StatusBadge } from '../components/ui'

type View = 'todo' | 'mine' | 'all'

/** 승인/반려 버튼 (홈·상세 공용) */
export function DecideButtons({ approval, compact }: { approval: Approval; compact?: boolean }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')
  const [commenting, setCommenting] = useState(false)
  if (approval.status !== '대기' || !approval.can_decide) return null
  if (approval.kind === '일일 보고') {
    return (
      <>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <Button kind="outline" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => setCommenting(true)}>
            의견 남기기
          </Button>
          <Button kind="yellow" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => run(() => api.decideApproval(approval.id, '승인'), '확인했습니다.')}>
            확인
          </Button>
        </div>
        {commenting && (
          <Modal
            title="일일 보고에 의견 남기기"
            onClose={() => setCommenting(false)}
            actions={
              <>
                <Button kind="ghost" onClick={() => setCommenting(false)}>
                  취소
                </Button>
                <Button disabled={busy || !comment.trim()} onClick={async () => (await run(() => api.decideApproval(approval.id, '승인', comment.trim()), '의견을 남기고 확인했습니다.')) && setCommenting(false)}>
                  남기고 확인
                </Button>
              </>
            }
          >
            <textarea className="textarea" autoFocus rows={4} placeholder="예) 루프앤코 중도금은 제가 오늘 통화할게요. 내일 보고에 결과 반영해 주세요." value={comment} onChange={e => setComment(e.target.value)} />
          </Modal>
        )}
      </>
    )
  }
  return (
    <>
      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
        <Button kind="outline" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => setRejecting(true)}>
          반려
        </Button>
        <Button kind="yellow" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => run(() => api.decideApproval(approval.id, '승인', comment), '승인했습니다.')}>
          승인
        </Button>
      </div>
      {rejecting && (
        <Modal
          title="반려 사유"
          onClose={() => setRejecting(false)}
          actions={
            <>
              <Button kind="ghost" onClick={() => setRejecting(false)}>
                취소
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (await run(() => api.decideApproval(approval.id, '반려', comment), '반려했습니다.')) setRejecting(false)
                }}
              >
                반려하기
              </Button>
            </>
          }
        >
          <p className="t-small" style={{ margin: 0 }}>
            <b className="t-blue">{approval.title}</b>
          </p>
          <textarea className="textarea" autoFocus rows={3} placeholder="요청자에게 전달할 사유 (선택)" value={comment} onChange={e => setComment(e.target.value)} />
        </Modal>
      )}
    </>
  )
}

export default function Approvals() {
  const { api, me, version } = useApp()
  const { query, path, navigate } = useRouter()
  const view = (query.get('view') as View) || 'todo'
  const kind = query.get('kind') as ApprovalKind | null
  const selectedId = query.get('id')
  const [creating, setCreating] = useState(false)
  const [minutes, setMinutes] = useState(false)
  const { data, loading } = useAsync(() => api.listApprovals(), [version], [] as Approval[])

  const todo = data.filter(a => a.status === '대기' && a.can_decide && (a.requested_by !== me.id || me.role === 'admin'))
  const base = view === 'todo' ? todo : view === 'mine' ? data.filter(a => a.requested_by === me.id) : data
  const list = kind ? base.filter(a => a.kind === kind) : base
  const selected = data.find(a => a.id === selectedId) ?? null
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })
  const daily = data.filter(a => a.kind === '일일 보고' && a.status === '대기' && a.can_decide).length
  const wide = usePanelWide()
  useRightPanel(selected && wide ? `approval:${selected.id}` : null, '승인 상세', selected ? <ApprovalDetail a={selected} onBack={() => go({ id: null })} /> : null)

  return (
    <Shell active="approvals">
      <div className="row wrap">
        <div className="chips">
          <Chip active={view === 'todo'} onClick={() => go({ view: null, id: null })}>
            처리할 것 {todo.length}
          </Chip>
          <Chip active={view === 'mine'} onClick={() => go({ view: 'mine', id: null })}>
            내 요청
          </Chip>
          <Chip active={view === 'all'} onClick={() => go({ view: 'all', id: null })}>
            전체
          </Chip>
        </div>
        <span className="grow" />
        {/* 회의록 방: 회의록만 모아 보기 · 바로 쓰기 */}
        <Chip active={kind === '회의록'} onClick={() => go({ kind: kind === '회의록' ? null : '회의록', view: kind === '회의록' ? null : 'all' })}>
          📝 회의록 {data.filter(a => a.kind === '회의록').length}
        </Chip>
        <Button kind="outline" onClick={() => setMinutes(true)}>
          회의록 쓰기
        </Button>
        {daily > 0 && (
          <Chip active={kind === '일일 보고'} onClick={() => go({ kind: kind === '일일 보고' ? null : '일일 보고' })}>
            일일 보고 {daily}
          </Chip>
        )}
        <Button onClick={() => setCreating(true)}>
          승인 요청
        </Button>
      </div>
      <div className="chips">
        <Chip active={!kind} onClick={() => go({ kind: null })}>
          모든 종류
        </Chip>
        {APPROVAL_KINDS.map(k => {
          const n = base.filter(a => a.kind === k).length
          return n ? (
            <Chip key={k} active={kind === k} onClick={() => go({ kind: k })}>
              {k} {n}
            </Chip>
          ) : null
        })}
      </div>
      {selected && !wide ? (
        <div className="pane-detail">
          <ApprovalDetail a={selected} onBack={() => go({ id: null })} />
        </div>
      ) : (
        <ApprovalBoards list={list} byKind={!kind} loading={loading} view={view} selectedId={selectedId} onOpen={id => go({ id })} />
      )}
      {minutes && <NewApproval preset={{ kind: '회의록' }} onClose={() => setMinutes(false)} onCreated={id => go({ view: 'all', kind: '회의록', id })} />}
      {creating && <NewApproval onClose={() => setCreating(false)} onCreated={id => go({ view: 'mine', id })} />}
    </Shell>
  )
}

/** 승인 게시판: 종류별로 묶어 (색 머리띠) 번호 · 제목 · 요청자 · 요청일 · 상태 · 처리 */
function ApprovalBoards({ list, byKind, loading, view, selectedId, onOpen }: { list: Approval[]; byKind: boolean; loading: boolean; view: View; selectedId?: string | null; onOpen: (id: string) => void }) {
  const { profileName } = useApp()
  const groups: [string, Approval[]][] = byKind ? APPROVAL_KINDS.map(k => [k, list.filter(a => a.kind === k)] as [string, Approval[]]).filter(([, l]) => l.length) : [['', list]]
  const empty = loading ? '불러오는 중…' : view === 'todo' ? '처리할 승인이 없습니다.' : '요청이 없습니다.'
  if (!groups.length) return <Board<Approval> rows={[]} rowKey={a => a.id} cols={[]} empty={empty} />
  return (
    <div className="col gap-12">
      {groups.map(([k, rows]) => (
        <div key={k || 'all'} className="col">
          {k && <BoardHead title={<KindTag kind={k} />} count={rows.length} />}
          <Board<Approval>
            rows={rows}
            rowKey={a => a.id}
            onRow={a => onOpen(a.id)}
            selectedId={selectedId}
            numbered={!k}
            empty={empty}
            cols={[
              ...(k ? [] : [{ key: 'kind', label: '종류', width: 84, cell: (a: Approval) => <KindTag kind={a.kind} /> }]),
            { key: 'title', label: '제목', kind: 'title', cell: a => <span className="t-smallb">{a.title}</span> },
            { key: 'who', label: '요청자', width: 90, cell: a => profileName(a.requested_by) },
            { key: 'when', label: '요청일', width: 110, hideNarrow: true, cell: a => dateTimeLabel(a.created_at) },
            { key: 'status', label: '상태', width: 70, cell: a => <StatusBadge status={a.status} /> },
              { key: 'act', label: '처리', width: 150, kind: 'center', cell: a => (a.status === '대기' && a.can_decide ? <span onClick={e => e.stopPropagation()}><DecideButtons approval={a} compact /></span> : '-') },
            ]}
          />
        </div>
      ))}
    </div>
  )
}


function ApprovalDetail({ a, onBack }: { a: Approval; onBack: () => void }) {
  const { api, me, profileName, profileOf } = useApp()
  const { busy, run } = useAction()
  const target = a.kind === '프로젝트' ? `/projects?id=${a.target_id}` : a.kind === '거래처' ? `/clients?id=${a.target_id}` : null
  return (
    <div className="box col gap-10" style={{ flex: 1, overflow: 'auto' }}>
      <div className="row">
        <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="목록으로">
          <ArrowLeft size={18} />
        </button>
        <KindTag kind={a.kind} />
        <StatusBadge status={a.status} />
        <span className="grow" />
        <span className="t-cap">요청 {dateTimeLabel(a.created_at)}</span>
      </div>
      <h3 className="t-title">{a.title}</h3>
      <div className="t-small">
        {profileOf(a.requested_by)?.is_agent ? `🤖 ${profileName(a.requested_by)} (AI 팀원)` : profileName(a.requested_by)} → {a.kind === '일일 보고' ? '확인' : '승인자'}: {a.approver_id ? profileName(a.approver_id) : '관리자'}
      </div>
      {a.kind === '일일 보고' && <DailyReport a={a} />}
      {a.kind === '지출' && <ExpenseInfo a={a} />}
      {a.amount != null && (
        <div className="panel">
          <span className="t-cap">금액 </span>
          <span className="t-num" style={{ fontSize: 20 }}>
            {won(a.amount)}
          </span>
        </div>
      )}
      {a.kind === '메일 발송' && (
        <div className="panel col gap-6">
          <dl className="kv">
            <dt>받는 사람</dt>
            <dd>{a.payload.to || '-'}</dd>
            <dt>제목</dt>
            <dd>{a.payload.subject || '-'}</dd>
          </dl>
          <div className="dashed" />
          <div className="t-small pre">{a.payload.body || '(본문 없음)'}</div>
        </div>
      )}
      {a.kind === '업무 보고' && a.payload.user_id && a.payload.date && <ReportLogs userId={a.payload.user_id} date={a.payload.date} />}
      {a.content && a.kind !== '일일 보고' && <div className="panel t-small pre">{a.content}</div>}
      {target && a.target_id && (
        <Link to={target} className="t-small">
          관련 {a.kind} 보기 ›
        </Link>
      )}
      {a.status !== '대기' && a.status !== '취소' && (
        <div className="panel t-small">
          <b className="t-blue">
            {profileName(a.decided_by)} · {a.kind === '일일 보고' && a.status === '승인' ? '확인' : a.status}
          </b>{' '}
          <span className="t-cap">{a.decided_at && dateTimeLabel(a.decided_at)}</span>
          {a.decision_comment && <div className="pre" style={{ marginTop: 4 }}>{a.decision_comment}</div>}
        </div>
      )}
      <span className="grow" />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {a.kind === '메일 발송' && a.status === '승인' && a.requested_by === me.id && (
          <Button kind="yellow" onClick={() => openGmail({ to: a.payload.to, subject: a.payload.subject, body: a.payload.body })}>
            Gmail로 보내기
          </Button>
        )}
        {a.status === '대기' && a.requested_by === me.id && (
          <Button kind="ghost" disabled={busy} onClick={() => run(() => api.cancelApproval(a.id), '요청을 취소했습니다.')}>
            요청 취소
          </Button>
        )}
        <DecideButtons approval={a} />
      </div>
      {a.kind === '메일 발송' && a.status === '대기' && <span className="t-cap">승인되면 요청자 화면에 "Gmail로 보내기" 버튼이 열립니다.</span>}
    </div>
  )
}

/** 일일 보고: '■ 제목' 줄은 소제목, '· 이름 (할 일 x/y) — 메모' 는 진행 막대, 숫자 요약은 칸으로 */
export function reportSections(content: string | null): { title: string; lines: string[] }[] {
  const sections: { title: string; lines: string[] }[] = []
  for (const raw of (content ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^■/.test(line)) sections.push({ title: line.replace(/^■\s*/, ''), lines: [] })
    else {
      if (!sections.length) sections.push({ title: '', lines: [] })
      sections[sections.length - 1].lines.push(line)
    }
  }
  return sections
}

export function DailyReport({ a }: { a: Approval }) {
  const sections = reportSections(a.content)
  const statsPayload = a.payload.stats as Record<string, number> | undefined
  const summary = sections.find(x => /요약/.test(x.title))
  const tiles: [string, number][] = statsPayload
    ? Object.entries({ '진행 프로젝트': statsPayload.active_projects, '오늘 완료한 할 일': statsPayload.done_today, 지연: statsPayload.overdue, '새 리서치': statsPayload.new_research }).filter((e): e is [string, number] => typeof e[1] === 'number')
    : [...(summary?.lines.join(' ') ?? '').matchAll(/([가-힣][가-힣\s]*?)\s*(\d+)/g)].map(m => [m[1].trim(), Number(m[2])] as [string, number]).slice(0, 4)
  return (
    <div className="col gap-10">
      {tiles.length > 0 && (
        <div className="kpis" style={{ gridTemplateColumns: `repeat(${Math.min(4, tiles.length)}, minmax(0, 1fr))` }}>
          {tiles.map(([label, n]) => (
            <div key={label} className="kpi" style={{ background: 'var(--white)' }}>
              <span className="t-cap">{label}</span>
              <span className="v" style={label.includes('지연') && n ? { color: 'var(--red)' } : undefined}>
                {n}
              </span>
            </div>
          ))}
        </div>
      )}
      {sections
        .filter(x => x !== summary || !tiles.length)
        .map((sec, i) => (
          <div key={i} className="col gap-2">
            {sec.title && <span className="t-smallb">{sec.title}</span>}
            {sec.lines.map((l, j) => {
              const m = l.match(/^[·•-]\s*(.+?)\s*\(할 일 (\d+)\/(\d+)\)\s*[—–-]?\s*(.*)$/)
              if (m) {
                const done = Number(m[2])
                const total = Number(m[3])
                const pct = total ? (done / total) * 100 : 0
                return (
                  <div key={j} className="row t-small" style={{ gap: 8 }}>
                    <span className="t-smallb truncate" style={{ width: 170, flexShrink: 0 }}>
                      {m[1]}
                    </span>
                    <span style={{ width: 90, display: 'flex' }}>
                      <Meter value={pct} label={`${m[1]} 할 일 완료율`} />
                    </span>
                    <span className="t-meta t-blue">{Math.round(pct)}%</span>
                    <span className="t-cap truncate grow">{m[4]}</span>
                  </div>
                )
              }
              return (
                <span key={j} className="t-small">
                  {l.replace(/^[·•-]\s*/, '· ')}
                </span>
              )
            })}
          </div>
        ))}
    </div>
  )
}

function ExpenseInfo({ a }: { a: Approval }) {
  const pl = a.payload as Record<string, unknown>
  const str = (k: string) => (typeof pl[k] === 'string' && pl[k] ? String(pl[k]) : null)
  const rows: [string, string | null][] = [
    ['사용처', str('payee')],
    ['공사 구분', str('category')],
    ['계약형태', str('contract_type')],
    ['입금 계좌', str('account_no') ? `${str('bank_name') ?? ''} ${maskAccount(str('account_no'))} ${str('account_holder') ?? ''}` : null],
  ]
  if (!rows.some(r => r[1])) return <span className="t-cap">승인되면 결제 대장에 '예정'으로 자동 등록됩니다.</span>
  return (
    <div className="panel col gap-6">
      <dl className="kv">
        {rows
          .filter(r => r[1])
          .map(([k, v]) => (
            <span key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </span>
          ))}
      </dl>
      <span className="t-cap">{a.status === '승인' ? '결제 대장에 등록되었습니다 (관리자 화면).' : "승인되면 결제 대장에 '예정'으로 자동 등록됩니다."}</span>
    </div>
  )
}

function ReportLogs({ userId, date }: { userId: string; date: string }) {
  const { api, version } = useApp()
  const { data } = useAsync(() => api.listWorkLogs({ userId, date }), [userId, date, version], [] as WorkLog[])
  const total = data.reduce((s, l) => s + (l.minutes ?? 0), 0)
  return (
    <div className="panel col gap-6">
      <div className="row">
        <span className="t-smallb">{dateLabel(date)} 기록 {data.length}건</span>
        <span className="grow" />
        <span className="t-cap">{minutesLabel(total)}</span>
      </div>
      {data.map(l => (
        <div key={l.id} className="row top t-small">
          <span className="t-meta">{timeLabel(l.created_at)}</span>
          <KindBadge kind={l.kind} />
          <span className="grow pre">{l.content}</span>
          {l.minutes ? <span className="t-cap">{l.minutes}분</span> : null}
        </div>
      ))}
      {data.length === 0 && <span className="t-cap">기록이 없습니다.</span>}
    </div>
  )
}

/** 일일 보고 초안: 오늘 숫자를 채운 형식 */
async function dailyDraft(api: ReturnType<typeof useApp>['api'], date: string): Promise<{ content: string; stats: Record<string, number> }> {
  const [projects, tasks, research] = await Promise.all([api.listProjects(), api.listTasks(), api.listResearch().catch(() => [])])
  const active = projects.filter(p => p.status === '진행')
  const doneToday = tasks.filter(t => t.status === '완료' && t.completed_at && toDateKey(t.completed_at) === date).length
  const overdue = tasks.filter(t => t.status !== '완료' && t.due_date && t.due_date < date).length
  const fresh = research.filter(r => r.status === '새 자료').length
  const stats = { active_projects: active.length, done_today: doneToday, overdue, new_research: fresh }
  const lines = [
    '■ 오늘 요약',
    `진행 프로젝트 ${active.length} · 오늘 완료한 할 일 ${doneToday} · 지연 ${overdue} · 새 리서치 ${fresh}`,
    '',
    '■ 프로젝트별 현황',
    ...active.map(p => {
      const mine = tasks.filter(t => t.project_id === p.id)
      return `· ${p.name} (할 일 ${mine.filter(t => t.status === '완료').length}/${mine.length}) — `
    }),
    '',
    '■ 이슈 · 리스크',
    '· ',
    '',
    '■ 내일 할 일',
    '· ',
    '',
    '■ 새로 모은 자료 활용 제안',
    '· ',
  ]
  return { content: lines.join('\n'), stats }
}

export function NewApproval({ onClose, onCreated, preset }: { onClose: () => void; onCreated?: (id: string) => void; preset?: Partial<Approval> }) {
  const { api, me, profiles, profileName } = useApp()
  const { busy, run } = useAction()
  const [kind, setKind] = useState<ApprovalKind>(preset?.kind ?? '지출')
  const [title, setTitle] = useState(preset?.title ?? '')
  const [content, setContent] = useState(preset?.content ?? (preset?.payload?.body as string | undefined) ?? '')
  const [amount, setAmount] = useState(preset?.amount ? String(preset.amount) : '')
  const [approver, setApprover] = useState(preset?.approver_id ?? '')
  const [to, setTo] = useState((preset?.payload?.to as string | undefined) ?? '')
  const [subject, setSubject] = useState((preset?.payload?.subject as string | undefined) ?? '')
  const [date, setDate] = useState(preset?.payload?.date ?? todayKey())
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [pay, setPay] = useState({ project_id: '', payee: '', category: '', contract_type: '', bank_name: '', account_no: '', account_holder: '' })
  const { data: extra } = useAsync(
    async () => {
      const [routes, projects] = await Promise.all([api.listApprovalRoutes().catch(() => [] as ApprovalRoute[]), api.listProjects()])
      return { routes, projects }
    },
    [],
    { routes: [] as ApprovalRoute[], projects: [] as Project[] },
  )
  const route = extra.routes.find(r => r.kind === kind)?.approver_id
  const auto = route && route !== me.id && profiles.some(p => p.id === route && p.active) ? route : null

  // 회의록을 고르면 기본 양식 채우기
  useEffect(() => {
    if (kind !== '회의록' || content.trim()) return
    setContent(`일시: ${date}\n장소:\n참석:\n안건:\n\n논의 내용:\n\n결정 사항:\n\n할 일 (담당 · 기한):\n`)
    if (!title.trim()) setTitle(`${date} 회의록`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // 일일 보고를 고르면 오늘 숫자로 초안 채우기
  useEffect(() => {
    if (kind !== '일일 보고' || content.trim()) return
    let alive = true
    dailyDraft(api, date).then(d => {
      if (!alive) return
      setContent(c => c || d.content)
      setStats(d.stats)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, date])

  const submit = async () => {
    let t = title.trim()
    let body = content.trim()
    const payload: Approval['payload'] = { ...(preset?.payload ?? {}) }
    if (kind === '메일 발송') Object.assign(payload, { to: to.trim(), subject: subject.trim(), body })
    if (kind === '업무 보고') {
      const logs = await api.listWorkLogs({ userId: me.id, date })
      const mins = logs.reduce((s, l) => s + (l.minutes ?? 0), 0)
      t = t || `${date.slice(5).replace('-', '/')} 업무 보고 (기록 ${logs.length}건${mins ? ` · ${minutesLabel(mins)}` : ''})`
      Object.assign(payload, { date, user_id: me.id })
    }
    if (kind === '일일 보고') {
      t = t || `${date.slice(5).replace('-', '/')} 프로젝트 일일 보고`
      Object.assign(payload, { date, ...(stats ? { stats } : {}) })
    }
    if (kind === '지출') {
      for (const [k, v] of Object.entries(pay)) if (v.trim()) (payload as Record<string, unknown>)[k] = v.trim()
      // 세금계산서 지출은 VAT 포함 금액 → 부가세(1/11)를 나눠 공급가로 비용 계산
      const won = parseInt(amount, 10)
      if (pay.contract_type === '세금계산서' && won) (payload as Record<string, unknown>).vat = String(Math.round(won / 11))
    }
    if (kind === '메일 발송') t = t || subject.trim()
    if (!t) return
    let created: Approval | null = null
    const ok = await run(async () => {
      created = await api.createApproval({
        kind,
        title: t,
        content: kind === '메일 발송' ? null : body || null,
        amount: kind === '지출' && amount ? parseInt(amount, 10) : null,
        approver_id: approver || null,
        target_id: preset?.target_id ?? (kind === '지출' && pay.project_id ? pay.project_id : null),
        payload,
      })
    }, kind === '일일 보고' ? '일일 보고를 제출했습니다.' : '승인을 요청했습니다.')
    if (ok) {
      onClose()
      if (created) onCreated?.((created as Approval).id)
    }
  }

  return (
    <Modal
      wide={kind === '일일 보고' || kind === '지출'}
      title={kind === '일일 보고' ? '일일 보고 제출' : '승인 요청'}
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || (kind !== '업무 보고' && kind !== '일일 보고' && !title.trim() && !(kind === '메일 발송' && subject.trim()))} onClick={submit}>
            {kind === '일일 보고' ? '제출' : '요청 보내기'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="종류">
          <select className="select" value={kind} onChange={e => setKind(e.target.value as ApprovalKind)} disabled={!!preset?.kind}>
            {APPROVAL_KINDS.map(k => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label={kind === '일일 보고' ? '받는 사람' : '승인자'}>
          <select className="select" value={approver} onChange={e => setApprover(e.target.value)}>
            <option value="">{auto ? `자동: ${profileName(auto)} (승인 담당)` : '관리자 누구나'}</option>
            {profiles
              .filter(p => p.active && p.id !== me.id && !p.is_agent)
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.title ? ` (${p.title})` : ''}
                </option>
              ))}
          </select>
        </Field>
        {kind === '업무 보고' || kind === '일일 보고' ? (
          <Field label="보고할 날짜" className="full">
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </Field>
        ) : kind === '메일 발송' ? (
          <>
            <Field label="받는 사람" className="full">
              <input className="input" type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@example.com" />
            </Field>
            <Field label="제목" className="full">
              <input className="input" value={subject} onChange={e => setSubject(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="제목" className="full">
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === '지출' ? '예) 촬영 소품 구매' : ''} />
          </Field>
        )}
        {kind === '지출' && (
          <>
            <Field label="금액 (원, VAT 포함)">
              <input className="input" inputMode="numeric" value={amount ? Number(amount).toLocaleString('ko-KR') : ''} onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="0" />
            </Field>
            <Field label="프로젝트 (현장)">
              <select className="select" value={pay.project_id} onChange={e => setPay({ ...pay, project_id: e.target.value })}>
                <option value="">없음</option>
                {extra.projects
                  .filter(p => p.status !== '완료')
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="사용처 (업체·성명)">
              <input className="input" value={pay.payee} onChange={e => setPay({ ...pay, payee: e.target.value })} />
            </Field>
            <Field label="공사 구분">
              <input className="input" value={pay.category} onChange={e => setPay({ ...pay, category: e.target.value })} placeholder="목공 · 전기 · 운영비 …" />
            </Field>
            <Field label="계약형태 (증빙)">
              <select className="select" value={pay.contract_type} onChange={e => setPay({ ...pay, contract_type: e.target.value })}>
                <option value="">모름</option>
                {CONTRACT_TYPES.map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="입금 계좌 (선택)">
              <span className="row">
                <input className="input" style={{ width: 80 }} placeholder="은행" value={pay.bank_name} onChange={e => setPay({ ...pay, bank_name: e.target.value })} aria-label="은행" />
                <input className="input grow" placeholder="계좌번호" value={pay.account_no} onChange={e => setPay({ ...pay, account_no: e.target.value })} aria-label="계좌번호" autoComplete="off" />
              </span>
            </Field>
            <Field label="예금주">
              <input className="input" value={pay.account_holder} onChange={e => setPay({ ...pay, account_holder: e.target.value })} />
            </Field>
            <span className="t-cap full">승인되면 결제 대장(관리자)에 '예정'으로 자동 등록되고, 지급예정일은 차주 월요일로 잡힙니다.</span>
          </>
        )}
        <Field label={kind === '메일 발송' ? '본문' : kind === '일일 보고' ? "보고 내용 (■ 소제목 · '· 이름 (할 일 3/5) — 메모' 형식이면 막대로 보여요)" : '내용'} className="full">
          <textarea className="textarea" rows={kind === '메일 발송' ? 6 : kind === '일일 보고' ? 14 : 3} value={content} onChange={e => setContent(e.target.value)} placeholder={kind === '업무 보고' ? '덧붙일 말 (선택) — 그날 업무 일지가 함께 첨부됩니다.' : ''} />
        </Field>
      </div>
    </Modal>
  )
}
