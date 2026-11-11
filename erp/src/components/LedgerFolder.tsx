import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, FolderPlus, RefreshCw } from 'lucide-react'
import { useApp } from '../lib/app'
import { driveApi, listChildren, newFolder, FOLDER_MIME, type GFile } from '../lib/gdrive'
import { attachEvidence, detectKind, parseBank, parseCardLike, readGrid, type Evidence, type LedgerRow } from '../lib/ledgerImport'
import { LEDGER_CATEGORIES, type LedgerEntry, type LedgerFile, type Payment } from '../lib/types'
import { parseHometax } from './TaxInvoices'
import { Button } from './ui'

/**
 * 회계 자료 폴더 (대표 지시 2026-11-11 "은행과 홈택스 자료를 넣을 폴더 … 너가 분류하고 기입해서 자동으로")
 *  - 구글 드라이브 '회계 자료 (입출금 장부)' › '은행 거래내역' · '홈택스 자료' 에 파일을 넣으면
 *    장부를 열 때마다 새 파일만 읽어 분류해 기입 (같은 줄은 한 번만)
 */
interface Folder {
  root: string
  bank: string
  hometax: string
  url: string
}
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const isSheet = (f: GFile) => f.mimeType === SHEET_MIME || /\.(xlsx|xls|csv)$/i.test(f.name)

async function download(token: string, f: GFile): Promise<{ data: ArrayBuffer; name: string }> {
  const url =
    f.mimeType === SHEET_MIME
      ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`
      : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`${f.name}: 드라이브에서 받지 못했습니다 (${r.status})`)
  return { data: await r.arrayBuffer(), name: f.mimeType === SHEET_MIME ? `${f.name}.xlsx` : f.name }
}

export interface ImportResult {
  files: number
  added: number
  skipped: number
  review: number
  evidence: number
  errors: string[]
}

/** 새 파일만 처리 */
export async function runLedgerImport(api: ReturnType<typeof useApp>['api'], onStep?: (s: string) => void): Promise<ImportResult | null> {
  const folder = await api.ledgerMeta<Folder>('folder')
  if (!folder) return null
  const tk = await api.driveAccessToken()
  if (!tk) throw new Error('회사 구글 드라이브 연결이 필요합니다 (관리 › 구글 드라이브).')
  const token = tk.token
  const done = await api.listLedgerFiles()
  const doneKey = new Set(done.map(d => `${d.drive_file_id}|${d.modified_time ?? ''}`))
  const files: GFile[] = []
  for (const id of [folder.bank, folder.hometax, folder.root]) {
    const list = await listChildren(token, id).catch(() => [] as GFile[])
    for (const f of list) if (f.mimeType !== FOLDER_MIME && isSheet(f)) files.push(f)
    // 한 단계 아래 폴더(월별 등)도 봄
    for (const sub of list.filter(f => f.mimeType === FOLDER_MIME)) for (const f of await listChildren(token, sub.id).catch(() => [] as GFile[])) if (f.mimeType !== FOLDER_MIME && isSheet(f)) files.push(f)
  }
  const fresh = files.filter((f, i, a) => a.findIndex(x => x.id === f.id) === i && !doneKey.has(`${f.id}|${f.modifiedTime ?? ''}`))
  const res: ImportResult = { files: 0, added: 0, skipped: 0, review: 0, evidence: 0, errors: [] }
  if (!fresh.length) return res
  const payments: Payment[] = await api.listPayments().catch(() => [] as Payment[])
  const evidence: Evidence[] = []
  let minDate = '9999-12-31'
  let maxDate = '0000-01-01'
  for (const f of fresh) {
    onStep?.(`${f.name} 읽는 중`)
    try {
      const { data, name } = await download(token, f)
      const grids = await readGrid(data, name)
      const { kind, grid, hi } = detectKind(grids, name)
      let rows: LedgerRow[] = []
      let note = ''
      if (kind === '은행') rows = await parseBank(grid, hi, name, f.id, payments)
      else if (kind === '카드' || kind === '현금영수증') {
        const r = await parseCardLike(grid, hi, kind, payments)
        rows = r.rows
        evidence.push(...r.evidence)
        note = kind === '현금영수증' ? `현금영수증 ${r.evidence.length}건` : ''
      } else if (kind === '세금계산서') {
        const drafts = await parseHometax(new File([data], name))
        const t = await api.importTaxInvoices(drafts)
        note = `세금계산서 ${drafts.length}건 (새로 ${t.added})`
        for (const d of drafts)
          evidence.push({ date: d.write_date, direction: d.direction === '매입' ? '출금' : '입금', total: Math.abs(d.total), supply: Math.abs(d.supply), vat: Math.abs(d.vat), partner: d.partner_name, kind: '세금계산서', ref: d.approval_no })
      } else {
        note = '은행 · 홈택스 자료 형식을 알아보지 못했습니다'
        res.errors.push(`${f.name}: ${note}`)
      }
      for (const r of rows) {
        if (r.entry_date < minDate) minDate = r.entry_date
        if (r.entry_date > maxDate) maxDate = r.entry_date
      }
      const r = rows.length ? await api.importLedgerRows(rows.map(x => ({ ...x, file_id: f.id }) as Partial<LedgerEntry>)) : { added: 0, skipped: 0 }
      res.added += r.added
      res.skipped += r.skipped
      res.review += rows.filter(x => x.needs_review).length
      res.files++
      await api.saveLedgerFile({ drive_file_id: f.id, name: f.name, kind, modified_time: f.modifiedTime ?? null, rows: rows.length, added: r.added, note: note || null })
    } catch (e) {
      res.errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // 증빙(세금계산서 · 현금영수증)을 은행 줄에 붙이기
  if (evidence.length) {
    onStep?.('증빙 맞추는 중')
    const from = [minDate, ...evidence.map(e => e.date)].sort()[0]
    const to = [maxDate, ...evidence.map(e => e.date)].sort().reverse()[0]
    const d = (s: string, n: number) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10)
    const list = await api.listLedger(d(from, -60), d(to, 60))
    const target = list.filter(r => !r.evidence && !r.is_transfer)
    for (const m of attachEvidence(target, evidence)) {
      const r = target[m.index]
      await api.saveLedger({ id: r.id, supply: m.ev.supply, vat: m.ev.vat, evidence: m.ev.kind } as Partial<LedgerEntry> as LedgerEntry)
      res.evidence++
    }
  }
  return res
}

/** 장부를 열면 한 번 자동으로 새 파일 처리 */
export function useLedgerAutoImport(onDone: () => void) {
  const { api, toast } = useApp()
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void runLedgerImport(api)
      .then(r => {
        if (r && r.files) {
          toast(`회계 자료 ${r.files}개 파일에서 ${r.added}건을 기입했습니다${r.review ? ` · 확인 필요 ${r.review}건` : ''}.`)
          onDone()
        }
      })
      .catch(() => undefined)
  }, [api, toast, onDone])
}

export function LedgerFolder({ onExpired }: { onExpired: () => void }) {
  const { api, toast } = useApp()
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined)
  const [files, setFiles] = useState<LedgerFile[]>([])
  const [review, setReview] = useState<LedgerEntry[]>([])
  const [yearRows, setYearRows] = useState<LedgerEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState<ImportResult | null>(null)

  const load = useCallback(async () => {
    try {
      const [f, list] = await Promise.all([api.ledgerMeta<Folder>('folder'), api.listLedgerFiles()])
      setFolder(f)
      setFiles(list)
      const y = new Date().getFullYear()
      const all = await api.listLedger(`${y - 1}-01-01`, `${y}-12-31`)
      setReview(all.filter(r => r.needs_review).slice(0, 80))
      setYearRows(all)
    } catch {
      onExpired()
    }
  }, [api, onExpired])
  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    setBusy('폴더 만드는 중')
    try {
      const tk = await api.driveAccessToken()
      if (!tk) throw new Error('회사 구글 드라이브 연결이 필요합니다 (관리 › 구글 드라이브).')
      const root = await newFolder(tk.token, '회계 자료 (입출금 장부)', 'root')
      const bank = await newFolder(tk.token, '은행 거래내역', root.id)
      const hometax = await newFolder(tk.token, '홈택스 자료', root.id)
      const meta = await driveApi<GFile>(tk.token, `files/${root.id}?supportsAllDrives=true&fields=webViewLink`)
      const f: Folder = { root: root.id, bank: bank.id, hometax: hometax.id, url: meta.webViewLink ?? `https://drive.google.com/drive/folders/${root.id}` }
      await api.setLedgerMeta('folder', f)
      setFolder(f)
      toast('구글 드라이브에 회계 자료 폴더를 만들었습니다.')
    } catch (e) {
      toast(e instanceof Error ? e.message : '폴더를 만들지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const run = async () => {
    setBusy('새 자료 확인 중')
    try {
      const r = await runLedgerImport(api, s => setBusy(s))
      setLast(r)
      if (r) toast(r.files ? `${r.files}개 파일 · ${r.added}건 기입 · 증빙 ${r.evidence}건 연결${r.review ? ` · 확인 필요 ${r.review}건` : ''}` : '새 파일이 없습니다.')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '가져오지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const fix = async (r: LedgerEntry, category: string) => {
    const transfer = category === '카드대금' || category === '내 통장 이체'
    await api.saveLedger({ id: r.id, category, needs_review: false, is_transfer: transfer } as Partial<LedgerEntry> as LedgerEntry).then(load, () => toast('저장하지 못했습니다.'))
  }

  if (folder === undefined) return <span className="t-cap">불러오는 중…</span>
  if (!folder)
    return (
      <div className="lgf-empty">
        <b>회계 자료 폴더가 아직 없습니다</b>
        <span className="t-cap">구글 드라이브에 '회계 자료 (입출금 장부)' 폴더와 그 안에 '은행 거래내역' · '홈택스 자료' 폴더를 만듭니다. 여기에 파일을 넣으면 장부를 열 때마다 자동으로 분류해 기입합니다.</span>
        <Button onClick={() => void create()} disabled={!!busy}>
          <FolderPlus size={14} /> 회계 자료 폴더 만들기
        </Button>
      </div>
    )
  return (
    <div className="lgf col gap-12">
      <div className="lgf-box">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b>구글 드라이브 › 회계 자료 (입출금 장부)</b>
          <a className="btn btn-outline btn-sm" href={folder.url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> 폴더 열기
          </a>
          <span className="grow" />
          <Button size="sm" onClick={() => void run()} disabled={!!busy}>
            <RefreshCw size={13} className={busy ? 'spin' : undefined} /> {busy ? `${busy}…` : '새 자료 가져오기'}
          </Button>
        </div>
        <ul className="lgf-guide t-cap">
          <li>
            <b>은행 거래내역</b> 폴더: 인터넷뱅킹 › 거래내역 조회 › 엑셀(또는 CSV) 저장 파일. 통장마다 파일을 따로 넣어도 됩니다.
          </li>
          <li>
            <b>홈택스 자료</b> 폴더: 전자세금계산서 목록(매출 · 매입) · 사업용 신용카드 사용내역 · 현금영수증 매입 내역 엑셀.
          </li>
          <li>장부를 열 때마다 새로 넣은(또는 바뀐) 파일만 읽습니다. 같은 거래는 두 번 들어가지 않습니다.</li>
          <li>은행 · 카드 자료가 기준입니다. 결제 대장과 금액 · 날짜가 맞으면 그 분류 · 거래처 이름만 참고하고(프로젝트와는 연결하지 않음), 아니면 낱말로 분류합니다. 카드대금 · 내 통장끼리 이체는 합계에서 뺍니다.</li>
        </ul>
        {last && last.errors.length > 0 && (
          <div className="lgf-err t-cap">
            {last.errors.map(e => (
              <div key={e}>⚠ {e}</div>
            ))}
          </div>
        )}
      </div>

      {/* 통장별 잔고 대조 (2026-11-11): 은행 파일의 '거래 후 잔액'과 기입된 입출금 합계가 맞는지 → 다르면 빠진 거래가 있음 */}
      {(() => {
        const accs = [...new Set(yearRows.filter(r => r.source === '은행' && r.account).map(r => r.account!))]
        if (!accs.length) return null
        const eff = (r: LedgerEntry) => (r.direction === '입금' ? r.amount : -r.amount)
        const rowsOut = accs.map(acc => {
          const list = yearRows.filter(r => r.account === acc && r.source === '은행')
          const withBal = list.filter(r => r.balance_after != null)
          if (!withBal.length) return { acc, ok: null as boolean | null, last: null as number | null, diff: 0, n: list.length, lastDate: '' }
          const firstDate = withBal.reduce((m, r) => (r.entry_date < m ? r.entry_date : m), withBal[0].entry_date)
          const lastDate = withBal.reduce((m, r) => (r.entry_date > m ? r.entry_date : m), withBal[0].entry_date)
          const total = list.reduce((n, r) => n + eff(r), 0)
          const opens = withBal.filter(r => r.entry_date === firstDate).map(r => r.balance_after! - eff(r))
          const lasts = withBal.filter(r => r.entry_date === lastDate).map(r => r.balance_after!)
          const ok = opens.some(o => lasts.includes(o + total))
          const last = Math.max(...lasts)
          return { acc, ok, last, diff: ok ? 0 : last - (opens[0] + total), n: list.length, lastDate }
        })
        return (
          <div className="col gap-6">
            <b>통장별 잔고 대조</b>
            <table className="lgf-table">
              <tbody>
                {rowsOut.map(r => (
                  <tr key={r.acc}>
                    <td>{r.acc}</td>
                    <td className="t-cap">{r.n}건{r.lastDate ? ` · ${r.lastDate.slice(5).replace('-', '.')} 기준` : ''}</td>
                    <td className="mono">{r.last != null ? `잔액 ${r.last.toLocaleString('ko-KR')}` : '잔액 칸 없음'}</td>
                    <td>{r.ok == null ? <span className="t-cap">대조 불가</span> : r.ok ? <span className="lgf-ok">✓ 맞음</span> : <span className="lgf-bad" title="은행 잔액과 기입된 합계가 다릅니다. 빠진 기간의 거래내역 파일을 넣어 주세요">차이 {r.diff.toLocaleString('ko-KR')}원 · 빠진 거래 확인</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}

      <div className="col gap-6">
        <b>확인 필요 {review.length}건</b>
        {review.length === 0 ? (
          <span className="t-cap">자동 분류하지 못한 거래가 없습니다.</span>
        ) : (
          <table className="lgf-table">
            <tbody>
              {review.map(r => (
                <tr key={r.id}>
                  <td className="mono">{r.entry_date.slice(2).replace(/-/g, '.')}</td>
                  <td className={r.direction === '입금' ? 'in' : 'out'}>
                    {r.direction === '입금' ? '+' : '−'}
                    {r.amount.toLocaleString('ko-KR')}
                  </td>
                  <td className="truncate" title={r.memo ?? ''}>
                    {r.counterparty ?? ''} <span className="t-cap">{r.account ?? ''}</span>
                  </td>
                  <td>
                    <select className="select" value="" onChange={e => e.target.value && void fix(r, e.target.value)} aria-label="분류 고르기">
                      <option value="">분류 고르기…</option>
                      {[...LEDGER_CATEGORIES[r.direction], ...(r.direction === '출금' ? ['카드대금', '내 통장 이체', '수수료', '통신비', '이자 · 금융비용'] : ['내 통장 이체'])].map(c => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="col gap-6">
        <b>처리한 파일 {files.length}개</b>
        {files.length === 0 ? (
          <span className="t-cap">아직 처리한 파일이 없습니다. 폴더에 파일을 넣고 '새 자료 가져오기'를 누르세요.</span>
        ) : (
          <table className="lgf-table">
            <tbody>
              {files.map(f => (
                <tr key={f.drive_file_id}>
                  <td className="truncate">{f.name}</td>
                  <td>{f.kind}</td>
                  <td className="t-cap">
                    {f.rows}줄 · 새로 {f.added}건{f.note ? ` · ${f.note}` : ''}
                  </td>
                  <td className="t-cap mono">{f.processed_at.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
