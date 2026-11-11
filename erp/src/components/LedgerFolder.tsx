import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, FolderPlus, RefreshCw, Upload } from 'lucide-react'
import { useApp } from '../lib/app'
import { driveApi, driveIdOf, listChildren, newFolder, FOLDER_MIME, type GFile } from '../lib/gdrive'
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
  if (!fresh.length) return { files: 0, added: 0, skipped: 0, review: 0, evidence: 0, errors: [] }
  return processLedgerFiles(
    api,
    fresh.map(f => ({ id: f.id, name: f.name, modified: f.modifiedTime ?? null, load: () => download(token, f) })),
    onStep,
  )
}

const SHEET_RE = /\.(xlsx|xls|csv)$/i
/** 끌어다 놓은 것에 폴더가 섞여 있으면 안의 파일까지 모두 꺼냄 (대표 2026-11-11 '자료올리기에 폴더를 넣었는데 오류') */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map(i => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null)).filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) return [...dt.files]
  const out: File[] = []
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)))
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const c of batch) await walk(c)
      }
    }
  }
  for (const e of entries) await walk(e)
  return out
}

export interface LedgerInput {
  id: string
  name: string
  modified: string | null
  load: () => Promise<{ data: ArrayBuffer; name: string }>
}
/** 파일들을 읽어 분류 · 기입 (드라이브 폴더 · 직접 올리기 공통) */
export async function processLedgerFiles(api: ReturnType<typeof useApp>['api'], inputs: LedgerInput[], onStep?: (s: string) => void): Promise<ImportResult> {
  const res: ImportResult = { files: 0, added: 0, skipped: 0, review: 0, evidence: 0, errors: [] }
  const payments: Payment[] = await api.listPayments().catch(() => [] as Payment[])
  const evidence: Evidence[] = []
  let minDate = '9999-12-31'
  let maxDate = '0000-01-01'
  for (const f of inputs) {
    onStep?.(`${f.name} 읽는 중`)
    try {
      const { data, name } = await f.load()
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
      await api.saveLedgerFile({ drive_file_id: f.id, name: f.name, kind, modified_time: f.modified, rows: rows.length, added: r.added, note: note || null })
    } catch (e) {
      const n = e instanceof DOMException ? e.name : ''
      const msg = n === 'NotFoundError' || n === 'NotReadableError' ? "파일을 열 수 없습니다. 폴더라면 '폴더째 올리기'로 올리거나, 파일이 다른 프로그램에서 열려 있으면 닫고 다시 올려 주세요." : e instanceof Error ? e.message : String(e)
      res.errors.push(`${f.name}: ${msg}`)
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
  // 직접 올리기 (대표 지시 2026-11-11 "그냥 내가 자료를 인트라넷에 올릴께")
  const fileInput = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)
  const upload = async (all: File[]) => {
    const list = all.filter(f => SHEET_RE.test(f.name) && f.size > 0 && !f.name.startsWith('~$'))
    const ignored = all.length - list.length
    if (!list.length) {
      if (all.length) toast(`엑셀(.xlsx · .xls) · CSV 파일이 없습니다${ignored ? ` (다른 파일 ${ignored}개는 건너뜀)` : ''}.`)
      return
    }
    setBusy('올린 파일 읽는 중')
    try {
      const inputs: LedgerInput[] = list.map(f => ({ id: `upload:${f.name}:${f.size}:${f.lastModified}`, name: f.name, modified: String(f.lastModified), load: async () => ({ data: await f.arrayBuffer(), name: f.name }) }))
      const r = await processLedgerFiles(api, inputs, s => setBusy(s))
      setLast(ignored ? { ...r, errors: [...r.errors, `엑셀 · CSV 가 아닌 파일 ${ignored}개는 건너뛰었습니다`] } : r)
      toast(`${r.files}개 파일 · ${r.added}건 기입${r.skipped ? ` (이미 있던 ${r.skipped}건 건너뜀)` : ''} · 증빙 ${r.evidence}건 연결${r.review ? ` · 확인 필요 ${r.review}건` : ''}`)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '읽지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const uploadBox = (
    <div
      className={`lgf-upload${over ? ' over' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); void filesFromDrop(e.dataTransfer).then(upload, () => toast('폴더를 읽지 못했습니다.')) }}
    >
      <input ref={fileInput} type="file" multiple hidden accept=".xls,.xlsx,.csv" onChange={e => { const fl = e.target.files ? [...e.target.files] : []; e.target.value = ''; void upload(fl) }} />
      <Button onClick={() => fileInput.current?.click()} disabled={!!busy}>
        <Upload size={14} /> {busy ?? '은행 · 홈택스 파일 올리기'}
      </Button>
      <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={e => { const fl = e.target.files ? [...e.target.files] : []; e.target.value = ''; void upload(fl) }} />
      <Button kind="outline" onClick={() => folderInput.current?.click()} disabled={!!busy}>
        <FolderPlus size={14} /> 폴더째 올리기
      </Button>
      <span className="t-cap">은행 거래내역(엑셀 · CSV) · 홈택스 세금계산서 목록 · 사업용 카드 · 현금영수증 엑셀을 여러 개 한 번에 고르거나, 폴더째 올리거나, 여기로 끌어다 놓아도 됩니다(폴더 안 엑셀 · CSV 만 읽음). 같은 거래는 두 번 들어가지 않습니다.</span>
    </div>
  )
  // 다른 계정의 폴더 쓰기 (대표 지시 2026-11-11 "폴더 위치를 다른 계정으로")
  const [linking, setLinking] = useState(false)
  const [link, setLink] = useState('')
  const [companyAcct, setCompanyAcct] = useState<string | null>(null)
  useEffect(() => {
    void api.driveStatus().then(s => setCompanyAcct(s?.account ?? null), () => undefined)
  }, [api])
  const useOther = async () => {
    const id = driveIdOf(link.trim()) ?? (/^[A-Za-z0-9_-]{15,}$/.test(link.trim()) ? link.trim() : null)
    if (!id) return toast('구글 드라이브 폴더 주소를 붙여 넣어 주세요.')
    setBusy('폴더 확인 중')
    try {
      const tk = await api.driveAccessToken()
      if (!tk) throw new Error('회사 구글 드라이브 연결이 필요합니다.')
      const meta = await driveApi<GFile & { capabilities?: { canAddChildren?: boolean } }>(tk.token, `files/${id}?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,capabilities(canAddChildren)`).catch(() => null)
      if (!meta) throw new Error(`이 폴더를 열 수 없습니다. 다른 계정에서 폴더를 ${companyAcct ?? '회사 드라이브 계정'}에 공유(편집자)했는지 확인해 주세요.`)
      if (meta.mimeType !== FOLDER_MIME) throw new Error('파일이 아니라 폴더 주소를 넣어 주세요.')
      // 안에 '은행' · '홈택스' 이름 폴더가 있으면 그대로 쓰고, 없으면 폴더 하나에 다 넣어도 읽음
      const subs = await listChildren(tk.token, id, { foldersOnly: true }).catch(() => [] as GFile[])
      const bank = subs.find(f => /은행/.test(f.name))?.id ?? id
      const hometax = subs.find(f => /홈택스|hometax/i.test(f.name))?.id ?? id
      const f: Folder = { root: id, bank, hometax, url: meta.webViewLink ?? `https://drive.google.com/drive/folders/${id}` }
      await api.setLedgerMeta('folder', f)
      setFolder(f)
      setLinking(false)
      setLink('')
      toast(`'${meta.name}' 폴더를 회계 자료 폴더로 정했습니다.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '폴더를 정하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const otherBox = (
    <div className="lgf-other">
      <b>다른 구글 계정의 폴더 쓰기</b>
      <ol className="t-cap">
        <li>다른 계정의 구글 드라이브에서 폴더를 만듭니다 (안에 '은행 거래내역' · '홈택스 자료' 폴더를 만들어도 되고, 한 폴더에 다 넣어도 됩니다).</li>
        <li>
          그 폴더를 <b>{companyAcct ?? '회사 드라이브 계정'}</b>에 <b>편집자</b>로 공유합니다 (폴더 › 공유 › 사용자 추가).
        </li>
        <li>폴더 주소를 아래에 붙여 넣고 '이 폴더로 정하기'를 누릅니다.</li>
      </ol>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ flex: 1 }} value={link} onChange={e => setLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
        <Button size="sm" onClick={() => void useOther()} disabled={!!busy || !link.trim()}>
          이 폴더로 정하기
        </Button>
        <Button size="sm" kind="ghost" onClick={() => setLinking(false)}>
          닫기
        </Button>
      </div>
    </div>
  )

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
  const noFolder = (
    <div className="lgf-box">
      <b>구글 드라이브 폴더 (선택)</b>
      <span className="t-cap">파일을 드라이브 폴더에 넣어 두면 장부를 열 때마다 자동으로 읽게 할 수도 있습니다. 직접 올리기만 쓰셔도 됩니다.</span>
      <div className="row" style={{ gap: 6 }}>
        <Button kind="outline" onClick={() => void create()} disabled={!!busy}>
          <FolderPlus size={14} /> 회사 드라이브에 폴더 만들기
        </Button>
        <Button kind="outline" onClick={() => setLinking(v => !v)} disabled={!!busy}>
          다른 계정 폴더 연결
        </Button>
      </div>
      {linking && otherBox}
    </div>
  )
  return (
    <div className="lgf col gap-12">
      <div className="lgf-box">
        <b>은행 · 홈택스 자료 올리기</b>
        {uploadBox}
        {last && (
          <div className="t-cap">
            방금 {last.files}개 파일 · {last.added}건 기입{last.skipped ? ` · 이미 있던 ${last.skipped}건 건너뜀` : ''} · 증빙 {last.evidence}건 연결{last.review ? ` · 확인 필요 ${last.review}건` : ''}
          </div>
        )}
        {last && last.errors.length > 0 && (
          <div className="lgf-err t-cap">
            {last.errors.map(e => (
              <div key={e}>⚠ {e}</div>
            ))}
          </div>
        )}
      </div>
      {!folder ? noFolder : (
      <div className="lgf-box">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b>회계 자료 폴더</b>
          <a className="btn btn-outline btn-sm" href={folder.url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> 폴더 열기
          </a>
          <Button size="sm" kind="outline" onClick={() => setLinking(v => !v)}>
            다른 계정 폴더 연결
          </Button>
          <span className="grow" />
          <Button size="sm" onClick={() => void run()} disabled={!!busy}>
            <RefreshCw size={13} className={busy ? 'spin' : undefined} /> {busy ? `${busy}…` : '새 자료 가져오기'}
          </Button>
        </div>
        {linking && otherBox}
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
      </div>
      )}

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
          <span className="t-cap">아직 처리한 파일이 없습니다. 위 '은행 · 홈택스 파일 올리기'로 올려 주세요.</span>
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
