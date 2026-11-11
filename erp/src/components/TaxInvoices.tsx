import { useMemo, useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { manwon, shortDate } from '../lib/date'
import type { Project, TaxInvoice, TaxInvoiceDraft } from '../lib/types'
import { Button, Chip, Empty, Loading } from './ui'

/**
 * 전자세금계산서 대장 (대표 지시 2026-11-06 "계산서 정산 내역 인트라넷에 반영")
 *  - 홈택스 '전자(수정) 세금계산서 목록조회' 엑셀(.xls)을 올리면 승인번호 기준으로 쌓음 (같은 건은 한 번만)
 *  - 연도 · 매출/매입별 합계, 부가세 신고 기간(1기 1~6월 · 2기 7~12월), 월별 합계, 프로젝트 연결
 */
export function TaxInvoices({ projects }: { projects: Project[] }) {
  const { api, version, toast } = useApp()
  const { busy, run } = useAction()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data, loading } = useAsync(() => api.listTaxInvoices(), [version], [] as TaxInvoice[])
  const years = useMemo(() => [...new Set(data.map(x => x.write_date.slice(0, 4)))].sort().reverse(), [data])
  const [year, setYear] = useState('')
  const [dir, setDir] = useState<'매출' | '매입'>('매출')
  const [q, setQ] = useState('')
  const y = year || years[0] || String(new Date().getFullYear())
  const rows = data.filter(x => x.direction === dir && x.write_date.startsWith(y) && (!q || `${x.partner_name} ${x.item ?? ''}`.includes(q)))
  const sum = (list: TaxInvoice[]) => list.reduce((a, x) => ({ total: a.total + x.total, supply: a.supply + x.supply, vat: a.vat + x.vat, n: a.n + 1 }), { total: 0, supply: 0, vat: 0, n: 0 })
  const all = sum(rows)
  const h1 = sum(rows.filter(x => Number(x.write_date.slice(5, 7)) <= 6))
  const h2 = sum(rows.filter(x => Number(x.write_date.slice(5, 7)) > 6))
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => ({ m, ...sum(rows.filter(x => x.write_date.slice(5, 7) === m)) }))
  const maxM = Math.max(1, ...months.map(m => m.supply))
  const pName = new Map(projects.map(p => [p.id, `${p.code ? `${p.code} ` : ''}${p.name}`]))
  const won = (n: number) => n.toLocaleString('ko-KR')

  const onFile = async (f: File) => {
    const parsed = await parseHometax(f).catch(e => {
      toast(e instanceof Error ? e.message : '엑셀을 읽지 못했습니다.')
      return null
    })
    if (!parsed) return
    // 거래처(사업자번호)가 예전에 연결된 프로젝트가 있으면 그대로 이어서 연결
    const lastProj = new Map<string, string>()
    for (const x of [...data].sort((a, b) => a.write_date.localeCompare(b.write_date))) if (x.partner_biz_no && x.project_id) lastProj.set(x.partner_biz_no, x.project_id)
    const withProj = parsed.map(r => ({ ...r, project_id: (r.partner_biz_no && lastProj.get(r.partner_biz_no)) || null }))
    await run(async () => {
      const res = await api.importTaxInvoices(withProj)
      toast(`세금계산서 ${res.added}건을 넣었습니다.${res.skipped ? ` (이미 있던 ${res.skipped}건은 건너뜀)` : ''}`)
    })
  }

  return (
    <div className="col gap-10 tax-inv">
      <div className="row wrap gap-8">
        <span className="chips">
          {(['매출', '매입'] as const).map(d => (
            <Chip key={d} active={dir === d} onClick={() => setDir(d)}>
              {d} 계산서
            </Chip>
          ))}
        </span>
        <select className="select" style={{ width: 96 }} value={y} onChange={e => setYear(e.target.value)} aria-label="연도">
          {(years.length ? years : [y]).map(v => (
            <option key={v} value={v}>
              {v}년
            </option>
          ))}
        </select>
        <input className="input" style={{ width: 180 }} placeholder="거래처 · 품목 찾기" value={q} onChange={e => setQ(e.target.value)} aria-label="거래처 · 품목 찾기" />
        <span className="grow" />
        <input ref={fileRef} type="file" accept=".xls,.xlsx" hidden onChange={e => e.target.files?.[0] && void onFile(e.target.files[0]).finally(() => (e.target.value = ''))} />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileSpreadsheet size={14} /> 홈택스 엑셀 올리기
        </Button>
      </div>
      <span className="t-cap">홈택스 › 전자세금계산서 › 목록조회 에서 받은 엑셀(.xls)을 그대로 올리면 됩니다. 같은 승인번호는 한 번만 들어갑니다.</span>

      {loading && !data.length ? (
        <Loading />
      ) : (
        <>
          <div className="fin-tiles tax-tiles">
            <div className="fin-tile">
              <span className="t-cap">{y}년 {dir} 합계 · {all.n}건</span>
              <b className="fin-num">{manwon(all.total) || '0'}</b>
              <span className="t-cap">공급가 {manwon(all.supply) || '0'} · 세액 {manwon(all.vat) || '0'}</span>
            </div>
            <div className="fin-tile">
              <span className="t-cap">1기 (1~6월) 부가세</span>
              <b className="fin-num">{manwon(h1.vat) || '0'}</b>
              <span className="t-cap">공급가 {manwon(h1.supply) || '0'} · {h1.n}건</span>
            </div>
            <div className="fin-tile">
              <span className="t-cap">2기 (7~12월) 부가세</span>
              <b className="fin-num">{manwon(h2.vat) || '0'}</b>
              <span className="t-cap">공급가 {manwon(h2.supply) || '0'} · {h2.n}건</span>
            </div>
          </div>

          <div className="tax-months" aria-label="월별 공급가">
            {months.map(m => (
              <div key={m.m} className="tax-month" title={`${Number(m.m)}월 · ${m.n}건 · 공급가 ${won(m.supply)}원 · 세액 ${won(m.vat)}원`}>
                <span className="tax-bar">
                  <i style={{ height: `${Math.max(0, (m.supply / maxM) * 100)}%` }} />
                </span>
                <b>{m.supply ? manwon(m.supply) : ''}</b>
                <span className="t-cap">{Number(m.m)}월</span>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <Empty>{y}년 {dir} 세금계산서가 없습니다.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table tax-table">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>작성일</th>
                    <th>거래처 · 품목</th>
                    <th className="num">공급가</th>
                    <th className="num">세액</th>
                    <th className="num">합계</th>
                    <th style={{ width: 48 }}>구분</th>
                    <th style={{ width: 220 }}>프로젝트</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(x => (
                    <tr key={x.id} className={x.total < 0 ? 'tax-minus' : ''}>
                      <td className="mono">{shortDate(x.write_date)}</td>
                      <td>
                        <b>{x.partner_name}</b>
                        {x.total < 0 && <span className="t-cap t-red"> · 수정(취소)</span>}
                        <div className="t-cap truncate" title={x.item ?? ''}>
                          {x.item}
                        </div>
                      </td>
                      <td className="num mono">{won(x.supply)}</td>
                      <td className="num mono">{won(x.vat)}</td>
                      <td className="num mono">
                        <b>{won(x.total)}</b>
                      </td>
                      <td className="t-cap">{x.receipt_kind}</td>
                      <td>
                        <select
                          className="select tax-proj"
                          value={x.project_id ?? ''}
                          onChange={e => void run(() => api.updateTaxInvoice(x.id, { project_id: e.target.value || null }), '프로젝트를 연결했습니다.')}
                          aria-label={`${x.partner_name} 프로젝트`}
                          title={x.project_id ? pName.get(x.project_id) : '프로젝트 연결'}
                        >
                          <option value="">— 연결 안 함</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>
                              {pName.get(p.id)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>
                      <b>합계</b> <span className="t-cap">{all.n}건</span>
                    </td>
                    <td className="num mono">{won(all.supply)}</td>
                    <td className="num mono">{won(all.vat)}</td>
                    <td className="num mono">
                      <b>{won(all.total)}</b>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 홈택스 '전자(수정) 세금계산서 목록조회' 엑셀 → 행 (매출 · 매입 둘 다) */
export async function parseHometax(file: File): Promise<TaxInvoiceDraft[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, raw: false, defval: null })
  const hi = grid.findIndex(r => r.some(c => String(c ?? '').trim() === '승인번호'))
  if (hi < 0) throw new Error("홈택스 세금계산서 목록 엑셀이 아닙니다. ('승인번호' 칸을 찾지 못함)")
  const title = grid.slice(0, hi).flat().map(c => String(c ?? '')).join(' ')
  const direction: '매출' | '매입' = title.includes('매입') ? '매입' : '매출'
  const head = grid[hi].map(c => String(c ?? '').trim())
  const at = (name: string, nth = 0) => {
    let k = -1
    for (let i = 0; i <= nth; i++) k = head.indexOf(name, k + 1)
    return k
  }
  const col = {
    date: at('작성일자'), no: at('승인번호'), issued: at('발급일자'),
    supBiz: at('공급자사업자등록번호'), supName: at('상호'),
    buyBiz: at('공급받는자사업자등록번호'), buyName: at('상호', 1),
    total: at('합계금액'), supply: at('공급가액'), vat: at('세액'),
    kind: at('전자세금계산서종류'), note: at('비고'), receipt: at('영수/청구 구분'),
    supMail: at('공급자 이메일'), buyMail: at('공급받는자 이메일1'), item: at('품목명'),
  }
  const s = (r: (string | number | null)[], i: number) => (i >= 0 && r[i] != null && String(r[i]).trim() !== '' && String(r[i]).trim() !== 'nan' ? String(r[i]).trim() : null)
  const n = (r: (string | number | null)[], i: number) => Math.round(Number(String(s(r, i) ?? '0').replace(/,/g, '')) || 0)
  const out: TaxInvoiceDraft[] = []
  for (const r of grid.slice(hi + 1)) {
    const no = s(r, col.no)
    const date = s(r, col.date)
    if (!no || !date || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue
    const total = n(r, col.total)
    const our = direction === '매출' ? { biz: col.supBiz, name: col.supName } : { biz: col.buyBiz, name: col.buyName }
    const ptn = direction === '매출' ? { biz: col.buyBiz, name: col.buyName, mail: col.buyMail } : { biz: col.supBiz, name: col.supName, mail: col.supMail }
    out.push({
      approval_no: no,
      direction,
      write_date: date.slice(0, 10),
      issue_date: s(r, col.issued)?.slice(0, 10) ?? null,
      our_biz_no: s(r, our.biz),
      our_name: s(r, our.name),
      partner_biz_no: s(r, ptn.biz),
      partner_name: s(r, ptn.name) ?? '',
      partner_email: s(r, ptn.mail),
      total,
      supply: n(r, col.supply),
      vat: n(r, col.vat),
      receipt_kind: s(r, col.receipt),
      invoice_kind: total < 0 ? '수정' : s(r, col.kind),
      item: s(r, col.item),
      note: s(r, col.note),
    })
  }
  if (!out.length) throw new Error('엑셀에서 세금계산서 줄을 찾지 못했습니다.')
  return out
}
