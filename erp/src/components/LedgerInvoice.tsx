// 계산서 기준 장부 (대표 지시 2026-11-12 "계산서 발행을 우선으로 반영해")
//  - 매출 · 매입은 홈택스 세금계산서 발행일 · 공급가액 기준으로 봄 (돈이 들어오고 나간 날이 아니라)
//  - 계산서마다 통장 입금 · 지급과 짝을 지어, 아직 안 들어온 돈(미수) · 안 낸 돈(미지급)을 보여 줌
import { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { Button, Empty } from './ui'
import { useApp } from '../lib/app'
import { manwon, todayKey, won } from '../lib/date'
import { downloadText, toCsv } from '../lib/csv'
import type { LedgerEntry, TaxInvoice, TaxInvoiceSummary } from '../lib/types'
import { day, matchInvoices, type InvoiceMatch } from '../lib/invoiceMatch'
import { runSettlement } from '../lib/invoiceSettle'

export function InvoiceView({ year, onExpired }: { year: string; onExpired: () => void }) {
  const { api, toast } = useApp()
  const [invoices, setInvoices] = useState<TaxInvoice[]>([])
  const [rows, setRows] = useState<LedgerEntry[]>([])
  const [allInv, setAllInv] = useState<TaxInvoice[]>([])
  const [sums, setSums] = useState<TaxInvoiceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const today = todayKey()
  const resettle = async () => {
    setBusy(true)
    try {
      const r = await runSettlement(api)
      toast(`은행 · 카드 거래와 다시 맞췄습니다 · 바뀐 계산서 ${r.changed}건 · 남은 계산서 ${r.open}건`)
      setTick(t => t + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : '다시 맞추지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setLoading(true)
    Promise.all([api.listTaxInvoices(), api.listLedger(`${Number(year) - 1}-11-01`, `${Number(year) + 1}-02-28`), api.listTaxInvoiceSummaries().catch(() => [] as TaxInvoiceSummary[])])
      .then(([inv, led, sm]) => {
        setInvoices(inv.filter(i => i.total && i.write_date.startsWith(year)))
        setAllInv(inv)
        setRows(led)
        setSums(sm.filter(x => x.period_from.startsWith(year) || x.period_to.startsWith(year)))
      })
      .catch(() => onExpired())
      .finally(() => setLoading(false))
  }, [api, year, onExpired, tick])

  // 저장된 대사 결과(0108 · settled)가 있으면 그것을, 없으면 화면에서 짝지음
  const matches = useMemo<InvoiceMatch[]>(() => {
    if (!invoices.length || invoices.some(i => i.settled_at == null)) return matchInvoices(invoices, rows)
    const byId = new Map(rows.map(r => [r.id, r]))
    return [...invoices]
      .sort((a, b) => a.write_date.localeCompare(b.write_date))
      .map(inv => {
        const total = Math.abs(inv.total)
        const paid = Math.min(total, inv.settled ?? 0)
        const ids = inv.ledger_ids ?? []
        return { inv, row: ids.length === 1 && paid === total ? byId.get(ids[0]) ?? null : null, paid, left: inv.total < 0 ? 0 : total - paid, canceled: (inv.settle_how ?? '').includes('수정 발행') }
      })
  }, [invoices, rows])
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`), [year])
  const open = (m: InvoiceMatch) => m.left > 0 && !m.inv.done
  const data = months.map(m => {
    const list = matches.filter(x => x.inv.write_date.startsWith(m))
    const s = (d: '매출' | '매입') => list.filter(x => x.inv.direction === d).reduce((n, x) => n + x.inv.supply, 0)
    const o = (d: '매출' | '매입') => list.filter(x => x.inv.direction === d && open(x)).reduce((n, x) => n + x.left, 0)
    return { m, sales: s('매출'), buy: s('매입'), net: s('매출') - s('매입'), recv: o('매출'), pay: o('매입'), count: list.length }
  })
  const sum = (k: 'sales' | 'buy' | 'net' | 'recv' | 'pay') => data.reduce((n, d) => n + d[k], 0)
  const unpaid = (d: '매출' | '매입') => matches.filter(x => x.inv.direction === d && open(x)).sort((a, b) => a.inv.write_date.localeCompare(b.inv.write_date))
  const recv = unpaid('매출')
  const pay = unpaid('매입')

  const exportCsv = () => {
    const csv = toCsv(
      matches.map(x => ({
        발행일: x.inv.write_date,
        구분: x.inv.direction,
        거래처: x.inv.partner_name,
        품목: x.inv.item ?? '',
        공급가액: x.inv.supply,
        부가세: x.inv.vat,
        합계: x.inv.total,
        상태: x.canceled ? '수정 발행으로 취소' : x.row ? `${x.inv.direction === '매출' ? '입금' : '지급'} ${x.row.entry_date}` : x.left === 0 ? '나눠서 완료' : x.inv.done ? '완료 표시' : x.paid ? `일부 (${x.paid.toLocaleString('ko-KR')})` : x.inv.direction === '매출' ? '미수' : '미지급',
        남은돈: x.left,
        대사: x.inv.settle_how ?? '',
        장부줄: (x.inv.ledger_ids ?? []).join(' '),
        승인번호: x.inv.approval_no,
      })),
    )
    downloadText(`계산서기준장부_${year}년.csv`, '﻿' + csv)
  }

  if (loading) return <Empty>불러오는 중…</Empty>
  if (!invoices.length)
    return <Empty>{year}년 세금계산서가 없습니다. 결제 › 세금계산서 탭이나 회계 자료 탭에 홈택스 매출 · 매입 목록 엑셀을 올려 주세요.</Empty>

  const List = ({ title, list, kind }: { title: string; list: InvoiceMatch[]; kind: '매출' | '매입' }) => (
    <section className="col gap-6" aria-label={title}>
      <div className="row t-cap">
        <b className="grow">
          {title} {list.length}건 · {manwon(list.reduce((n, x) => n + x.left, 0))}
        </b>
      </div>
      {list.length === 0 ? (
        <span className="t-meta">없음</span>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>발행일</th>
              <th>거래처</th>
              <th>품목</th>
              <th className="num" title="부가세 포함" style={{ minWidth: 120 }}>합계</th>
              <th className="num">남은 돈</th>
              <th className="num">지난 날</th>
            </tr>
          </thead>
          <tbody>
            {list.map(x => {
              const late = Math.round(day(today) - day(x.inv.write_date))
              return (
                <tr key={x.inv.id}>
                  <td className="mono">{x.inv.write_date.slice(2).replaceAll('-', '.')}</td>
                  <td className="truncate">{x.inv.partner_name}</td>
                  <td className="truncate t-meta">{x.inv.item ?? ''}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>{won(Math.abs(x.inv.total))}</td>
                  <td className={`num ${kind === '매출' ? 'in' : 'out'}`}>{won(x.left)}</td>
                  <td className={`num ${late > 60 ? 'out' : ''}`}>{late}일</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )

  return (
    <div className="col gap-12">
      <p className="t-meta">
        홈택스 세금계산서 <b>발행일 · 공급가액</b> 기준입니다 (부가세 제외). 통장 입금 · 지급과 짝이 지어지지 않은 계산서는 미수 · 미지급으로 보여 줍니다.
      </p>
      <div className="ledger-kpis four">
        <div className="ledger-kpi in">
          <span className="t-cap">{year}년 매출 (계산서)</span>
          <b>{manwon(sum('sales'))}</b>
          <span className="t-meta">{invoices.filter(i => i.direction === '매출').length}건 발행</span>
        </div>
        <div className="ledger-kpi out">
          <span className="t-cap">{year}년 매입 (계산서)</span>
          <b>{manwon(sum('buy'))}</b>
          <span className="t-meta">{invoices.filter(i => i.direction === '매입').length}건 받음</span>
        </div>
        <div className={`ledger-kpi net ${sum('net') < 0 ? 'minus' : ''}`}>
          <span className="t-cap">계산서 기준 차액</span>
          <b>{manwon(sum('net'))}</b>
          <span className="t-meta">매출 − 매입 (공급가액)</span>
        </div>
        <div className="ledger-kpi">
          <span className="t-cap">미수 · 미지급</span>
          <b>
            {recv.length} · {pay.length}건
          </b>
          <span className="t-meta">
            받을 돈 {manwon(sum('recv'))} · 낼 돈 {manwon(sum('pay'))}
          </span>
        </div>
      </div>

      <table className="ledger-table cmp-table">
        <thead>
          <tr>
            <th>월</th>
            <th className="num">매출 (공급가)</th>
            <th className="num">매입 (공급가)</th>
            <th className="num">차액</th>
            <th className="num">미수</th>
            <th className="num">미지급</th>
          </tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.m} className={d.m === today.slice(0, 7) ? 'editing' : ''}>
              <td className="mono">{d.m.replace('-', '.')}</td>
              <td className="num in">{d.sales ? d.sales.toLocaleString('ko-KR') : '-'}</td>
              <td className="num out">{d.buy ? d.buy.toLocaleString('ko-KR') : '-'}</td>
              <td className={`num ${d.net < 0 ? 'out' : 'in'}`}>{d.count ? `${d.net < 0 ? '−' : '+'}${Math.abs(d.net).toLocaleString('ko-KR')}` : '-'}</td>
              <td className="num">{d.recv ? d.recv.toLocaleString('ko-KR') : '-'}</td>
              <td className="num">{d.pay ? d.pay.toLocaleString('ko-KR') : '-'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="cmp-total">
            <td>
              <b>{year}년 합계</b>
            </td>
            <td className="num in">{sum('sales').toLocaleString('ko-KR')}</td>
            <td className="num out">{sum('buy').toLocaleString('ko-KR')}</td>
            <td className={`num ${sum('net') < 0 ? 'out' : 'in'}`}>
              {sum('net') < 0 ? '−' : '+'}
              {Math.abs(sum('net')).toLocaleString('ko-KR')}
            </td>
            <td className="num">{sum('recv').toLocaleString('ko-KR')}</td>
            <td className="num">{sum('pay').toLocaleString('ko-KR')}</td>
          </tr>
        </tfoot>
      </table>
      <div className="row">
        <span className="grow" />
        <Button kind="ghost" size="sm" onClick={() => void resettle()} disabled={busy} title="계산서를 은행 · 카드 거래와 처음부터 다시 맞춤 (자료를 새로 올리면 자동)">
          <RefreshCw size={14} /> {busy ? '맞추는 중…' : '다시 대사'}
        </Button>
        <Button kind="ghost" size="sm" onClick={exportCsv} title={`${year}년 계산서마다 입금 · 지급 여부를 엑셀(CSV)로`}>
          <Download size={14} /> 계산서 기준 엑셀
        </Button>
      </div>

      {(() => {
        // 홈택스 세금계산서 합계표 대조 (0109 · 2026-11-12): 기간 · 거래처별 매수 · 합계금액이 인트라넷 대장과 같은지
        if (!sums.length)
          return <p className="t-meta">홈택스 › 세금계산서 합계표(매출처별 · 매입처별) 엑셀을 회계 자료 탭에 올리면, 인트라넷에 빠진 계산서를 찾아 여기 보여 줍니다.</p>
        const periods = [...new Set(sums.map(x => `${x.direction}|${x.period_from}|${x.period_to}`))]
        const diffs: { key: string; dir: string; from: string; to: string; biz: string; name: string; hc: number; ht: number; ic: number; it: number }[] = []
        let same = 0
        for (const p of periods) {
          const [dir, from, to] = p.split('|')
          const inside = allInv.filter(i => i.direction === dir && i.write_date >= from && i.write_date <= to)
          const hs = sums.filter(x => `${x.direction}|${x.period_from}|${x.period_to}` === p)
          const bizs = new Set([...hs.map(x => x.partner_biz_no), ...inside.map(i => i.partner_biz_no ?? '')])
          for (const biz of bizs) {
            if (!biz) continue
            const h = hs.find(x => x.partner_biz_no === biz)
            const mine = inside.filter(i => i.partner_biz_no === biz)
            const it = mine.reduce((n, i) => n + i.total, 0)
            if (h && h.total === it && h.count === mine.length) {
              same++
              continue
            }
            diffs.push({ key: `${p}|${biz}`, dir, from, to, biz, name: h?.partner_name || mine[0]?.partner_name || '(이름 없음)', hc: h?.count ?? 0, ht: h?.total ?? 0, ic: mine.length, it })
          }
        }
        diffs.sort((a, b) => Math.abs(b.ht - b.it) - Math.abs(a.ht - a.it))
        const money = diffs.filter(d => d.ht !== d.it)
        return (
          <section className="col gap-6" aria-label="홈택스 합계표 대조">
            <b className={money.length ? 'lgf-todo' : ''}>
              홈택스 합계표 대조 · 거래처 {same + diffs.length}곳 중 일치 {same}곳{diffs.length ? ` · 차이 ${diffs.length}곳 (금액 차이 ${money.length}곳 · ${won(money.reduce((n, d) => n + d.ht - d.it, 0))})` : ' — 계산서 대장이 홈택스와 같습니다'}
            </b>
            {diffs.length > 0 && (
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>기간</th>
                    <th>구분</th>
                    <th>거래처</th>
                    <th className="num">홈택스</th>
                    <th className="num">인트라넷</th>
                    <th className="num">차이</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map(d => (
                    <tr key={d.key} title={d.ht !== d.it ? (d.ht > d.it ? '인트라넷에 없는 계산서가 있습니다 — 홈택스 계산서 목록(엑셀)을 다시 올려 주세요' : '홈택스 합계표에 없는 계산서가 인트라넷에 있습니다') : '금액은 같고 매수만 다릅니다 (수정 발행 · 0원 계산서)'}>
                      <td className="mono">{d.from.slice(2, 7).replace('-', '.')}~{d.to.slice(2, 7).replace('-', '.')}</td>
                      <td>{d.dir}</td>
                      <td className="truncate">{d.name} <span className="t-meta">{d.biz}</span></td>
                      <td className="num">{d.hc}매 · {won(d.ht)}</td>
                      <td className="num">{d.ic}매 · {won(d.it)}</td>
                      <td className={`num ${d.ht !== d.it ? 'out' : ''}`}>{d.ht !== d.it ? won(d.ht - d.it) : '매수만 다름'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })()}
      <List title="미수 (매출 계산서 발행 · 아직 입금 확인 안 됨)" list={recv} kind="매출" />
      <List title="미지급 (매입 계산서 받음 · 아직 지급 확인 안 됨)" list={pay} kind="매입" />
      <p className="t-meta">
        은행 · 카드 거래와 대사한 결과입니다 (한 번에 · 나눠서 · 두 번에 · 여러 계산서 한 번에 · 카드 · 늦게 받은 계산서 · 수정 발행 취소 · 끝전 차이). 통장에 대표자 개인 이름으로 찍히는 업체, 카드로 낸 돈은 이름이 달라 미지급으로 남을 수 있습니다. 결제 › 세금계산서 탭에서 '완료'로 표시하면 목록에서 빠집니다.
      </p>
    </div>
  )
}
