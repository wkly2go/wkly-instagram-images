import { useEffect, useRef, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { useDraftNavigation } from '../lib/useDraftNavigation'
import { isSalesActivityUnconfirmed, normalizeSalesActivityBody, type SalesActivityRequest } from '../lib/salesActivityRecovery'
import type { SalesActivity } from '../lib/sales'
import { Button, Field } from './ui'

export function SalesActivities({ id, editable, onDraftChange }: { id: string; editable: boolean; onDraftChange?: (dirty: boolean, busy: boolean) => void }) {
  const { api, me, profileName } = useApp()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<'메모' | '전화' | '메일' | '미팅'>('메모')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const request = useRef({ id: crypto.randomUUID(), signature: '' })
  const [pending, setPending] = useState<SalesActivityRequest | null>(null)
  const activities = useAsync<SalesActivity[]>(() => api.listSalesActivities(id), [id], [])
  useDraftNavigation(!!body.trim() || !!pending, busy)
  useEffect(() => { onDraftChange?.(!!body.trim() || !!pending, busy) }, [body, pending, busy, onDraftChange])
  const confirmed = () => {
    setBody(''); setPending(null); setError(''); request.current = { id: crypto.randomUUID(), signature: '' }; activities.reload()
  }
  const add = async () => {
    if (lock.current) return
    const signature = JSON.stringify([kind, normalizeSalesActivityBody(body), me.id])
    if (request.current.signature !== signature) request.current = { id: crypto.randomUUID(), signature }
    const submitted = pending ?? { id: request.current.id, opportunityId: id, kind, body, actorId: me.id }
    lock.current = true; setBusy(true); setError('')
    try {
      await api.addSalesActivity(submitted.id, submitted.opportunityId, submitted.kind, submitted.body, submitted.actorId)
      confirmed()
    } catch (e) {
      if (isSalesActivityUnconfirmed(e)) setPending(submitted)
      setError(friendlyError(e))
    } finally { lock.current = false; setBusy(false) }
  }
  const check = async () => {
    if (lock.current || !pending) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (await api.checkSalesActivity(pending.id, pending.opportunityId, pending.kind, pending.body, pending.actorId)) confirmed()
      else setError('아직 같은 활동을 확인하지 못했습니다. 원래 요청이 처리 중일 수 있으므로 내용을 유지하고 상태 확인 또는 같은 내용 재시도를 이용해 주세요.')
    } catch (e) { setError(friendlyError(e)) } finally { lock.current = false; setBusy(false) }
  }
  return <div className="sales-activities">
      {editable && <section><h3 className="t-sub">활동 기록</h3><Field label="활동 종류"><select className="select" value={kind} disabled={busy || !!pending} onChange={e => setKind(e.target.value as typeof kind)}>{['메모', '전화', '메일', '미팅'].map(k => <option key={k}>{k}</option>)}</select></Field><Field label="활동 내용"><textarea className="textarea" rows={3} maxLength={4000} disabled={busy || !!pending} value={body} onChange={e => setBody(e.target.value)} placeholder="연락 결과와 다음에 확인할 내용을 적어 주세요." /></Field>{pending && <p role="status" className="sales-notice">저장 여부가 확인될 때까지 원래 활동 내용과 요청 ID를 유지합니다. 같은 내용 재시도는 중복 활동을 만들지 않습니다.</p>}<div className="row wrap"><Button disabled={busy || !body.trim()} onClick={add}>{busy ? '확인 중…' : pending ? '동일 내용으로 재시도' : '활동 저장'}</Button>{pending && <Button kind="outline" disabled={busy} onClick={check}>저장 상태 확인</Button>}</div>{error && <p role="alert" className="sales-error">{error}</p>}</section>}
      <section><h3 className="t-sub">최근 이력 · 최대 50건</h3>{activities.loading && <p role="status">활동 이력을 불러오는 중…</p>}{activities.error && <div role="alert" className="sales-error">{activities.error}<Button kind="outline" disabled={activities.loading || busy} onClick={activities.reload}>활동 이력 다시 확인</Button></div>}{activities.data.map(a => <article className="sales-activity" key={a.id}><strong>{a.kind}</strong> · {profileName(a.created_by)} <time>{new Date(a.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time><p className="sales-copy">{a.body}</p></article>)}{!activities.loading && !activities.error && !activities.data.length && <p>등록된 활동이 없습니다.</p>}</section>
  </div>
}
