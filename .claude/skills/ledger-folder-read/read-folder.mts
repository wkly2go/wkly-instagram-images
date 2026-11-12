/**
 * 회계 자료 폴더 통째로 읽기 (로컬에 받아 둔 폴더용)
 *   npx --prefix erp tsx .claude/skills/ledger-folder-read/read-folder.mts <폴더> [--json 결과.json]
 * - 하위 폴더 끝까지 모든 파일을 찾고, zip 은 풀어서 안의 엑셀 · CSV 까지 읽음
 * - 인트라넷과 같은 읽는 법(erp/src/lib/ledgerImport.ts)으로 은행 · 카드 · 세금계산서를 알아보고 줄 수 · 기간 · 합계를 보여 줌
 * - 장부에 넣지는 않음 (넣는 것은 인트라넷 '회계 자료' 탭 또는 SKILL.md 의 SQL 절차)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { unzipSync } from '../../../erp/node_modules/fflate/esm/index.mjs'
import { detectKind, parseBank, parseCardLike, readGrid } from '../../../erp/src/lib/ledgerImport.ts'
import { fileKind, PRIVATE_RE, SHEET_RE } from '../../../erp/src/lib/folderScan.ts'

const root = process.argv[2]
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
if (!root) throw new Error('폴더를 알려 주세요')

type Item = { path: string; name: string; kind: string; status: string; rows?: number; from?: string; to?: string; out?: number; in?: number; account?: string }
const items: Item[] = []
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

async function readSheet(path: string, name: string, data: ArrayBuffer, modified: string) {
  try {
    const grids = await readGrid(data, name)
    const { kind, grid, hi } = detectKind(grids, name)
    const rows = kind === '은행' ? await parseBank(grid, hi, name, 'local', []) : kind === '카드' || kind === '현금영수증' ? (await parseCardLike(grid, hi, kind, [], name, modified)).rows : []
    const dates = rows.map(r => r.entry_date).sort()
    items.push({ path, name, kind, status: kind === '알 수 없음' ? '거래 내역 아님' : kind === '세금계산서' ? '세금계산서 (인트라넷에서 대장으로)' : '읽음', rows: rows.length, from: dates[0], to: dates.at(-1), out: rows.filter(r => r.direction === '출금').reduce((n, r) => n + r.amount, 0), in: rows.filter(r => r.direction === '입금').reduce((n, r) => n + r.amount, 0), account: rows[0]?.account ?? undefined })
  } catch (e) {
    items.push({ path, name, kind: '오류', status: String(e instanceof Error ? e.message : e) })
  }
}

async function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = relative(root, dir) || '(맨 위)'
    const st = statSync(full)
    if (st.isDirectory()) {
      if (PRIVATE_RE.test(name)) items.push({ path: rel, name: name + '/', kind: '개인 자료', status: '열지 않음' })
      else await walk(full)
      continue
    }
    const k = fileKind(name)
    if (k === '장부 자료') await readSheet(rel, name, ab(readFileSync(full)), st.mtime.toISOString())
    else if (k === '압축') {
      const entries = unzipSync(new Uint8Array(readFileSync(full)), { filter: f => SHEET_RE.test(f.name) && !PRIVATE_RE.test(f.name) })
      if (!Object.keys(entries).length) items.push({ path: rel, name, kind: '압축', status: '안에 엑셀 · CSV 없음' })
      for (const [inner, bytes] of Object.entries(entries)) await readSheet(`${rel} › ${name}`, inner.split('/').pop() || inner, ab(bytes), st.mtime.toISOString())
    } else items.push({ path: rel, name, kind: k, status: k === '개인 자료' ? '열지 않음' : '장부에 넣지 않음' })
  }
}

await walk(root)
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))
for (const it of items) console.log(pad(it.path, 28), pad(it.name, 34), pad(it.kind, 8), pad(it.status, 16), it.rows != null ? `${it.rows}줄 ${it.from ?? ''}~${it.to ?? ''} 출금 ${it.out?.toLocaleString()} 입금 ${it.in?.toLocaleString()} ${it.account ?? ''}` : '')
const c = (s: string) => items.filter(i => i.status.startsWith(s)).length
console.log(`\n모든 파일 ${items.length} · 읽음 ${c('읽음')} · 세금계산서 ${c('세금계산서')} · 거래 내역 아님 ${c('거래 내역 아님')} · 넣지 않음 ${c('장부에 넣지 않음')} · 개인 자료 ${c('열지 않음')} · 오류 ${c('오류') + items.filter(i => i.kind === '오류').length}`)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(items, null, 2))
