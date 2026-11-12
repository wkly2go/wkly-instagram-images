// 계산서 기준 장부 (대표 지시 2026-11-12 "계산서 발행을 우선으로 반영해")
//  - 매출 · 매입은 홈택스 세금계산서 발행일 · 공급가액 기준으로 봄 (돈이 들어오고 나간 날이 아니라)
//  - 계산서마다 통장 입금 · 지급과 짝을 지어, 아직 안 들어온 돈(미수) · 안 낸 돈(미지급)을 보여 줌
import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Empty } from './ui'
import { useApp } from '../lib/app'
import { manwon, todayKey, won } from '../lib/date'
import { downloadText, toCsv } from '../lib/csv'
import type { LedgerEntry, TaxInvoice } from '../lib/types'

const clean = (s: string) => s.replace(/\(주\)|（주）|주식회사|㈜|\(.*?\)|\s/g, '').toLowerCase()
const day = (s: string) => Date.parse(`${s}T00:00:00`) / 864e5

export interface InvoiceMatch {
  inv: TaxInvoice
  row: LedgerEntry | null
}

/** 계산서 ↔ 통장 짝짓기: 증빙이 붙은 통장 줄 중 같은 금액 · 발행 45일 전 ~ 60일 뒤, 이름이 맞는 것 먼저 */
export function matchInvoices(invoices: TaxInvoice[], rows: LedgerEntry[]): InvoiceMatch[] {
  const pool = rows.filter(r => r.evidence === '세금계산서' && !r.is_transfer)
  const used = new Set<number>()
  return [...invoices]
    .sort((a, b) => a.write_date.localeCompare(b.write_date))
    .map(inv => {
      const dir = inv.direction === '매출' ? '입금' : '출금'
      const p = clean(inv.partner_name ?? '').slice(0, 4)
      const d0 = day(inv.write_date)
      let best: LedgerEntry | null = null
      let score = Infinity
      for (const r of pool) {
        if (used.has(r.id) || r.direction !== dir || r.amount !== Math.abs(inv.total)) continue
        const gap = day(r.entry_date) - d0
        if (gap < -45 || gap > 60) continue
        const s = (p && clean(`${r.counterparty ?? ''}${r.memo ?? ''}`).includes(p) ? 0 : 1000) + Math.abs(gap)
        if (s < score) {
          score = s
          best = r
        }
      }
      if (best) used.add(best.id)
      return { inv, row: best }
    })
}

export function InvoiceView({ year, onExpired }: { year: string; onExpired: () => void }) {
  const { api } = useApp()
  const [invoices, setInvoices] = useState<TaxInvoice[]>([])
  const [rows, setRows] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const today = todayKey()
  useEffect(() => {
    setLoading(true)
    Promise.all([api.listTaxInvoices(), api.listLedger(`${Number(year) - 1}-11-01`, `${Number(year) + 1}-02-28`)])
      .then(([inv, led]) => {
        setInvoices(inv.filter(i => i.total && i.write_date.startsWith(year)))
        setRows(led)
      })
      .catch(() => onExpired())
      .finally(() => setLoading(false))
  }, [api, year, onExpired])

  const matches = useMemo(() => matchInvoices(invoices, rows), [invoices, rows])
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`), [year])
  const open = (m: InvoiceMatch) => !m.row && !m.inv.done
  const data = months.map(m => {
    const list = matches.filter(x => x.inv.write_date.startsWith(m))
    const s = (d: '매출' | '매입') => list.filter(x => x.inv.direction === d).reduce((n, x) => n + x.inv.supply, 0)
    const o = (d: '매출' | '매입') => list.filter(x => x.inv.direction === d && open(x)).reduce((n, x) => n + Math.abs(x.inv.total), 0)
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
        상태: x.row ? `${x.inv.direction === '매출' ? '입금' : '지급'} ${x.row.entry_date}` : x.inv.done ? '완료 표시' : x.inv.direction === '매출' ? '미수' : '미지급',
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
          {title} {list.length}건 · {manwon(list.reduce((n, x) => n + Math.abs(x.inv.total), 0))}
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
              <th className="num" title="부가세 포함">합계</th>
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
                  <td className={`num ${kind === '매출' ? 'in' : 'out'}`}>{won(Math.abs(x.inv.total))}</td>
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
        <Button kind="ghost" size="sm" onClick={exportCsv} title={`${year}년 계산서마다 입금 · 지급 여부를 엑셀(CSV)로`}>
          <Download size={14} /> 계산서 기준 엑셀
        </Button>
      </div>

      <List title="미수 (매출 계산서 발행 · 아직 입금 확인 안 됨)" list={recv} kind="매출" />
      <List title="미지급 (매입 계산서 받음 · 아직 지급 확인 안 됨)" list={pay} kind="매입" />
      <p className="t-meta">
        나눠서 받거나 낸 돈, 카드로 낸 돈은 계산서 금액과 달라 미수 · 미지급으로 남을 수 있습니다. 결제 › 세금계산서 탭에서 '완료'로 표시하면 목록에서 빠집니다.
      </p>
    </div>
  )
}
