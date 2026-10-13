// 의존성 없는 .xlsx 읽기 (브라우저 · Node 22 공통)
// - ZIP: End-Of-Central-Directory → 중앙 디렉터리 (stored · deflate, ZIP64 포함)
// - 압축 풀기: DecompressionStream('deflate-raw')
// - XML: 작은 토크나이저 (DOMParser 없음)
// - 값: 저장된 계산 결과만 사용 (수식은 무시), 날짜 서식 셀은 'YYYY-MM-DD' 문자열

export type Cell = string | number | boolean | null
/** rows[0] = 엑셀 1행, rows[r][0] = A열. 행 길이는 제각각 (마지막 값까지) */
export interface XlsxSheet {
  name: string
  rows: Cell[][]
}
export interface XlsxBook {
  sheets: XlsxSheet[]
}

const MAX_FILE_BYTES = 20 * 1024 * 1024
/** 압축을 푼 파트 하나의 최대 크기 (압축 폭탄 방지) */
const MAX_PART_BYTES = 256 * 1024 * 1024
const MAX_ROWS = 200_000
const MAX_COLS = 4_000

export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<XlsxBook> {
  const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data)
  if (bytes.byteLength > MAX_FILE_BYTES) {
    const mb = Math.ceil((bytes.byteLength / 1024 / 1024) * 10) / 10
    throw new Error(`파일이 너무 큽니다 (${mb}MB). 20MB 이하의 .xlsx 파일만 읽을 수 있습니다.`)
  }
  const zip = openZip(bytes)

  const rootRels = zip.has('_rels/.rels') ? parseRels(await zip.text('_rels/.rels')) : new Map<string, Rel>()
  const officeDoc = [...rootRels.values()].find(r => r.type.endsWith('/officeDocument'))
  let wbPath = officeDoc ? resolvePath('', officeDoc.target) : 'xl/workbook.xml'
  if (!zip.has(wbPath)) wbPath = 'xl/workbook.xml'
  if (!zip.has(wbPath)) throw new Error('엑셀 통합 문서(workbook.xml)를 찾지 못했습니다. .xlsx 파일인지 확인해 주세요.')

  const wbDir = wbPath.slice(0, wbPath.lastIndexOf('/') + 1)
  const wbRelsPath = `${wbDir}_rels/${wbPath.slice(wbDir.length)}.rels`
  const [wbXml, wbRelsXml] = await Promise.all([zip.text(wbPath), zip.has(wbRelsPath) ? zip.text(wbRelsPath) : Promise.resolve('')])
  const wb = parseWorkbook(wbXml)
  const rels = parseRels(wbRelsXml)

  const partPath = (typeSuffix: string, fallback: string): string | null => {
    const rel = [...rels.values()].find(r => r.type.endsWith(typeSuffix))
    const path = rel ? resolvePath(wbDir, rel.target) : wbDir + fallback
    return zip.has(path) ? path : zip.has(wbDir + fallback) ? wbDir + fallback : null
  }
  const sstPath = partPath('/sharedStrings', 'sharedStrings.xml')
  const stylesPath = partPath('/styles', 'styles.xml')
  const [sst, dateStyles] = await Promise.all([
    sstPath ? zip.text(sstPath).then(parseSharedStrings) : Promise.resolve<string[]>([]),
    stylesPath ? zip.text(stylesPath).then(parseDateStyles) : Promise.resolve(new Set<number>()),
  ])

  const sheets = await Promise.all(
    wb.sheets.map(async (s): Promise<XlsxSheet> => {
      const rel = rels.get(s.rid)
      if (!rel || rel.type.endsWith('/chartsheet')) return { name: s.name, rows: [] }
      const path = resolvePath(wbDir, rel.target)
      if (!zip.has(path)) return { name: s.name, rows: [] }
      return { name: s.name, rows: parseSheetXml(await zip.text(path), sst, dateStyles, wb.date1904) }
    }),
  )
  return { sheets }
}

/** 0 → 'A', 25 → 'Z', 26 → 'AA' */
export function colLetter(index0: number): string {
  let n = Math.floor(index0) + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 'A' → 0, 'AA' → 26 (잘못된 값이면 -1) */
function colIndex(letters: string): number {
  let n = 0
  for (let i = 0; i < letters.length; i++) {
    const c = letters.charCodeAt(i) | 0x20 // 소문자로
    if (c < 97 || c > 122) return -1
    n = n * 26 + (c - 96)
  }
  return n - 1
}

const DAY_MS = 86_400_000
const BASE_1900 = Date.UTC(1899, 11, 30)
/** 9999-12-31 의 일련번호 + 1 */
const MAX_SERIAL = 2_958_466

/** 엑셀 날짜 일련번호 → 'YYYY-MM-DD' (1900 체계, 기준 1899-12-30). 범위를 벗어나면 '' */
export function excelSerialToDate(serial: number): string {
  if (!Number.isFinite(serial) || serial < 0 || serial >= MAX_SERIAL) return ''
  // 엑셀의 1900-02-29(일련번호 60) 버그: 60 미만은 하루 앞당겨진 기준을 쓴다
  const base = serial < 60 ? BASE_1900 + DAY_MS : BASE_1900
  const ms = Math.round(serial * 86_400) * 1000 // 초 단위 반올림 (부동소수 오차)
  return new Date(base + ms).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// ZIP

interface ZipEntry {
  method: number
  flags: number
  compSize: number
  size: number
  localOffset: number
}

interface Zip {
  has(path: string): boolean
  text(path: string): Promise<string>
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_EOCD64_LOC = 0x07064b50

function openZip(b: Uint8Array): Zip {
  const len = b.byteLength
  const dv = new DataView(b.buffer, b.byteOffset, len)
  const u64 = (o: number) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 0x1_0000_0000

  if (len >= 8 && dv.getUint32(0, false) === 0xd0cf11e0) {
    throw new Error('이전 형식(.xls) 또는 암호가 걸린 엑셀 파일은 읽을 수 없습니다. 엑셀에서 암호를 풀고 .xlsx 로 저장해 주세요.')
  }
  let eocd = -1
  for (let i = len - 22; i >= 0 && i >= len - 22 - 0xffff; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('.xlsx 파일이 아닙니다 (ZIP 구조를 찾지 못했습니다).')

  let cdSize = dv.getUint32(eocd + 12, true)
  let cdOffset = dv.getUint32(eocd + 16, true)
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || dv.getUint16(eocd + 10, true) === 0xffff) {
    const loc = eocd - 20
    if (loc >= 0 && dv.getUint32(loc, true) === SIG_EOCD64_LOC) {
      const z64 = u64(loc + 8)
      if (z64 + 56 <= len && dv.getUint32(z64, true) === SIG_EOCD64) {
        cdSize = u64(z64 + 40)
        cdOffset = u64(z64 + 48)
      }
    }
  }
  // 앞에 다른 데이터가 붙은 ZIP: 중앙 디렉터리 위치로 차이를 보정
  let shift = 0
  const sigAt = (o: number) => (o >= 0 && o + 4 <= len ? dv.getUint32(o, true) : 0)
  if (sigAt(cdOffset) !== SIG_CENTRAL && sigAt(eocd - cdSize) === SIG_CENTRAL) {
    shift = eocd - cdSize - cdOffset
    cdOffset = eocd - cdSize
  }

  const utf8 = new TextDecoder('utf-8')
  const entries = new Map<string, ZipEntry>()
  const lower = new Map<string, string>()
  let p = cdOffset
  while (p + 46 <= len && dv.getUint32(p, true) === SIG_CENTRAL) {
    const flags = dv.getUint16(p + 8, true)
    const method = dv.getUint16(p + 10, true)
    let compSize = dv.getUint32(p + 20, true)
    let size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    let localOffset = dv.getUint32(p + 42, true)
    const nameStart = p + 46
    if (nameStart + nameLen > len) break
    const name = utf8.decode(b.subarray(nameStart, nameStart + nameLen)).replace(/\\/g, '/').replace(/^\/+/, '')
    if (size === 0xffffffff || compSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = nameStart + nameLen
      const eEnd = Math.min(e + extraLen, len)
      while (e + 4 <= eEnd) {
        const id = dv.getUint16(e, true)
        const sz = dv.getUint16(e + 2, true)
        if (id === 0x0001) {
          // ZIP64 확장 필드: 0xffffffff 로 표시된 값만 이 순서로 들어 있다
          let q = e + 4
          if (size === 0xffffffff && q + 8 <= eEnd) {
            size = u64(q)
            q += 8
          }
          if (compSize === 0xffffffff && q + 8 <= eEnd) {
            compSize = u64(q)
            q += 8
          }
          if (localOffset === 0xffffffff && q + 8 <= eEnd) localOffset = u64(q)
          break
        }
        e += 4 + sz
      }
    }
    if (!name.endsWith('/')) {
      entries.set(name, { method, flags, compSize, size, localOffset: localOffset + shift })
      lower.set(name.toLowerCase(), name)
    }
    p = nameStart + nameLen + extraLen + commentLen
  }
  if (!entries.size) throw new Error('.xlsx 파일이 아닙니다 (ZIP 목록이 비어 있습니다).')

  const find = (path: string) => entries.get(path) ?? entries.get(lower.get(path.toLowerCase()) ?? '')

  return {
    has: path => !!find(path),
    async text(path) {
      const e = find(path)
      if (!e) throw new Error(`파일 안에서 ${path} 를 찾지 못했습니다.`)
      return decodeText(await readEntry(b, dv, e, path))
    },
  }
}

async function readEntry(b: Uint8Array, dv: DataView, e: ZipEntry, path: string): Promise<Uint8Array> {
  if (e.flags & 1) throw new Error('암호가 걸린 파일은 읽을 수 없습니다. 엑셀에서 암호를 풀고 다시 저장해 주세요.')
  if (e.size > MAX_PART_BYTES) throw new Error(`압축을 푼 크기가 너무 큽니다 (${path}).`)
  const lh = e.localOffset
  if (lh < 0 || lh + 30 > b.byteLength || dv.getUint32(lh, true) !== SIG_LOCAL) throw new Error(`ZIP 구조가 손상되었습니다 (${path}).`)
  const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true)
  const end = start + e.compSize
  if (end > b.byteLength) throw new Error(`ZIP 구조가 손상되었습니다 (${path}).`)
  if (e.method === 0) return b.subarray(start, end)
  if (e.method !== 8) throw new Error(`지원하지 않는 압축 방식입니다 (${path}, method ${e.method}).`)
  try {
    return await inflateRaw(b.subarray(start, end))
  } catch {
    throw new Error(`압축을 풀지 못했습니다 (${path}). 파일이 손상되었을 수 있습니다.`)
  }
}

async function inflateRaw(src: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제를 지원하지 않습니다.')
  const input = new Uint8Array(src.byteLength) // ArrayBuffer 기반 사본 (Blob 입력용)
  input.set(src)
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function decodeText(u: Uint8Array): string {
  if (u.length >= 2 && u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u.subarray(2))
  if (u.length >= 2 && u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(u.subarray(2))
  return new TextDecoder('utf-8').decode(u) // UTF-8 BOM 은 TextDecoder 가 제거
}

/** base: 'xl/' 처럼 끝이 '/' 인 폴더. target 이 '/' 로 시작하면 패키지 루트 기준 */
function resolvePath(base: string, target: string): string {
  let t = target
  try {
    t = decodeURI(target)
  } catch {
    /* 그대로 사용 */
  }
  const full = t.startsWith('/') ? t.slice(1) : base + t
  const out: string[] = []
  for (const seg of full.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

// ---------------------------------------------------------------------------
// XML 토크나이저

interface XmlHandler {
  open?(name: string, attrs: string): void
  /** 자기 닫힘 태그(<a/>)도 open 다음에 close 가 불린다 */
  close?(name: string): void
  text?(text: string): void
  /** false 이면 text 를 부르지 않는다 (속도) */
  wantText?: boolean
}

const localName = (q: string) => q.slice(q.indexOf(':') + 1)

function scanXml(xml: string, h: XmlHandler): void {
  const n = xml.length
  let i = 0
  while (i < n) {
    const lt = xml.indexOf('<', i)
    const textEnd = lt < 0 ? n : lt
    if (textEnd > i && h.wantText && h.text) h.text(decodeXml(xml.slice(i, textEnd)))
    if (lt < 0) break
    const c1 = xml.charCodeAt(lt + 1)
    if (c1 === 33 /* ! */) {
      if (xml.startsWith('<!--', lt)) {
        const e = xml.indexOf('-->', lt + 4)
        i = e < 0 ? n : e + 3
      } else if (xml.startsWith('<![CDATA[', lt)) {
        const e = xml.indexOf(']]>', lt + 9)
        if (h.wantText && h.text) h.text(xml.slice(lt + 9, e < 0 ? n : e))
        i = e < 0 ? n : e + 3
      } else {
        const e = xml.indexOf('>', lt + 2)
        i = e < 0 ? n : e + 1
      }
      continue
    }
    if (c1 === 63 /* ? */) {
      const e = xml.indexOf('?>', lt + 2)
      i = e < 0 ? n : e + 2
      continue
    }
    // 태그 끝 '>' 찾기 (따옴표 안의 '>' 는 건너뜀)
    let j = lt + 1
    let quote = 0
    for (; j < n; j++) {
      const c = xml.charCodeAt(j)
      if (quote) {
        if (c === quote) quote = 0
      } else if (c === 34 || c === 39) quote = c
      else if (c === 62) break
    }
    i = j + 1
    if (c1 === 47 /* / */) {
      h.close?.(localName(xml.slice(lt + 2, j).trim()))
      continue
    }
    const self = xml.charCodeAt(j - 1) === 47
    const bodyEnd = self ? j - 1 : j
    let k = lt + 1
    while (k < bodyEnd) {
      const c = xml.charCodeAt(k)
      if (c === 32 || c === 9 || c === 10 || c === 13) break
      k++
    }
    const name = localName(xml.slice(lt + 1, k))
    h.open?.(name, xml.slice(k, bodyEnd))
    if (self) h.close?.(name)
  }
}

const ATTR_RE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** 속성 → { 로컬 이름: 값 } (xmlns 선언은 제외, 'r:id' 는 'id') */
function getAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!s) return out
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(s))) {
    const q = m[1]
    if (q === 'xmlns' || q.startsWith('xmlns:')) continue
    out[localName(q)] = decodeXml(m[2] ?? m[3] ?? '')
  }
  return out
}

const ENT_RE = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g
const NAMED_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(ENT_RE, (m, hex, dec, name) => {
    if (name) return NAMED_ENT[name as string]
    const cp = hex ? parseInt(hex as string, 16) : parseInt(dec as string, 10)
    return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : m
  })
}

/** 엑셀의 _xHHHH_ 이스케이프 풀기, 줄바꿈은 \n 으로 */
function cleanString(s: string): string {
  let t = s
  if (t.indexOf('_x') >= 0) t = t.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h) => String.fromCharCode(parseInt(h as string, 16)))
  if (t.indexOf('\r') >= 0) t = t.replace(/\r\n?/g, '\n')
  return t
}

// ---------------------------------------------------------------------------
// 파트별 파서

interface Rel {
  type: string
  target: string
}

function parseRels(xml: string): Map<string, Rel> {
  const out = new Map<string, Rel>()
  if (!xml) return out
  scanXml(xml, {
    open(name, attrs) {
      if (name !== 'Relationship') return
      const a = getAttrs(attrs)
      if (a.Id && a.Target && a.TargetMode !== 'External') out.set(a.Id, { type: a.Type ?? '', target: a.Target })
    },
  })
  return out
}

function parseWorkbook(xml: string): { sheets: { name: string; rid: string }[]; date1904: boolean } {
  const sheets: { name: string; rid: string }[] = []
  let date1904 = false
  scanXml(xml, {
    open(name, attrs) {
      if (name === 'sheet') {
        const a = getAttrs(attrs)
        sheets.push({ name: a.name ?? `Sheet${sheets.length + 1}`, rid: a.id ?? '' })
      } else if (name === 'workbookPr') {
        const v = getAttrs(attrs).date1904
        date1904 = v === '1' || v === 'true'
      }
    },
  })
  return { sheets, date1904 }
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  let inSi = false
  let phonetic = 0
  let buf = ''
  const h: XmlHandler = {
    wantText: false,
    open(name) {
      if (name === 'si') {
        inSi = true
        buf = ''
      } else if (name === 'rPh') phonetic++
      else if (name === 't') h.wantText = inSi && phonetic === 0
    },
    close(name) {
      if (name === 'si') {
        out.push(cleanString(buf))
        inSi = false
      } else if (name === 'rPh') phonetic--
      else if (name === 't') h.wantText = false
    },
    text(t) {
      buf += t
    },
  }
  scanXml(xml, h)
  return out
}

// 기본 제공 날짜·시간 서식 번호
const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

/** 사용자 서식 코드가 날짜·시간인지: 따옴표·이스케이프·[..] 를 빼고 d/m/y/h 가 남는지 */
function isDateFormatCode(code: string): boolean {
  const s = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/\[[^\]]*\]/g, '')
  if (/^\s*(general|@)?\s*$/i.test(s)) return false
  if (/^[\s0#?.,%+\-()/:;Ee@]*$/.test(s)) return false // 순수 숫자 서식
  return /[dmyh]/i.test(s)
}

/** cellXfs 순번 중 날짜 서식인 것 */
function parseDateStyles(xml: string): Set<number> {
  const custom = new Map<number, string>()
  const xfFmt: number[] = []
  let inCellXfs = false
  scanXml(xml, {
    open(name, attrs) {
      if (name === 'numFmt') {
        const a = getAttrs(attrs)
        const id = parseInt(a.numFmtId ?? '', 10)
        if (Number.isFinite(id)) custom.set(id, a.formatCode ?? '')
      } else if (name === 'cellXfs') inCellXfs = true
      else if (name === 'xf' && inCellXfs) xfFmt.push(parseInt(getAttrs(attrs).numFmtId ?? '0', 10) || 0)
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false
    },
  })
  const out = new Set<number>()
  xfFmt.forEach((id, i) => {
    const code = custom.get(id)
    if (code !== undefined ? isDateFormatCode(code) : BUILTIN_DATE_FMTS.has(id)) out.add(i)
  })
  return out
}

function parseSheetXml(xml: string, sst: string[], dateStyles: Set<number>, date1904: boolean): Cell[][] {
  const rows: Cell[][] = []
  let inData = false
  let r = -1 // 현재 행 (0부터)
  let c = -1 // 직전 셀 열
  let cellR = -1
  let cellC = -1
  let type = 'n'
  let style = 0
  let v = ''
  let hasV = false
  let inIs = false
  let hasIs = false
  let isText = ''
  let phonetic = 0
  let target: 'v' | 't' | null = null

  const store = (val: Cell) => {
    if (val === null || val === '' || cellR < 0 || cellC < 0 || cellR >= MAX_ROWS || cellC >= MAX_COLS) return
    const row = rows[cellR] ?? (rows[cellR] = [])
    while (row.length < cellC) row.push(null)
    row[cellC] = val
  }

  const h: XmlHandler = {
    wantText: false,
    open(name, attrs) {
      if (name === 'sheetData') inData = true
      if (!inData) return
      switch (name) {
        case 'row': {
          const n = parseInt(getAttrs(attrs).r ?? '', 10)
          r = Number.isFinite(n) && n > 0 ? n - 1 : r + 1
          c = -1
          break
        }
        case 'c': {
          const a = getAttrs(attrs)
          const m = a.r ? /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a.r) : null
          if (m) {
            cellC = colIndex(m[1])
            cellR = parseInt(m[2], 10) - 1
          } else {
            cellC = c + 1
            cellR = r
          }
          c = cellC
          type = a.t ?? 'n'
          style = parseInt(a.s ?? '0', 10) || 0
          v = ''
          hasV = false
          hasIs = false
          isText = ''
          break
        }
        case 'v':
          target = 'v'
          hasV = true
          h.wantText = true
          break
        case 'is':
          inIs = true
          hasIs = true
          break
        case 'rPh':
          phonetic++
          break
        case 't':
          if (inIs && phonetic === 0) {
            target = 't'
            h.wantText = true
          }
          break
      }
    },
    close(name) {
      if (name === 'sheetData') inData = false
      if (!inData) return
      switch (name) {
        case 'v':
        case 't':
          target = null
          h.wantText = false
          break
        case 'is':
          inIs = false
          break
        case 'rPh':
          phonetic--
          break
        case 'c':
          store(cellValue())
          break
      }
    },
    text(t) {
      if (target === 'v') v += t
      else if (target === 't') isText += t
    },
  }

  const cellValue = (): Cell => {
    switch (type) {
      case 's': {
        const i = parseInt(v, 10)
        return hasV && i >= 0 && i < sst.length ? sst[i] : null
      }
      case 'inlineStr':
        return cleanString(hasIs ? isText : v)
      case 'str':
        return cleanString(v)
      case 'b': {
        if (!hasV || !v.trim()) return null
        const t = v.trim().toLowerCase()
        return t === '1' || t === 'true'
      }
      case 'e':
        return v.trim() || null
      case 'd': {
        const m = /^\d{4}-\d{2}-\d{2}/.exec(v.trim())
        return m ? m[0] : v.trim() || null
      }
      default: {
        const t = v.trim()
        if (!hasV || !t) return hasIs ? cleanString(isText) : null
        const n = Number(t)
        if (!Number.isFinite(n)) return t
        if (dateStyles.has(style)) {
          const d = excelSerialToDate(date1904 ? n + 1462 : n)
          if (d) return d
        }
        return n
      }
    }
  }

  scanXml(xml, h)
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
  return rows
}
