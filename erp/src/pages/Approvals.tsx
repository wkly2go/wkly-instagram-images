import { useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { dateLabel, dateTimeLabel, minutesLabel, relativeLabel, timeLabel, todayKey, won } from '../lib/date'
import { openGmail } from '../lib/links'
import { Link, useRouter, withQuery } from '../lib/router'
import { APPROVAL_KINDS, type Approval, type ApprovalKind, type WorkLog } from '../lib/types'
import { Shell } from '../components/Shell'
import { Badge, Button, Chip, Empty, Field, KindBadge, Modal, StatusBadge } from '../components/ui'

type View = 'todo' | 'mine' | 'all'

/** 승인/반려 버튼 (홈·상세 공용) */
export function DecideButtons({ approval, compact }: { approval: Approval; compact?: boolean }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')
  if (approval.status !== '대기' || !approval.can_decide) return null
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
  const { data, loading } = useAsync(() => api.listApprovals(), [version], [] as Approval[])

  const todo = data.filter(a => a.status === '대기' && a.can_decide && (a.requested_by !== me.id || me.role === 'admin'))
  const base = view === 'todo' ? todo : view === 'mine' ? data.filter(a => a.requested_by === me.id) : data
  const list = kind ? base.filter(a => a.kind === kind) : base
  const selected = data.find(a => a.id === selectedId) ?? null
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })

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
        <Button onClick={() => setCreating(true)}>
          <Plus size={14} /> 승인 요청
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
      <div className={`split ${selected ? 'has-detail' : ''}`} style={{ gap: 12 }}>
        <div className="pane-list" style={{ width: 260, borderRight: 0 }}>
          <div className="pane-body">
            {list.map(a => (
              <button key={a.id} type="button" className={`item ${a.id === selectedId ? 'active' : ''}`} style={{ borderBottom: '1px solid var(--line)' }} onClick={() => go({ id: a.id })}>
                <div className="row">
                  <Badge>{a.kind}</Badge>
                  <span className="grow" />
                  <StatusBadge status={a.status} />
                </div>
                <div className="t-smallb truncate" style={{ marginTop: 3 }}>
                  {a.title}
                </div>
                <RequesterLine a={a} />
              </button>
            ))}
            {list.length === 0 && <Empty>{loading ? '불러오는 중…' : view === 'todo' ? '처리할 승인이 없습니다.' : '요청이 없습니다.'}</Empty>}
          </div>
        </div>
        <div className="pane-detail">
          {selected ? <ApprovalDetail a={selected} onBack={() => go({ id: null })} /> : <Empty>왼쪽에서 요청을 고르세요.</Empty>}
        </div>
      </div>
      {creating && <NewApproval onClose={() => setCreating(false)} onCreated={id => go({ view: 'mine', id })} />}
    </Shell>
  )
}

function RequesterLine({ a }: { a: Approval }) {
  const { profileName } = useApp()
  return (
    <div className="t-cap">
      {profileName(a.requested_by)} · {relativeLabel(a.created_at)}
      {a.amount != null && ` · ${won(a.amount)}`}
    </div>
  )
}

function ApprovalDetail({ a, onBack }: { a: Approval; onBack: () => void }) {
  const { api, me, profileName } = useApp()
  const { busy, run } = useAction()
  const target = a.kind === '프로젝트' ? `/projects?id=${a.target_id}` : a.kind === '거래처' ? `/clients?id=${a.target_id}` : null
  return (
    <div className="box col gap-10" style={{ flex: 1, overflow: 'auto' }}>
      <div className="row">
        <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="목록으로">
          <ArrowLeft size={18} />
        </button>
        <Badge>{a.kind}</Badge>
        <StatusBadge status={a.status} />
        <span className="grow" />
        <span className="t-cap">요청 {dateTimeLabel(a.created_at)}</span>
      </div>
      <h3 className="t-title">{a.title}</h3>
      <div className="t-small">
        {profileName(a.requested_by)} → 승인자: {a.approver_id ? profileName(a.approver_id) : '관리자'}
      </div>
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
      {a.content && <div className="panel t-small pre">{a.content}</div>}
      {target && a.target_id && (
        <Link to={target} className="t-small">
          관련 {a.kind} 보기 ›
        </Link>
      )}
      {a.status !== '대기' && a.status !== '취소' && (
        <div className="panel t-small">
          <b className="t-blue">
            {profileName(a.decided_by)} · {a.status}
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

export function NewApproval({ onClose, onCreated, preset }: { onClose: () => void; onCreated?: (id: string) => void; preset?: Partial<Approval> }) {
  const { api, me, profiles } = useApp()
  const { busy, run } = useAction()
  const [kind, setKind] = useState<ApprovalKind>(preset?.kind ?? '지출')
  const [title, setTitle] = useState(preset?.title ?? '')
  const [content, setContent] = useState(preset?.content ?? '')
  const [amount, setAmount] = useState('')
  const [approver, setApprover] = useState('')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [date, setDate] = useState(preset?.payload?.date ?? todayKey())

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
        target_id: preset?.target_id ?? null,
        payload,
      })
    }, '승인을 요청했습니다.')
    if (ok) {
      onClose()
      if (created) onCreated?.((created as Approval).id)
    }
  }

  return (
    <Modal
      title="승인 요청"
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || (kind !== '업무 보고' && !title.trim() && !(kind === '메일 발송' && subject.trim()))} onClick={submit}>
            요청 보내기
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
        <Field label="승인자">
          <select className="select" value={approver} onChange={e => setApprover(e.target.value)}>
            <option value="">관리자 누구나</option>
            {profiles
              .filter(p => p.active && p.id !== me.id)
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.title ? ` (${p.title})` : ''}
                </option>
              ))}
          </select>
        </Field>
        {kind === '업무 보고' ? (
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
          <Field label="금액 (원)" className="full">
            <input className="input" inputMode="numeric" value={amount ? Number(amount).toLocaleString('ko-KR') : ''} onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="0" />
          </Field>
        )}
        <Field label={kind === '메일 발송' ? '본문' : '내용'} className="full">
          <textarea className="textarea" rows={kind === '메일 발송' ? 6 : 3} value={content} onChange={e => setContent(e.target.value)} placeholder={kind === '업무 보고' ? '덧붙일 말 (선택) — 그날 업무 일지가 함께 첨부됩니다.' : ''} />
        </Field>
      </div>
    </Modal>
  )
}
