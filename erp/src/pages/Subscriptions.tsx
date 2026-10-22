import { useMemo, useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate, todayKey } from '../lib/date'
import { SUB_CATEGORIES, SUB_CYCLES, SUB_STATUSES, type SubCategory, type SubStatus, type Subscription } from '../lib/types'
import { Board, type BoardCol } from '../components/Board'
import { Badge, Button, Chip, Field, Modal } from '../components/ui'
import { ask } from '../components/Ask'

const money = (n: number, cur: 'KRW' | 'USD') => (cur === 'USD' ? `$${n.toLocaleString('en-US')}` : `${n.toLocaleString('ko-KR')}원`)
/** 월 환산액 (년은 ÷12, 1회는 0) */
const monthly = (s: Subscription) => (s.cycle === '월' ? s.amount : s.cycle === '년' ? Math.round(s.amount / 12) : 0)
const S_TONE: Record<SubStatus, 'acid' | 'yellow' | 'paper'> = { '사용 중': 'acid', '해지 예정': 'yellow', 해지: 'paper' }

/** 프로젝트 › 구독료: 회사가 쓰는 서비스 · 프로그램과 요금 · 결제일 (보기는 모두, 고치기는 관리자) */
export function Subscriptions() {
  const { api, me, version, profileName } = useApp()
  const { busy, run } = useAction()
  const admin = me.role === 'admin'
  const today = todayKey()
  const { data: list, loading } = useAsync(() => api.listSubscriptions(), [version], [] as Subscription[])
  const [cat, setCat] = useState<SubCategory | null>(null)
  const [status, setStatus] = useState<SubStatus | 'all'>('사용 중')
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null)
  const rows = list.filter(s => (status === 'all' || s.status === status) && (!cat || s.category === cat))
  const active = list.filter(s => s.status !== '해지')
  const sum = useMemo(() => {
    const krw = active.filter(s => s.currency === 'KRW').reduce((n, s) => n + monthly(s), 0)
    const usd = active.filter(s => s.currency === 'USD').reduce((n, s) => n + monthly(s), 0)
    return { krw, usd, yearKrw: krw * 12, yearUsd: usd * 12 }
  }, [active])
  const soon = active.filter(s => s.next_billing && s.next_billing >= today && s.next_billing <= addDaysKey(today, 7))
  const cols: BoardCol<Subscription>[] = [
    { key: 'status', label: '상태', width: 72, cell: s => <Badge tone={S_TONE[s.status]}>{s.status}</Badge> },
    {
      key: 'name',
      label: '서비스',
      kind: 'title',
      cell: s => (
        <>
          <span className="t-smallb">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                {s.name}
              </a>
            ) : (
              s.name
            )}
          </span>
          {(s.plan || s.memo) && <span className="cell-sub">{[s.plan, s.memo].filter(Boolean).join(' · ')}</span>}
        </>
      ),
    },
    { key: 'cat', label: '분류', width: 100, hideNarrow: true, cell: s => s.category },
    { key: 'amount', label: '요금', width: 120, kind: 'num', cell: s => <span className="t-smallb">{money(s.amount, s.currency)}</span> },
    { key: 'cycle', label: '주기', width: 50, kind: 'center', cell: s => s.cycle },
    { key: 'monthly', label: '월 환산', width: 110, kind: 'num', hideNarrow: true, cell: s => (s.cycle === '1회' ? '-' : money(monthly(s), s.currency)) },
    { key: 'next', label: '다음 결제', width: 100, cell: s => (s.next_billing ? <span className={`t-meta ${s.next_billing <= addDaysKey(today, 7) && s.status !== '해지' ? 't-red' : ''}`}>{shortDate(s.next_billing)}</span> : '-') },
    { key: 'pay', label: '결제 수단', width: 90, hideNarrow: true, cell: s => s.pay_method ?? '-' },
    { key: 'owner', label: '관리', width: 72, cell: s => (s.owner_id ? profileName(s.owner_id) : '-') },
    { key: 'seats', label: '좌석', width: 50, kind: 'num', hideNarrow: true, cell: s => s.seats ?? '-' },
  ]
  return (
    <div className="col gap-10">
      <div className="kpis kpis-4">
        <div className="kpi">
          <span className="t-cap">월 구독료 합계</span>
          <span className="v">{sum.krw.toLocaleString('ko-KR')}원</span>
          <span className="sub">{sum.usd ? `+ $${sum.usd.toLocaleString('en-US')} (달러 결제)` : '달러 결제 없음'}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">연 환산</span>
          <span className="v">{sum.yearKrw.toLocaleString('ko-KR')}원</span>
          <span className="sub">{sum.yearUsd ? `+ $${sum.yearUsd.toLocaleString('en-US')}` : ''}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">사용 중</span>
          <span className="v">{active.filter(s => s.status === '사용 중').length}</span>
          <span className="sub">해지 예정 {active.filter(s => s.status === '해지 예정').length} · 해지 {list.length - active.length}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">7일 안 결제</span>
          <span className={`v ${soon.length ? 't-red' : ''}`}>{soon.length}</span>
          <span className="sub">{soon.map(s => s.name).slice(0, 3).join(' · ') || '없음'}</span>
        </div>
      </div>
      <div className="row wrap">
        <div className="chips">
          {SUB_STATUSES.map(s => (
            <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
              {s} {list.filter(x => x.status === s).length}
            </Chip>
          ))}
          <Chip active={status === 'all'} onClick={() => setStatus('all')}>
            전체 {list.length}
          </Chip>
        </div>
        <span className="grow" />
        <select className="input" style={{ width: 150 }} value={cat ?? ''} onChange={e => setCat((e.target.value as SubCategory) || null)} aria-label="분류">
          <option value="">모든 분류</option>
          {SUB_CATEGORIES.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {admin && <Button onClick={() => setEditing('new')}>구독 추가</Button>}
      </div>
      <Board rows={rows} cols={cols} rowKey={s => s.id} onRow={admin ? s => setEditing(s) : undefined} empty={loading ? '불러오는 중…' : '등록된 구독이 없습니다. 관리자가 구독 추가로 등록합니다.'} rowClass={s => (s.status === '해지' ? 'done' : undefined)} />
      <span className="t-cap">결제일 7일 전과 당일 아침에 관리자에게 알림이 갑니다. 월 · 년 구독은 결제일이 지나면 다음 결제일로 자동으로 넘어갑니다.</span>
      {editing && (
        <SubForm
          sub={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDelete={
            editing !== 'new'
              ? async () => {
                  if ((await ask(`'${editing.name}' 구독을 지울까요?`)) && (await run(() => api.deleteSubscription(editing.id), '지웠습니다.'))) setEditing(null)
                }
              : undefined
          }
          busy={busy}
        />
      )}
    </div>
  )
}

const addDaysKey = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00+09:00`)
  d.setDate(d.getDate() + n)
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

function SubForm({ sub, onClose, onDelete, busy }: { sub: Subscription | null; onClose: () => void; onDelete?: () => void; busy: boolean }) {
  const { api, profiles } = useApp()
  const { run } = useAction()
  const [f, setF] = useState<Partial<Subscription>>(() => sub ?? { name: '', category: '기타', amount: 0, currency: 'KRW', cycle: '월', status: '사용 중' })
  const set = (p: Partial<Subscription>) => setF(prev => ({ ...prev, ...p }))
  const save = async () => {
    if (!(f.name ?? '').trim()) return window.alert('서비스 이름을 적어 주세요.')
    if ((await run(() => api.saveSubscription({ ...f, name: f.name!.trim(), plan: f.plan || null, pay_method: f.pay_method || null, account_email: f.account_email || null, url: f.url || null, memo: f.memo || null, next_billing: f.next_billing || null, seats: f.seats ?? null, owner_id: f.owner_id || null }), '저장했습니다.'))) onClose()
  }
  return (
    <Modal
      title={sub ? '구독 수정' : '구독 추가'}
      onClose={onClose}
      actions={
        <>
          {onDelete && (
            <Button kind="ghost" onClick={onDelete} disabled={busy}>
              삭제
            </Button>
          )}
          <span className="grow" />
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="서비스 · 프로그램">
          <input className="input" autoFocus value={f.name ?? ''} onChange={e => set({ name: e.target.value })} placeholder="예) Figma" maxLength={100} />
        </Field>
        <Field label="분류">
          <select className="input" value={f.category ?? '기타'} onChange={e => set({ category: e.target.value as SubCategory })}>
            {SUB_CATEGORIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="요금제 · 좌석 설명">
          <input className="input" value={f.plan ?? ''} onChange={e => set({ plan: e.target.value })} placeholder="예) Professional · 3석" maxLength={100} />
        </Field>
        <Field label="상태">
          <select className="input" value={f.status ?? '사용 중'} onChange={e => set({ status: e.target.value as SubStatus })}>
            {SUB_STATUSES.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="요금">
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" type="number" min={0} value={f.amount ?? 0} onChange={e => set({ amount: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            <select className="input" style={{ width: 80 }} value={f.currency ?? 'KRW'} onChange={e => set({ currency: e.target.value as 'KRW' | 'USD' })}>
              <option value="KRW">원</option>
              <option value="USD">$</option>
            </select>
          </div>
        </Field>
        <Field label="결제 주기">
          <select className="input" value={f.cycle ?? '월'} onChange={e => set({ cycle: e.target.value as Subscription['cycle'] })}>
            {SUB_CYCLES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="다음 결제일">
          <input className="input" type="date" value={f.next_billing ?? ''} onChange={e => set({ next_billing: e.target.value || null })} />
        </Field>
        <Field label="결제 수단">
          <input className="input" value={f.pay_method ?? ''} onChange={e => set({ pay_method: e.target.value })} placeholder="예) 법인카드 · 세금계산서" maxLength={60} />
        </Field>
        <Field label="계정 이메일">
          <input className="input" type="email" value={f.account_email ?? ''} onChange={e => set({ account_email: e.target.value })} maxLength={120} />
        </Field>
        <Field label="관리 담당">
          <select className="input" value={f.owner_id ?? ''} onChange={e => set({ owner_id: e.target.value || null })}>
            <option value="">없음</option>
            {profiles
              .filter(p => p.active && !p.is_agent)
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="좌석 수">
          <input className="input" type="number" min={0} value={f.seats ?? ''} onChange={e => set({ seats: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
        </Field>
        <Field label="주소">
          <input className="input" type="url" value={f.url ?? ''} onChange={e => set({ url: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="메모" className="full">
          <input className="input" value={f.memo ?? ''} onChange={e => set({ memo: e.target.value })} maxLength={1000} placeholder="예) 연 갱신 전 좌석 수 재검토" />
        </Field>
      </div>
    </Modal>
  )
}
