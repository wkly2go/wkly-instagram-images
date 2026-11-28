// PPT(.pptx) → 화이트보드 (2026-11-28 대표 지시 'pptx를 불러 올 수 있게')
//  - 슬라이드마다 페이지(프레임) 하나. 글 상자 · 사각형 · 원 · 선 · 사진을 고칠 수 있는 보드 요소로 (피그마 불러오기와 같은 뼈대 FigmaContent)
//  - 자리 없는 제목 · 본문 칸은 레이아웃 → 마스터에서 자리 · 글자 크기 · 정렬을 따라옴. 색은 단색 · 테마 색만
//  - 못 옮기는 것: 표 · 차트 · 스마트아트 · 그라데이션 · 그림자 · 애니메이션 · 한 글 안의 섞인 서식 (건너뛴 수를 알려 줌)
//  - 브라우저 안에서만 읽음(서버로 보내지 않음). 순수 규칙 — 시험 tests/pptx-import.test.ts
import type { FigmaContent, FlatEl } from './figmaToBoard.ts'

export interface XNode { tag: string; attrs: Record<string, string>; kids: XNode[]; text: string }
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unent = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m)

/** 작은 XML 읽기 (pptx 안 문서용 · 이름 공간 머리말은 그대로 둠: 'a:t') */
export function parseXml(src: string): XNode {
  const root: XNode = { tag: '', attrs: {}, kids: [], text: '' }
  const stack = [root]
  const s = src.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, '')
  const re = /<(\/?)([\w:.-]+)([^<>]*?)(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1]
    if (m[5] != null) { top.text += unent(m[5]); continue }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue }
    const node: XNode = { tag: m[2], attrs: {}, kids: [], text: '' }
    const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    let a: RegExpExecArray | null
    while ((a = ar.exec(m[3]))) node.attrs[a[1]] = unent(a[2] ?? a[3] ?? '')
    top.kids.push(node)
    if (!m[4]) stack.push(node)
  }
  return root
}
const kid = (n: XNode | undefined, tag: string) => n?.kids.find(k => k.tag === tag)
const kids = (n: XNode | undefined, tag: string) => n?.kids.filter(k => k.tag === tag) ?? []
const path = (n: XNode | undefined, ...tags: string[]) => tags.reduce<XNode | undefined>((c, t) => kid(c, t), n)
function find(n: XNode | undefined, tag: string): XNode | undefined {
  if (!n) return undefined
  for (const k of n.kids) { if (k.tag === tag) return k; const f = find(k, tag); if (f) return f }
  return undefined
}

export const PPTX_MAX_SLIDES = 100
export const PPTX_MAX_ELEMENTS = 6000
export const PPTX_MAX_IMAGE = 6_000_000
const EMU = 9525
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

const dec = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : '')
function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
/** 'ppt/slides/slide1.xml' + '../media/a.png' → 'ppt/media/a.png' */
export function resolvePath(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = from.split('/').slice(0, -1)
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p) }
  return parts.join('/')
}
const relsOf = (files: Record<string, Uint8Array>, part: string) => {
  const i = part.lastIndexOf('/')
  const out: Record<string, { target: string; type: string }> = {}
  for (const r of kids(kid(parseXml(dec(files[`${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`])), 'Relationships'), 'Relationship')) {
    if (r.attrs.TargetMode === 'External') continue
    out[r.attrs.Id] = { target: resolvePath(part, r.attrs.Target ?? ''), type: (r.attrs.Type ?? '').split('/').pop() ?? '' }
  }
  return out
}

/** 긴 글을 상자 폭에 맞춰 줄 바꿈 (한글 · 한자는 한 글자 폭, 그 밖은 0.55) */
export function wrapText(text: string, maxW: number, fontPx: number): string {
  if (!(maxW > fontPx * 2)) return text
  const cw = (ch: string) => (/[ᄀ-ᇿ⺀-鿿가-힯＀-￯]/.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.56) * fontPx
  const out: string[] = []
  for (const line of text.split('\n')) {
    let cur = '', w = 0, lastSpace = -1
    for (const ch of line) {
      const c = cw(ch)
      if (w + c > maxW && cur) {
        if (lastSpace > 0 && ch !== ' ') { out.push(cur.slice(0, lastSpace)); cur = cur.slice(lastSpace + 1); w = [...cur].reduce((n, x) => n + cw(x), 0) }
        else { out.push(cur); cur = ''; w = 0 }
        lastSpace = -1
        if (ch === ' ') continue
      }
      if (ch === ' ') lastSpace = cur.length
      cur += ch; w += c
    }
    out.push(cur)
  }
  return out.join('\n')
}

type Theme = Record<string, string>
const SCHEME_ALIAS: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }
function readTheme(xml: string): Theme {
  const t: Theme = {}
  for (const c of find(parseXml(xml), 'a:clrScheme')?.kids ?? []) {
    const v = kid(c, 'a:srgbClr')?.attrs.val ?? kid(c, 'a:sysClr')?.attrs.lastClr
    if (v) t[c.tag.replace('a:', '')] = `#${v.toLowerCase()}`
  }
  return t
}
/** 칠 · 선 · 글자색 칸에서 색 (단색만) */
function colorIn(n: XNode | undefined, theme: Theme): string | undefined {
  if (!n) return undefined
  const rgb = kid(n, 'a:srgbClr')?.attrs.val
  if (rgb) return `#${rgb.toLowerCase()}`
  const sys = kid(n, 'a:sysClr')?.attrs.lastClr
  if (sys) return `#${sys.toLowerCase()}`
  const sc = kid(n, 'a:schemeClr')?.attrs.val
  if (sc) return theme[SCHEME_ALIAS[sc] ?? sc]
  return undefined
}

interface Ph { type: string; idx: string; xfrm?: XNode; sz?: number; algn?: string; anchor?: string }
const phOf = (sp: XNode) => path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph') ?? path(sp, 'p:nvPicPr', 'p:nvPr', 'p:ph')
function phList(doc: XNode): Ph[] {
  const out: Ph[] = []
  const walk = (n: XNode) => {
    for (const k of n.kids) {
      if (k.tag === 'p:grpSp') walk(k)
      if (k.tag !== 'p:sp') continue
      const ph = phOf(k)
      if (!ph) continue
      const lvl = path(k, 'p:txBody', 'a:lstStyle', 'a:lvl1pPr')
      const sz = Number(kid(lvl, 'a:defRPr')?.attrs.sz)
      out.push({ type: ph.attrs.type ?? 'body', idx: ph.attrs.idx ?? '', xfrm: path(k, 'p:spPr', 'a:xfrm'), sz: sz > 0 ? sz : undefined, algn: lvl?.attrs.algn, anchor: path(k, 'p:txBody', 'a:bodyPr')?.attrs.anchor })
    }
  }
  const tree = path(doc, kid(doc, 'p:sldLayout') ? 'p:sldLayout' : 'p:sldMaster', 'p:cSld', 'p:spTree')
  if (tree) walk(tree)
  return out
}
const TITLE = new Set(['title', 'ctrTitle'])
const sameKind = (a: string, b: string) => a === b || (TITLE.has(a) && TITLE.has(b)) || (['body', 'subTitle', 'obj'].includes(a) && ['body', 'subTitle', 'obj'].includes(b))
const matchPh = (list: Ph[], type: string, idx: string, byIdx: boolean) => (byIdx && idx ? list.find(p => p.idx === idx) : undefined) ?? list.find(p => p.type === type) ?? list.find(p => sameKind(p.type, type))

interface Tf { sx: number; sy: number; dx: number; dy: number }
const ID: Tf = { sx: 1, sy: 1, dx: 0, dy: 0 }
const num = (v: string | undefined) => Number(v) || 0

export interface PptxResult extends FigmaContent { slides: number; width: number; height: number; missingImages: number }

/** 풀어 놓은 pptx(경로 → 내용)를 보드 요소로. target = 슬라이드를 놓을 폭(px) */
export function pptxToContent(files: Record<string, Uint8Array>, target = 1920, gap = 120): PptxResult {
  const pres = kid(parseXml(dec(files['ppt/presentation.xml'])), 'p:presentation')
  if (!pres) throw new Error('파워포인트(.pptx) 파일이 아닙니다. 예전 .ppt 는 파워포인트에서 .pptx 로 저장해 올려 주세요.')
  const sz = kid(pres, 'p:sldSz')
  const emuW = num(sz?.attrs.cx) || 12192000, emuH = num(sz?.attrs.cy) || 6858000
  const k = target / (emuW / EMU)
  const px = (emu: number) => (emu / EMU) * k
  const W = target, H = Math.round(px(emuH))
  const presRels = relsOf(files, 'ppt/presentation.xml')
  const slidePaths = kids(kid(pres, 'p:sldIdLst'), 'p:sldId').map(s => presRels[s.attrs['r:id']]?.target).filter((p): p is string => !!p && !!files[p]).slice(0, PPTX_MAX_SLIDES)
  if (!slidePaths.length) throw new Error('슬라이드를 찾지 못했습니다.')

  const out: PptxResult = { frames: [], images: {}, skipped: 0, slides: slidePaths.length, width: W, height: H, missingImages: 0 }
  const cache = new Map<string, { list: Ph[]; doc: XNode; rels: ReturnType<typeof relsOf>; theme: Theme }>()
  const part = (p: string | undefined) => {
    if (!p || !files[p]) return undefined
    let c = cache.get(p)
    if (!c) {
      const doc = parseXml(dec(files[p])), rels = relsOf(files, p)
      const themeP = Object.values(rels).find(r => r.type === 'theme')?.target
      c = { doc, rels, list: phList(doc), theme: themeP ? readTheme(dec(files[themeP])) : {} }
      cache.set(p, c)
    }
    return c
  }
  let total = 0

  slidePaths.forEach((sp, si) => {
    const doc = parseXml(dec(files[sp])), rels = relsOf(files, sp)
    const layout = part(Object.values(rels).find(r => r.type === 'slideLayout')?.target)
    const master = part(layout ? Object.values(layout.rels).find(r => r.type === 'slideMaster')?.target : undefined)
    const theme = master?.theme ?? {}
    const txStyles = find(master?.doc, 'p:txStyles')
    const X0 = si * (W + gap)
    const fid = `s${si + 1}`
    const els: FlatEl[] = [{ id: fid, kind: 'frame', x: X0, y: 0, w: W, h: H, name: `슬라이드 ${si + 1}` }]
    let n = 0, truncated = false
    const push = (e: Omit<FlatEl, 'id' | 'frame'>) => {
      if (total >= PPTX_MAX_ELEMENTS) { truncated = true; return '' }
      total++
      const id = `${fid}e${++n}`
      els.push({ ...e, id, frame: fid, x: e.x + X0 })
      return id
    }
    // 배경 (단색만 · 슬라이드 → 레이아웃 → 마스터)
    for (const d of [doc, layout?.doc, master?.doc]) {
      const bg = find(find(d, 'p:bg'), 'a:solidFill')
      const c = colorIn(bg, theme)
      if (c) { if (c !== '#ffffff') push({ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: c, stroke: null }); break }
      if (find(d, 'p:bg')) break
    }
    const box = (xf: XNode | undefined, tf: Tf) => {
      const off = kid(xf, 'a:off'), ext = kid(xf, 'a:ext')
      if (!off || !ext) return null
      return { x: px(num(off.attrs.x) * tf.sx + tf.dx), y: px(num(off.attrs.y) * tf.sy + tf.dy), w: px(num(ext.attrs.cx) * tf.sx), h: px(num(ext.attrs.cy) * tf.sy) }
    }
    const shape = (sp_: XNode, tf: Tf) => {
      const ph = phOf(sp_)
      const type = ph ? ph.attrs.type ?? 'body' : '', idx = ph?.attrs.idx ?? ''
      const lph = ph && layout ? matchPh(layout.list, type, idx, true) : undefined
      const mph = ph && master ? matchPh(master.list, lph?.type ?? type, '', false) : undefined
      const spPr = kid(sp_, 'p:spPr')
      const b = box(kid(spPr, 'a:xfrm'), tf) ?? box(lph?.xfrm, ID) ?? box(mph?.xfrm, ID)
      if (!b) { out.skipped++; return }
      const prst = kid(spPr, 'a:prstGeom')?.attrs.prst ?? 'rect'
      const txBox = path(sp_, 'p:nvSpPr', 'p:cNvSpPr')?.attrs.txBox === '1'
      const style = kid(sp_, 'p:style')
      const fill = kid(spPr, 'a:noFill') ? null : colorIn(kid(spPr, 'a:solidFill'), theme) ?? (!ph && !txBox && !kid(spPr, 'a:gradFill') && !kid(spPr, 'a:blipFill') && num(kid(style, 'a:fillRef')?.attrs.idx) > 0 ? colorIn(kid(style, 'a:fillRef'), theme) : null) ?? (kid(spPr, 'a:gradFill') ? colorIn(find(kid(spPr, 'a:gradFill'), 'a:gs'), theme) ?? null : null)
      const ln = kid(spPr, 'a:ln')
      const stroke = ln && kid(ln, 'a:noFill') ? null : colorIn(kid(ln, 'a:solidFill'), theme) ?? (!ph && !txBox && num(kid(style, 'a:lnRef')?.attrs.idx) > 0 && !fill ? colorIn(kid(style, 'a:lnRef'), theme) : null) ?? null
      const sw = Math.max(1, Math.round(px(num(ln?.attrs.w) || 9525)))
      if (prst === 'line' || /Connector/.test(prst)) {
        const xf = kid(spPr, 'a:xfrm')
        const fh = xf?.attrs.flipH === '1', fv = xf?.attrs.flipV === '1'
        const arrow = !!ln && [kid(ln, 'a:tailEnd'), kid(ln, 'a:headEnd')].some(e => e && e.attrs.type && e.attrs.type !== 'none')
        push({ kind: arrow ? 'arrow' : 'line', x: b.x + (fh ? b.w : 0), y: b.y + (fv ? b.h : 0), w: b.w, h: b.h, points: [[0, 0], [fh ? -b.w : b.w, fv ? -b.h : b.h]], stroke: stroke ?? colorIn(kid(style, 'a:lnRef'), theme) ?? '#151d18', strokeWidth: sw })
        return
      }
      if (fill || stroke) push({ kind: prst === 'ellipse' ? 'ellipse' : 'rect', x: b.x, y: b.y, w: b.w, h: b.h, fill, stroke, strokeWidth: sw, radius: prst === 'roundRect' ? Math.min(b.w, b.h) * 0.16 : 0 })
      // 글
      const body = kid(sp_, 'p:txBody')
      const paras = kids(body, 'a:p')
      if (!paras.length) return
      const masterLvl = path(txStyles, TITLE.has(type) ? 'p:titleStyle' : ph ? 'p:bodyStyle' : 'p:otherStyle', 'a:lvl1pPr')
      let size = 0, bold = false, color: string | undefined, algn: string | undefined
      const bullets = !!ph && !TITLE.has(type) && ['body', 'obj'].includes(lph?.type ?? type)
      const lines: string[] = []
      for (const p of paras) {
        const pPr = kid(p, 'a:pPr')
        algn ??= pPr?.attrs.algn
        let line = ''
        for (const r of p.kids) {
          if (r.tag === 'a:br') { line += '\n'; continue }
          if (r.tag !== 'a:r' && r.tag !== 'a:fld') continue
          const rPr = kid(r, 'a:rPr')
          if (!size && num(rPr?.attrs.sz) > 0) size = num(rPr?.attrs.sz)
          if (!line && rPr?.attrs.b === '1') bold = true
          color ??= colorIn(kid(rPr, 'a:solidFill'), theme)
          line += kid(r, 'a:t')?.text ?? ''
        }
        const lvl = num(pPr?.attrs.lvl)
        lines.push(line.trim() && bullets && !kid(pPr, 'a:buNone') ? `${'  '.repeat(lvl)}• ${line}` : line)
      }
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
      const text = lines.join('\n')
      if (!text.trim()) return
      const bodyPr = kid(body, 'a:bodyPr')
      const pt100 = size || lph?.sz || mph?.sz || num(kid(masterLvl, 'a:defRPr')?.attrs.sz) || (TITLE.has(type) ? 4400 : ph ? 2800 : 1800)
      // 자동 맞춤으로 줄인 글 (normAutofit fontScale)
      const fs = num(kid(bodyPr, 'a:normAutofit')?.attrs.fontScale) / 100000 || 1
      const fontPx = Math.max(6, Math.round((pt100 / 100) * (96 / 72) * k * fs * 10) / 10)
      const a = algn ?? lph?.algn ?? mph?.algn ?? masterLvl?.attrs.algn ?? (!ph && !txBox ? 'ctr' : 'l')
      const align = a === 'ctr' ? 'center' : a === 'r' ? 'right' : 'left'
      const padX = px(num(bodyPr?.attrs.lIns) || 91440), padY = px(num(bodyPr?.attrs.tIns) || 45720)
      const innerW = Math.max(fontPx, b.w - padX * 2)
      const wrapped = bodyPr?.attrs.wrap === 'none' ? text : wrapText(text, innerW, fontPx)
      const lh = 1.25
      const th = wrapped.split('\n').length * fontPx * lh
      const anchor = bodyPr?.attrs.anchor ?? lph?.anchor ?? mph?.anchor ?? (!ph && !txBox ? 'ctr' : 't')
      const y = anchor === 'ctr' ? b.y + (b.h - th) / 2 : anchor === 'b' ? b.y + b.h - padY - th : b.y + padY
      push({ kind: 'text', x: b.x + padX, y: Math.max(b.y, y), w: innerW, h: th, text: wrapped, fontSize: fontPx, align, color: color ?? colorIn(kid(masterLvl, 'a:defRPr') && kid(kid(masterLvl, 'a:defRPr'), 'a:solidFill'), theme) ?? theme.dk1 ?? '#151d18', weight: bold ? 700 : 400, lineHeight: lh })
    }
    const pic = (p: XNode, tf: Tf) => {
      const b = box(path(p, 'p:spPr', 'a:xfrm'), tf)
      if (!b) { out.skipped++; return }
      const rid = find(kid(p, 'p:blipFill'), 'a:blip')?.attrs['r:embed']
      const target = rid ? rels[rid]?.target : undefined
      const bytes = target ? files[target] : undefined
      const mime = MIME[(target ?? '').split('.').pop()?.toLowerCase() ?? '']
      const id = push({ kind: 'raster', x: b.x, y: b.y, w: b.w, h: b.h, name: '사진' })
      if (!id) return
      if (bytes && mime && bytes.length <= PPTX_MAX_IMAGE) out.images[id] = { mime, data: b64(bytes) }
      else out.missingImages++
    }
    const walk = (tree: XNode, tf: Tf) => {
      for (const c of tree.kids) {
        if (c.tag === 'p:sp' || c.tag === 'p:cxnSp') shape(c, tf)
        else if (c.tag === 'p:pic') pic(c, tf)
        else if (c.tag === 'p:grpSp') {
          const xf = path(c, 'p:grpSpPr', 'a:xfrm')
          const off = kid(xf, 'a:off'), ext = kid(xf, 'a:ext'), cho = kid(xf, 'a:chOff'), che = kid(xf, 'a:chExt')
          if (!off || !ext || !cho || !che) { walk(c, tf); continue }
          const gx = num(ext.attrs.cx) / (num(che.attrs.cx) || 1), gy = num(ext.attrs.cy) / (num(che.attrs.cy) || 1)
          // 바깥 좌표 = tf( off + (자식 − chOff) × g )
          walk(c, { sx: tf.sx * gx, sy: tf.sy * gy, dx: tf.dx + tf.sx * (num(off.attrs.x) - num(cho.attrs.x) * gx), dy: tf.dy + tf.sy * (num(off.attrs.y) - num(cho.attrs.y) * gy) })
        } else if (c.tag === 'p:graphicFrame' || c.tag === 'mc:AlternateContent') out.skipped++
      }
    }
    const tree = path(doc, 'p:sld', 'p:cSld', 'p:spTree')
    if (tree) walk(tree, ID)
    out.frames.push({ id: fid, els, truncated })
  })
  return out
}

/** 파일 → 보드 요소 (브라우저 · 압축은 fflate 로 그 자리에서 풂) */
export async function readPptxFile(file: Blob): Promise<PptxResult> {
  if (file.size > 150_000_000) throw new Error('파일이 너무 큽니다(150MB 까지).')
  const { unzipSync } = await import('fflate')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: f => /^ppt\/(presentation\.xml|_rels\/|slides\/|slideLayouts\/|slideMasters\/|theme\/|media\/[^/]+\.(png|jpe?g|gif|webp)$)/i.test(f.name) && !/\.(bin|vml)$/i.test(f.name) })
  } catch { throw new Error('파일을 열지 못했습니다. 파워포인트(.pptx) 파일인지 확인해 주세요. 예전 .ppt · 암호가 걸린 파일은 읽지 못합니다.') }
  return pptxToContent(files)
}
