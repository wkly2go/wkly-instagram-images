// 현장 작업일지 · 건별 기입 → 일별 보고서 (대표 지시 2026-10-31 "건별 기입한 걸 일별로 묶어서 보고서 형태로 변환하는 구조로")
//   - 한 줄 기입: 날짜 · 구분(작업 · 인원 · 자재 입고 · 자재 출고 · 반품 · 특이사항) · 공종/품목 · 수량 · 금액 · 협력사 · 내용 → [기록]
//     · 작업 / 인원 / 특이사항 → 그날 작업일지(site_logs)에 한 건씩 더함 (그날 장이 없으면 자동으로 만듦)
//     · 자재 입고 · 출고 · 반품 → 자재 입출고(material_moves) 한 건 (입고 · 반품은 협력업체 관리 지급에 자동 등록)
//   - 아래 목록은 날짜별로 묶임, 누르면 그 줄 아래로 그날 보고서(작업일지 형태)가 펼쳐짐 · 인쇄 · 결재
import { useMemo, useState } from 'react'
import { Printer, X } from 'lucide-react'
import { useAction, useApp } from '../lib/app'
import { shortDate, todayKey, weekday } from '../lib/date'
import { EVIDENCE_KINDS, SITE_SIGNERS, SITE_TRADES, evidenceHasVat, type Client, type EvidenceKind, type MaterialMove, type Project, type SiteLabor, type SiteLog, type SiteSigner } from '../lib/types'
import { Button } from './ui'

export const ENTRY_KINDS = ['작업', '인원', '입고', '출고', '반품', '특이사항'] as const
type EntryKind = (typeof ENTRY_KINDS)[number]
const KIND_LABEL: Record<EntryKind, string> = { 작업: '작업 내용', 인원: '투입 인원', 입고: '자재 입고', 출고: '자재 출고', 반품: '자재 반품', 특이사항: '특이사항' }
const won = (n: number) => (n ? Math.round(n).toLocaleString('ko-KR') : '-')
const num = (v: string) => Math.max(0, Number(v.replace(/[^\d.]/g, '')) || 0)
const groupOf = (trade: string) => SITE_TRADES.find(t => t[1] === trade.trim())?.[0] ?? '기타'
const contractOf = (trade: string) => SITE_TRADES.find(t => t[1] === trade.trim())?.[2] ?? ''

/** 한 줄 기입 */
export function SiteEntryBar({ project, logs, clients, moves }: { project: Project; logs: SiteLog[]; clients: Client[]; moves: MaterialMove[] }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const blank = { date: todayKey(), kind: '작업' as EntryKind, what: '', spec: '', qty: '', night: '', price: '', vendor: '', text: '', evidence: '세금계산서' as EvidenceKind }
  const [f, setF] = useState(blank)
  const isMat = f.kind === '입고' || f.kind === '출고' || f.kind === '반품'
  const trades = useMemo(() => [...new Set([...SITE_TRADES.map(t => t[1]), ...logs.flatMap(l => l.labor.map(x => x.trade))])], [logs])
  const items = useMemo(() => [...new Set(moves.map(m => m.name))], [moves])
  const vendors = useMemo(() => [...new Set([...clients.map(c => c.name), ...logs.flatMap(l => l.labor.map(x => x.vendor).filter(Boolean)), ...moves.map(m => m.supplier ?? '').filter(Boolean)])], [clients, logs, moves])

  /** 그날 장을 찾거나 만듦 */
  const dayLog = async (date: string): Promise<SiteLog> => {
    const exist = logs.find(l => l.log_date === date)
    if (exist) return exist
    const prev = [...logs].sort((a, b) => b.log_date.localeCompare(a.log_date))[0]
    return api.saveSiteLog({ project_id: project.id, log_date: date, weather: null, site_manager: prev?.site_manager ?? null, staff: prev?.staff ?? null, labor: [], materials: [], today_work: null, next_work: null, photos: [], events: null, signs: {} })
  }
  const ready = isMat ? !!f.what.trim() && num(f.qty) > 0 : f.kind === '인원' ? !!f.what.trim() && num(f.qty) + num(f.night) > 0 : !!f.text.trim()

  const save = async () => {
    if (!ready) return
    const ok = await run(async () => {
      if (isMat) {
        await dayLog(f.date) // 그날 보고서 줄이 생기도록
        const client = clients.find(c => c.name === f.vendor.trim())
        await api.saveMaterialMove({
          project_id: project.id,
          kind: f.kind as '입고' | '출고' | '반품',
          material_id: null,
          name: f.what.trim(),
          spec: f.spec.trim() || null,
          unit: null,
          qty: num(f.qty),
          unit_price: f.kind === '출고' ? 0 : num(f.price),
          supplier: f.vendor.trim() || null,
          client_id: client?.id ?? null,
          evidence: f.kind === '출고' ? '현금' : f.evidence,
          invoice_received: false,
          paid: false,
          received_on: f.date,
        })
        return
      }
      const log = await dayLog(f.date)
      if (f.kind === '특이사항') {
        await api.saveSiteLog({ id: log.id, events: [log.events, f.text.trim()].filter(Boolean).join('\n') })
        return
      }
      const trade = f.what.trim()
      if (f.kind === '작업' && !trade) {
        await api.saveSiteLog({ id: log.id, today_work: [log.today_work, f.text.trim()].filter(Boolean).join('\n') })
        return
      }
      const labor: SiteLabor[] = [...log.labor]
      const i = labor.findIndex(l => l.trade === trade && (!f.vendor.trim() || !l.vendor || l.vendor === f.vendor.trim()))
      const cur = i >= 0 ? labor[i] : { group: groupOf(trade), trade, contract: contractOf(trade), day: 0, night: 0, vendor: '', note: '' }
      const next: SiteLabor = {
        ...cur,
        day: (cur.day || 0) + (f.kind === '인원' ? num(f.qty) : 0),
        night: (cur.night || 0) + (f.kind === '인원' ? num(f.night) : 0),
        vendor: f.vendor.trim() || cur.vendor,
        note: f.text.trim() ? [cur.note, f.text.trim()].filter(Boolean).join(' · ') : cur.note,
      }
      if (i >= 0) labor[i] = next
      else labor.push(next)
      await api.saveSiteLog({ id: log.id, labor })
    }, `${shortDate(f.date)} ${KIND_LABEL[f.kind]}을(를) 기록했습니다.`)
    if (ok) setF(s => ({ ...blank, date: s.date, kind: s.kind, vendor: s.kind === '인원' || isMat ? s.vendor : '', evidence: s.evidence }))
  }
  const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.preventDefault(), void save())

  return (
    <div className="site-entry">
      <datalist id="se-trade">{trades.map(t => <option key={t} value={t} />)}</datalist>
      <datalist id="se-item">{items.map(t => <option key={t} value={t} />)}</datalist>
      <datalist id="se-vendor">{vendors.map(t => <option key={t} value={t} />)}</datalist>
      <input className="input se-date" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value || todayKey() })} aria-label="날짜" />
      <div className="seg" role="radiogroup" aria-label="구분">
        {ENTRY_KINDS.map(k => (
          <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={f.kind === k ? 'on' : ''} onClick={() => setF({ ...f, kind: k })}>
            {k === '입고' || k === '출고' ? `자재 ${k}` : k}
          </button>
        ))}
      </div>
      {f.kind !== '특이사항' && (
        <input className="input se-what" list={isMat ? 'se-item' : 'se-trade'} value={f.what} onChange={e => setF({ ...f, what: e.target.value })} onKeyDown={enter} placeholder={isMat ? '품목' : f.kind === '작업' ? '공종 (선택)' : '공종'} aria-label={isMat ? '품목' : '공종'} />
      )}
      {isMat && <input className="input se-n" value={f.spec} onChange={e => setF({ ...f, spec: e.target.value })} onKeyDown={enter} placeholder="규격" aria-label="규격" />}
      {(isMat || f.kind === '인원') && (
        <input className="input se-n" inputMode="numeric" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} onKeyDown={enter} placeholder={isMat ? '수량' : '주간 인원'} aria-label={isMat ? '수량' : '주간 인원'} />
      )}
      {f.kind === '인원' && <input className="input se-n" inputMode="numeric" value={f.night} onChange={e => setF({ ...f, night: e.target.value })} onKeyDown={enter} placeholder="야간" aria-label="야간 인원" />}
      {(f.kind === '입고' || f.kind === '반품') && (
        <>
          <input className="input se-m" inputMode="numeric" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} onKeyDown={enter} placeholder="단가 (공급가)" aria-label="단가" />
          <select className="select se-n" value={f.evidence} onChange={e => setF({ ...f, evidence: e.target.value as EvidenceKind })} aria-label="증빙">
            {EVIDENCE_KINDS.map(k => <option key={k}>{k}</option>)}
          </select>
        </>
      )}
      {f.kind !== '특이사항' && f.kind !== '작업' && <input className="input se-m" list="se-vendor" value={f.vendor} onChange={e => setF({ ...f, vendor: e.target.value })} onKeyDown={enter} placeholder="협력사" aria-label="협력사" />}
      {!isMat && <input className="input se-text" value={f.text} onChange={e => setF({ ...f, text: e.target.value })} onKeyDown={enter} placeholder={f.kind === '특이사항' ? '특이사항 · 이벤트' : f.kind === '인원' ? '작업 내용 (선택)' : '오늘 한 작업'} aria-label="내용" />}
      <Button size="sm" disabled={busy || !ready} onClick={() => void save()}>
        기록
      </Button>
      {(f.kind === '입고' || f.kind === '반품') && num(f.qty) * num(f.price) > 0 && (
        <span className="t-cap se-sum">
          {won(num(f.qty) * num(f.price))}원{evidenceHasVat(f.evidence) ? ' + 부가세' : ''} · 협력업체 관리 지급에 자동 등록
        </span>
      )}
    </div>
  )
}

/** 그날 보고서 (작업일지 형태, 읽기 전용 · 건마다 지우기) */
export function DayReport({ project, log, moves, onEdit }: { project: Project; log: SiteLog; moves: MaterialMove[]; onEdit: () => void }) {
  const { api, me, profileName } = useApp()
  const { busy, run } = useAction()
  const labor = log.labor.filter(l => (l.day || 0) + (l.night || 0) > 0 || l.note?.trim())
  const mats = moves.filter(m => m.received_on === log.log_date && m.status !== '취소')
  const legacy = log.materials.filter(m => m.item.trim() && (m.amount || m.qty))
  const crew = labor.reduce((n, l) => n + (l.day || 0) + (l.night || 0), 0)
  const matIn = mats.filter(m => m.kind === '입고').reduce((n, m) => n + m.qty * m.unit_price, 0) - mats.filter(m => m.kind === '반품').reduce((n, m) => n + m.qty * m.unit_price, 0)
  const dropLabor = (l: SiteLabor) => run(() => api.saveSiteLog({ id: log.id, labor: log.labor.filter(x => x !== l) }), '그 줄을 뺐습니다.')
  const dropLine = (field: 'today_work' | 'events', i: number) => {
    const lines = (log[field] ?? '').split('\n')
    lines.splice(i, 1)
    void run(() => api.saveSiteLog({ id: log.id, [field]: lines.join('\n').trim() || null }), '그 줄을 뺐습니다.')
  }
  const sign = (k: SiteSigner) => {
    const cur = log.signs[k]
    if (k === '대표' && me.role !== 'admin') return
    if (cur && cur.by !== me.id && me.role !== 'admin') return
    const signs = { ...log.signs }
    if (cur) delete signs[k]
    else signs[k] = { by: me.id, at: new Date().toISOString() }
    void run(() => api.saveSiteLog({ id: log.id, signs }), cur ? `${k} 결재를 취소했습니다.` : `${k} 결재했습니다.`)
  }
  return (
    <div className="day-report">
      <div className="dr-bar no-print">
        <b className="grow">
          {shortDate(log.log_date)} ({weekday(log.log_date)}) 작업 보고 · 인원 {crew}명 · 자재 {won(matIn)}원
        </b>
        <Button kind="ghost" size="sm" onClick={onEdit} title="날씨 · 현장소장 · 사진 · 익일 공정 등 양식 전체 고치기">
          양식으로 고치기
        </Button>
        <Button kind="outline" size="sm" onClick={() => window.print()}>
          <Printer size={12} /> 인쇄
        </Button>
      </div>
      <h3 className="sitelog-title">작 업 일 지</h3>
      <div className="dr-head">
        <dl className="kv">
          <dt>현장</dt>
          <dd>{[project.code, project.name].filter(Boolean).join(' ')}</dd>
          <dt>일자</dt>
          <dd>
            {log.log_date} ({weekday(log.log_date)}){log.weather ? ` · ${log.weather}` : ''}
          </dd>
          <dt>현장소장</dt>
          <dd>{log.site_manager || '-'}</dd>
        </dl>
        <div className="dr-signs">
          {SITE_SIGNERS.map(k => (
            <button key={k} type="button" className={`site-sign${log.signs[k] ? ' on' : ''}`} onClick={() => sign(k)} disabled={busy || (k === '대표' && me.role !== 'admin')}>
              <span>{k}</span>
              <b>{log.signs[k] ? profileName(log.signs[k]!.by) : ''}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="site-sec">가. 금일 작업 · 투입 인원</div>
      {labor.length === 0 && !log.today_work ? (
        <span className="t-cap">기록 없음</span>
      ) : (
        <table className="site-table dr-table">
          <thead>
            <tr>
              <th>공종</th>
              <th>작업 내용</th>
              <th className="n">주간</th>
              <th className="n">야간</th>
              <th>협력사</th>
              <th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {labor.map((l, i) => (
              <tr key={i}>
                <td className="strong">{l.trade}</td>
                <td>{l.note || '-'}</td>
                <td className="n">{l.day || '-'}</td>
                <td className="n">{l.night || '-'}</td>
                <td>{l.vendor || '-'}</td>
                <td className="no-print">
                  <button type="button" className="icon-btn xs" aria-label="빼기" disabled={busy} onClick={() => void dropLabor(l)}>
                    <X size={11} />
                  </button>
                </td>
              </tr>
            ))}
            {(log.today_work ?? '').split('\n').filter(Boolean).map((t, i) => (
              <tr key={`w${i}`}>
                <td className="t-cap">공통</td>
                <td colSpan={4}>{t}</td>
                <td className="no-print">
                  <button type="button" className="icon-btn xs" aria-label="빼기" disabled={busy} onClick={() => dropLine('today_work', i)}>
                    <X size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>합계</th>
              <td className="n">{labor.reduce((n, l) => n + (l.day || 0), 0)}</td>
              <td className="n">{labor.reduce((n, l) => n + (l.night || 0), 0)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      )}

      <div className="site-sec">나. 자재 입출고</div>
      {mats.length === 0 && legacy.length === 0 ? (
        <span className="t-cap">기록 없음</span>
      ) : (
        <table className="site-table dr-table">
          <thead>
            <tr>
              <th>구분</th>
              <th>품목</th>
              <th>규격</th>
              <th className="n">수량</th>
              <th className="n">금액 (공급가)</th>
              <th>협력사</th>
              <th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {mats.map(m => (
              <tr key={m.id}>
                <td>{m.kind}</td>
                <td className="strong">{m.name}</td>
                <td>{m.spec || '-'}</td>
                <td className="n">{m.qty.toLocaleString('ko-KR')}</td>
                <td className="n">{m.kind === '출고' ? '-' : `${m.kind === '반품' ? '−' : ''}${won(m.qty * m.unit_price)}`}</td>
                <td>{m.supplier || '-'}</td>
                <td className="no-print">
                  <button type="button" className="icon-btn xs" aria-label="취소" disabled={busy} onClick={() => void run(() => api.saveMaterialMove({ id: m.id, status: '취소' }), '취소했습니다. 연결된 지급도 취소됩니다.')}>
                    <X size={11} />
                  </button>
                </td>
              </tr>
            ))}
            {legacy.map((m, i) => (
              <tr key={`l${i}`}>
                <td>지급</td>
                <td className="strong">{m.item}</td>
                <td>{m.spec || '-'}</td>
                <td className="n">{m.qty || '-'}</td>
                <td className="n">{won(m.amount)}</td>
                <td>{m.vendor || '-'}</td>
                <td className="no-print" />
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="site-sec">다. 특이사항</div>
      {(log.events ?? '').split('\n').filter(Boolean).length === 0 ? (
        <span className="t-cap">없음</span>
      ) : (
        <ul className="dr-events">
          {(log.events ?? '').split('\n').filter(Boolean).map((t, i) => (
            <li key={i}>
              {t}
              <button type="button" className="icon-btn xs no-print" aria-label="빼기" disabled={busy} onClick={() => dropLine('events', i)}>
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {log.next_work && (
        <>
          <div className="site-sec">라. 익일 공정</div>
          <p className="pre">{log.next_work}</p>
        </>
      )}
    </div>
  )
}
