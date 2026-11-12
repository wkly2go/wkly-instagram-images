import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, FolderPlus, RefreshCw, Upload } from 'lucide-react'
import { useApp } from '../lib/app'
import { driveApi, driveIdOf, listChildren, newFolder, FOLDER_MIME, type GFile } from '../lib/gdrive'
import { fileKind, scanDriveFolder, sheetsInZip, SHEET_RE, type ScannedFile } from '../lib/folderScan'
import { runSettlement } from '../lib/invoiceSettle'
import { attachEvidence, classify, detectKind, setStaffNames, parseBank, parseCardLike, readGrid, type Evidence, type LedgerRow } from '../lib/ledgerImport'
import { LEDGER_CATEGORIES, LEDGER_TRANSFER_CATEGORIES, type LedgerEntry, type LedgerFile, type Payment } from '../lib/types'
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

async function download(token: string, f: GFile): Promise<{ data: ArrayBuffer; name: string }> {
  const url =
    f.mimeType === SHEET_MIME
      ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`
      : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`${f.name}: 드라이브에서 받지 못했습니다 (${r.status})`)
  return { data: await r.arrayBuffer(), name: f.mimeType === SHEET_MIME ? `${f.name}.xlsx` : f.name }
}

/** 파일 읽는 법을 마지막으로 바꾼 날 — 그 전에 못 읽은 파일은 다시 시도 */
const READER_VERSION = '2026-11-12T01:00:00'

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
  // 형식을 못 알아본 파일은 읽는 법이 나아지면 다시 시도
  // (읽는 법이 바뀐 2026-11-12 이후에 다시 못 읽은 파일은 매번 다시 받지 않음)
  const failed = (d: LedgerFile) => d.kind === '알 수 없음' || (d.rows === 0 && (d.kind === '은행' || d.kind === '카드'))
  const doneKey = new Set(done.filter(d => !failed(d) || (d.processed_at ?? '') >= READER_VERSION).map(d => `${d.drive_file_id}|${d.modified_time ?? ''}`))
  // 폴더 전체(하위 폴더 끝까지) 읽기 — 대표 지시 2026-11-12
  onStep?.('폴더 전체 살펴보는 중')
  const { files } = await scanDriveFolder(token, [folder.root, folder.bank, folder.hometax])
  const fresh = files.filter(x => (x.kind === '장부 자료' || x.kind === '압축') && !doneKey.has(`${x.file.id}|${x.file.modifiedTime ?? ''}`))
  if (!fresh.length) return { files: 0, added: 0, skipped: 0, review: 0, evidence: 0, errors: [] }
  const inputs: LedgerInput[] = []
  const errors: string[] = []
  for (const x of fresh) {
    const f = x.file
    if (x.kind === '장부 자료') {
      inputs.push({ id: f.id, name: f.name, modified: f.modifiedTime ?? null, load: () => download(token, f) })
      continue
    }
    // zip: 풀어서 안의 엑셀 · CSV 를 하나씩 기입
    onStep?.(`${f.name} 압축 푸는 중`)
    try {
      const { data } = await download(token, f)
      const inner = await sheetsInZip(data)
      inner.forEach((e, i) => inputs.push({ id: `${f.id}#${i}`, name: e.name, modified: f.modifiedTime ?? null, load: async () => ({ data: e.data, name: e.name }) }))
      await api.saveLedgerFile({ drive_file_id: f.id, name: f.name, kind: '압축', modified_time: f.modifiedTime ?? null, rows: 0, added: 0, note: inner.length ? `안의 엑셀 · CSV ${inner.length}개를 따로 기입` : '안에 엑셀 · CSV 없음' })
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const r = await processLedgerFiles(api, inputs, onStep)
  return { ...r, errors: [...errors, ...r.errors] }
}

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

/** 급여 분류용 이름: 팀원 + 장부에서 이미 인건비로 분류된 상대방 */
async function loadStaff(api: ReturnType<typeof useApp>['api']) {
  const y = new Date().getFullYear()
  const [people, rows] = await Promise.all([
    api.listProfiles().catch(() => []),
    api.listLedger(`${y - 2}-01-01`, `${y}-12-31`).catch(() => [] as LedgerEntry[]),
  ])
  setStaffNames([...people.map(p => p.name), ...rows.filter(r => r.category === '인건비' && r.counterparty).map(r => r.counterparty!)])
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
  await loadStaff(api)
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
        const r = await parseCardLike(grid, hi, kind, payments, name, f.modified)
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
        note = '거래 내역(날짜 · 금액) 칸을 찾지 못했습니다 — 요약표 · 매입장 등은 건너뜁니다'
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
      const msg = n === 'NotFoundError' || n === 'NotReadableError' ? "파일을 열 수 없습니다. 폴더라면 '폴더 전체 올리기'로 올리거나, 파일이 다른 프로그램에서 열려 있으면 닫고 다시 올려 주세요." : e instanceof Error ? e.message : String(e)
      res.errors.push(`${f.name}: ${msg}`)
    }
  }
  // 통장 내역을 새로 넣었으면 예전에 올린 세금계산서도 다시 맞춰 봄 (계산서를 먼저 올리고 통장을 나중에 올린 경우 — 2026-11-12)
  if (res.added && minDate <= maxDate) {
    const d = (s: string, n: number) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10)
    const known = new Set(evidence.map(e => e.ref))
    for (const t of await api.listTaxInvoices().catch(() => []))
      if (t.write_date >= d(minDate, -45) && t.write_date <= d(maxDate, 45) && !known.has(t.approval_no) && t.total)
        evidence.push({ date: t.write_date, direction: t.direction === '매입' ? '출금' : '입금', total: Math.abs(t.total), supply: Math.abs(t.supply), vat: Math.abs(t.vat), partner: t.partner_name ?? '', kind: '세금계산서', ref: t.approval_no })
  }
  // 증빙(세금계산서 · 현금영수증)을 은행 줄에 붙이기
  if (evidence.length) {
    onStep?.('증빙 맞추는 중')
    const from = [minDate, ...evidence.map(e => e.date)].sort()[0]
    const to = [maxDate, ...evidence.map(e => e.date)].sort().reverse()[0]
    const d = (s: string, n: number) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10)
    const list = await api.listLedger(d(from, -60), d(to, 60))
    const target = list.filter(r => !r.evidence && !r.is_transfer)
    // 이미 어느 줄에 붙은 계산서는 다시 붙이지 않음 (같은 금액 · 45일 안에 증빙 붙은 줄이 있으면 붙은 것으로 봄)
    const attached = list.filter(r => r.evidence === '세금계산서')
    const fresh = evidence.filter(e => e.kind !== '세금계산서' || !attached.some(r => r.direction === e.direction && r.amount === e.total && Math.abs(Date.parse(r.entry_date) - Date.parse(e.date)) <= 45 * 864e5))
    for (const m of attachEvidence(target, fresh)) {
      const r = target[m.index]
      await api.saveLedger({ id: r.id, supply: m.ev.supply, vat: m.ev.vat, evidence: m.ev.kind } as Partial<LedgerEntry> as LedgerEntry)
      res.evidence++
    }
  }
  // 계산서 ↔ 은행 · 카드 대사 다시 (0108 · 2026-11-12 '계산서와 은행거래장부와 대조해서 장부 완성해')
  if (res.added || evidence.length) {
    onStep?.('계산서와 은행 거래 대사 중')
    await runSettlement(api).catch(() => undefined)
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
  // 폴더 전체 점검: 하위 폴더 끝까지 모든 파일과 읽었는지 여부 (대표 지시 2026-11-12)
  const [scan, setScan] = useState<{ files: ScannedFile[]; skippedFolders: string[] } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [review, setReview] = useState<LedgerEntry[]>([])
  const [reviewTotal, setReviewTotal] = useState(0)
  const [yearRows, setYearRows] = useState<LedgerEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState<ImportResult | null>(null)
  // 직접 올리기 (대표 지시 2026-11-11 "그냥 내가 자료를 인트라넷에 올릴께")
  const fileInput = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)
  const upload = async (all: File[]) => {
    // zip 은 풀어서 안의 엑셀 · CSV 까지 (대표 지시 2026-11-12 '모든 파일')
    const unzipped: File[] = []
    for (const z of all.filter(f => /\.zip$/i.test(f.name))) {
      try {
        for (const e of await sheetsInZip(await z.arrayBuffer())) unzipped.push(new File([e.data], e.name, { lastModified: z.lastModified }))
      } catch {
        /* 깨진 zip 은 건너뜀 */
      }
    }
    const list = [...all, ...unzipped].filter(f => SHEET_RE.test(f.name) && f.size > 0 && !f.name.startsWith('~$') && fileKind(f.name) === '장부 자료')
    const ignored = all.filter(f => !/\.zip$/i.test(f.name)).length + unzipped.length - list.length
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
      <input ref={fileInput} type="file" multiple hidden accept=".xls,.xlsx,.csv,.zip" onChange={e => { const fl = e.target.files ? [...e.target.files] : []; e.target.value = ''; void upload(fl) }} />
      <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={e => { const fl = e.target.files ? [...e.target.files] : []; e.target.value = ''; void upload(fl) }} />
      <Button onClick={() => folderInput.current?.click()} disabled={!!busy}>
        <FolderPlus size={14} /> {busy ?? '폴더 전체 올리기'}
      </Button>
      <Button kind="outline" onClick={() => fileInput.current?.click()} disabled={!!busy}>
        <Upload size={14} /> 파일만 골라 올리기
      </Button>
      <span className="t-cap">은행 거래내역(엑셀 · CSV) · 홈택스 세금계산서 목록 · 사업용 카드 · 현금영수증 엑셀을 여러 개 한 번에 고르거나, 폴더 전체를 올리거나, 여기로 끌어다 놓아도 됩니다(폴더 안 엑셀 · CSV 만 읽음). 같은 거래는 두 번 들어가지 않습니다.</span>
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
      const rv = all.filter(r => r.needs_review)
      setReviewTotal(rv.length)
      setReview(rv.slice(0, 80))
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
  // 새 낱말 규칙으로 '확인 필요' 줄 다시 분류 (대표 지시 2026-11-11 '기존 확인필요 줄도 새 규칙으로')
  const reclassify = async () => {
    setBusy('다시 분류하는 중')
    try {
      const y = new Date().getFullYear()
      await loadStaff(api)
      const all = (await api.listLedger('2000-01-01', `${y}-12-31`)).filter(r => r.needs_review)
      let n = 0
      for (const r of all) {
        const card = r.method === '카드'
        const desc = card ? r.counterparty ?? '' : [r.counterparty, r.memo].filter(Boolean).join(' · ')
        // 카드 취소(들어온 돈)는 같은 가게의 출금 규칙으로 알아보고 '이자 · 환급'으로
        const k = classify(desc, card && r.direction === '입금' ? '출금' : r.direction, r.amount, r.entry_date, [])
        if (k.needs_review) continue
        const category = card && r.direction === '입금' ? '이자 · 환급' : k.category
        await api.saveLedger({ id: r.id, category, needs_review: false, is_transfer: card ? false : k.is_transfer } as Partial<LedgerEntry> as LedgerEntry)
        n++
      }
      toast(`${all.length}건 중 ${n}건을 새 규칙으로 분류했습니다. 남은 ${all.length - n}건은 직접 골라 주세요.`)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '다시 분류하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const runScan = async () => {
    if (!folder) return
    setScanning(true)
    try {
      const tk = await api.driveAccessToken()
      if (!tk) throw new Error('회사 구글 드라이브 연결이 필요합니다 (관리 › 구글 드라이브).')
      setScan(await scanDriveFolder(tk.token, [folder.root, folder.bank, folder.hometax]))
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '폴더를 살펴보지 못했습니다.')
    } finally {
      setScanning(false)
    }
  }
  const fix = async (r: LedgerEntry, category: string) => {
    const transfer = LEDGER_TRANSFER_CATEGORIES.includes(category)
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
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <b>확인 필요 {reviewTotal}건</b>
          {reviewTotal > 80 && <span className="t-cap">(먼저 80건만 보입니다)</span>}
          <span className="grow" />
          {reviewTotal > 0 && (
            <Button size="sm" kind="outline" onClick={() => void reclassify()} disabled={!!busy}>
              <RefreshCw size={13} /> 새 규칙으로 다시 분류
            </Button>
          )}
        </div>
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
                      {[...LEDGER_CATEGORIES[r.direction], ...LEDGER_TRANSFER_CATEGORIES.filter(c => r.direction === '출금' || c !== '카드대금')].map(c => (
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

      {folder && (
        <div className="col gap-6">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <b>폴더 전체 점검</b>
            <span className="t-cap">하위 폴더 끝까지 모든 파일을 찾아 장부에 들어갔는지 보여 줍니다</span>
            <span className="grow" />
            <Button size="sm" kind="outline" disabled={scanning} onClick={() => void runScan()}>
              <RefreshCw size={13} className={scanning ? 'spin' : undefined} /> {scanning ? '살펴보는 중…' : scan ? '다시 점검' : '폴더 전체 점검'}
            </Button>
          </div>
          {scan && (() => {
            const doneMap = new Map(files.map(f => [f.drive_file_id, f]))
            const status = (x: ScannedFile) => {
              const d = doneMap.get(x.file.id)
              if (x.kind === '장부 자료' || x.kind === '압축') return d ? (d.kind === '알 수 없음' ? `거래 내역 아님 · ${d.note ?? ''}` : `읽음 · ${d.rows}줄`) : '아직 안 읽음'
              if (x.kind === '개인 자료') return '개인 자료라 열지 않음'
              return `${x.kind}라 장부에 넣지 않음`
            }
            const order = ['아직 안 읽음', '거래 내역 아님', 'PDF', '이미지', '문서', '압축', '프로그램', '기타', '개인 자료', '읽음']
            const rows = scan.files.map(x => ({ x, st: status(x) })).sort((a, b) => order.findIndex(o => a.st.startsWith(o)) - order.findIndex(o => b.st.startsWith(o)) || a.x.path.localeCompare(b.x.path))
            const count = (pre: string) => rows.filter(r => r.st.startsWith(pre)).length
            return (
              <>
                <span className="t-cap">
                  모든 파일 {rows.length}개 · 읽음 {count('읽음')} · 아직 안 읽음 {count('아직 안 읽음')} · 거래 내역 아님 {count('거래 내역 아님')} · PDF · 이미지 등 {rows.length - count('읽음') - count('아직 안 읽음') - count('거래 내역 아님') - count('개인 자료')} · 개인 자료 {count('개인 자료')}
                  {scan.skippedFolders.length > 0 && ` · 열지 않은 개인 자료 폴더 ${scan.skippedFolders.length}개`}
                </span>
                {count('아직 안 읽음') > 0 && (
                  <Button size="sm" onClick={() => void run()} disabled={!!busy}>
                    아직 안 읽은 {count('아직 안 읽음')}개 지금 읽기
                  </Button>
                )}
                <table className="lgf-table">
                  <tbody>
                    {rows.map(({ x, st }) => (
                      <tr key={x.file.id}>
                        <td className="truncate" title={x.path}>{x.path}</td>
                        <td>
                          <a href={x.file.webViewLink ?? `https://drive.google.com/file/d/${x.file.id}/view`} target="_blank" rel="noreferrer">
                            {x.file.name}
                          </a>
                        </td>
                        <td className={st.startsWith('아직') ? 'lgf-bad' : st.startsWith('읽음') ? 'lgf-ok' : 't-cap'}>{st}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )
          })()}
        </div>
      )}

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
