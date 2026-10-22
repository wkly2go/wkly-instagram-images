import { useEffect, useRef, useState } from 'react'
import { Bot, Check, CircleDot, FilePen, Flag, MessageSquare, Send, Trash2, X, type LucideIcon } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { friendlyError } from '../lib/api'
import { ACTIVITY_INPUT_KINDS, type ActivityInputKind, type Approval, type ApprovalActivity, type ApprovalActivityKind } from '../lib/types'
import { ask } from './Ask'

/**
 * 결재 · 보고 주고받기 + 진행 기록 (대표 지시 2026-10-23
 *  "승인 보고가 결제에 오면 내용에 대한 답을 해줄 수 있게, 모든 결제와 보고에는 인터랙션이 들어가서 상호보완하고 결과와 과정을 트래킹")
 *  - 요청 → 답글 · 진행 상황 · 수정 → 승인/반려 → 결과 보고 를 한 줄 시간순으로
 *  - AI 팀원이 올린 결재에 답글을 달면 그 AI 가 바로 처리하고 'AI 답변'으로 답함
 */
const META: Record<ApprovalActivityKind, { label: string; icon: LucideIcon; tone: string }> = {
  요청: { label: '요청', icon: Flag, tone: 'sys' },
  수정: { label: '수정', icon: FilePen, tone: 'sys' },
  승인: { label: '승인', icon: Check, tone: 'ok' },
  반려: { label: '반려', icon: X, tone: 'no' },
  취소: { label: '취소', icon: X, tone: 'sys' },
  '다시 대기': { label: '다시 대기', icon: CircleDot, tone: 'sys' },
  댓글: { label: '답글', icon: MessageSquare, tone: 'talk' },
  진행: { label: '진행 상황', icon: CircleDot, tone: 'progress' },
  결과: { label: '결과 보고', icon: Flag, tone: 'result' },
  'AI 답변': { label: 'AI 답변', icon: Bot, tone: 'ai' },
}
const INPUT_LABEL: Record<ActivityInputKind, string> = { 댓글: '답글', 진행: '진행 상황', 결과: '결과 보고' }
const INPUT_HINT: Record<ActivityInputKind, string> = {
  댓글: '내용에 대한 의견 · 질문 · 보완 요청',
  진행: '지금 어디까지 했는지 (예: 업체에 견적 요청함)',
  결과: '끝난 뒤 결과 (예: 게시 완료 · 링크, 발주 완료)',
}

export function ApprovalThread({ a }: { a: Approval }) {
  const { api, me, profileName, profileOf, toast, bump } = useApp()
  const { data: list, reload } = useAsync(() => api.listApprovalActivity(a.id), [a.id, a.status, a.updated_at], [] as ApprovalActivity[])
  const [kind, setKind] = useState<ActivityInputKind>(a.status === '승인' ? '결과' : '댓글')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => api.subscribeChanges(['approval_activity'], reload), [api, reload])
  useEffect(() => setKind(a.status === '승인' ? '결과' : '댓글'), [a.id, a.status])
  const agent = !!profileOf(a.requested_by)?.is_agent
  const waitingAi = agent && (() => {
    const last = [...list].reverse().find(x => x.kind === '댓글' || x.kind === 'AI 답변')
    return last?.kind === '댓글' && !!last.ref_id && Date.now() - new Date(last.created_at).getTime() < 5 * 60_000
  })()

  const send = async () => {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      await api.addApprovalActivity(a.id, kind, v)
      setText('')
      reload()
      bump()
      window.setTimeout(() => end.current?.scrollIntoView({ block: 'nearest' }), 50)
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (x: ApprovalActivity) => {
    if (!(await ask('이 글을 지울까요?'))) return
    try {
      await api.removeApprovalActivity(x.id)
      reload()
      bump()
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  const talk = list.filter(x => ['댓글', '진행', '결과', 'AI 답변'].includes(x.kind)).length
  const results = list.filter(x => x.kind === '결과').length

  return (
    <section className="appr-thread">
      <div className="row gap-6">
        <span className="t-bodyb grow">주고받기 · 진행 기록</span>
        {talk > 0 && <span className="t-cap">글 {talk}</span>}
        {a.status === '승인' && <span className={`badge ${results ? 'green' : 'outline'}`}>{results ? '결과 보고됨' : '결과 보고 전'}</span>}
      </div>
      <ol className="appr-timeline">
        {list.map(x => {
          const m = META[x.kind] ?? META.댓글
          const mine = x.user_id === me.id
          const canDel = x.id > 0 && ((mine && (ACTIVITY_INPUT_KINDS as readonly string[]).includes(x.kind)) || me.role === 'admin')
          const isAgent = !!profileOf(x.user_id)?.is_agent
          return (
            <li key={x.id} className={`appr-ev ${m.tone}${x.body ? ' has-body' : ''}`}>
              <span className="dot" aria-hidden="true">
                <m.icon size={12} />
              </span>
              <div className="col gap-2 grow" style={{ minWidth: 0 }}>
                <div className="row gap-6">
                  <b className="t-smallb">{m.label}</b>
                  <span className="t-cap">
                    {isAgent ? '🤖 ' : ''}
                    {x.user_id ? profileName(x.user_id) : '시스템'} · {dateTimeLabel(x.created_at)}
                  </span>
                  {x.kind === '댓글' && x.ref_id && <span className="t-cap">→ AI 에게 전달됨</span>}
                  <span className="grow" />
                  {canDel && (
                    <button type="button" className="icon-btn sm" onClick={() => void remove(x)} aria-label="지우기" title="지우기">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {x.body && <div className="t-small pre appr-body">{x.body}</div>}
              </div>
            </li>
          )
        })}
        {waitingAi && (
          <li className="appr-ev ai waiting">
            <span className="dot" aria-hidden="true">
              <Bot size={12} />
            </span>
            <span className="t-cap">{profileName(a.requested_by)}이(가) 답글을 반영해 처리하는 중…</span>
          </li>
        )}
      </ol>
      <div ref={end} />
      {a.status !== '취소' && (
        <div className="appr-compose">
          <div className="chips" role="tablist" aria-label="글 종류">
            {ACTIVITY_INPUT_KINDS.map(k => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
                {INPUT_LABEL[k]}
              </button>
            ))}
            <span className="t-cap" style={{ alignSelf: 'center' }}>
              {INPUT_HINT[kind]}
              {agent && kind === '댓글' ? ' · AI 에게 바로 전달돼요' : ''}
            </span>
          </div>
          <div className="row gap-6" style={{ alignItems: 'flex-end' }}>
            <textarea
              className="textarea grow"
              value={text}
              maxLength={4000}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={`${INPUT_LABEL[kind]} 쓰기 · Ctrl+Enter 보내기`}
              aria-label={INPUT_LABEL[kind]}
            />
            <button type="button" className="send-btn" onClick={() => void send()} disabled={!text.trim() || busy} aria-label="보내기">
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
