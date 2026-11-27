// 게시 도구 (2026-11-27 마케팅 자동화 — '블로그 작성과 배포')
//  네이버 블로그 · 홈페이지(아임웹)는 자동 게시 API 가 없어 사람이 붙여 넣는다. 그 붙여 넣기를 한 번에 끝내도록:
//  채널 본문(그냥 글)을 소제목 · 문단 · 목록 · 사진 자리로 나눠 서식이 살아 있는 글(HTML)로 바꾸고, 게시 전 점검을 한다. AI 없음 · 순수 함수.
export type Block =
  | { type: 'h'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'photo'; text: string }

const PHOTO_RE = /^\[\s*사진\s*[:：]\s*(.+?)\s*\]$/
const HEAD_MARK_RE = /^(#{1,4}\s+|[■▶◆▣●]\s*)(.+)$/
const BOLD_LINE_RE = /^\*\*(.+?)\*\*$/
const UL_RE = /^[-•·*]\s+(.+)$/
const OL_RE = /^\d{1,2}[.)]\s+(.+)$/
/** 문장으로 끝나는 줄(마침표 · 물음표 · 느낌표 · '다' · '요' 로 끝남)은 소제목으로 보지 않는다 */
const SENTENCE_END_RE = /[.?!。…]$|(?:니다|습니다|어요|아요|에요|예요|해요|세요|지요|죠|네요|군요)$/

/** 그냥 글 → 블록. 소제목: '#', '■' 같은 표시 · '**굵게**' 한 줄 · 앞뒤가 빈 줄이고 40자 이하이며 문장으로 끝나지 않는 한 줄(다음에 본문이 이어질 때) */
export function parseBlocks(body: string): Block[] {
  const paras = body.replace(/\r/g, '').split(/\n{2,}/).map(p => p.split('\n').map(l => l.trim()).filter(Boolean)).filter(p => p.length)
  const out: Block[] = []
  paras.forEach((lines, pi) => {
    let buf: string[] = []
    const flush = () => { if (buf.length) { out.push({ type: 'p', text: buf.join('\n') }); buf = [] } }
    let list: Extract<Block, { items: string[] }> | null = null
    const endList = () => { if (list) { out.push(list); list = null } }
    lines.forEach((line, li) => {
      const photo = line.match(PHOTO_RE)
      const mark = line.match(HEAD_MARK_RE)
      const bold = line.match(BOLD_LINE_RE)
      const ul = line.match(UL_RE)
      const ol = line.match(OL_RE)
      if (photo) { flush(); endList(); out.push({ type: 'photo', text: photo[1] }); return }
      if (mark || bold) { flush(); endList(); out.push({ type: 'h', text: (mark ? mark[2] : bold![1]).replace(/\*\*/g, '').trim() }); return }
      if (ul || ol) {
        flush()
        const fresh: Extract<Block, { items: string[] }> = ul ? { type: 'ul', items: [] } : { type: 'ol', items: [] }
        const same: Extract<Block, { items: string[] }> | null = list
        const cur = same && same.type === fresh.type ? same : (endList(), (list = fresh))
        cur.items.push((ul ?? ol)![1]); return
      }
      endList()
      const alone = lines.length === 1 && li === 0
      const hasNext = pi < paras.length - 1
      if (alone && hasNext && line.length <= 40 && !SENTENCE_END_RE.test(line) && !/https?:\/\//.test(line)) { out.push({ type: 'h', text: line }); return }
      buf.push(line)
    })
    flush(); endList()
  })
  return out
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const LINK_RE = /https?:\/\/[^\s<>"'）)\]]+/g
/** 글 한 줄 → 안전한 HTML (주소는 링크로 · '**굵게**' 는 굵게) */
function inline(text: string): string {
  let out = '', last = 0
  for (const m of text.matchAll(LINK_RE)) {
    const tail = m[0].match(/[.,!?:;·]+$/)?.[0] ?? ''
    const url = tail ? m[0].slice(0, -tail.length) : m[0]
    out += esc(text.slice(last, m.index)) + `<a href="${esc(url)}">${esc(url)}</a>` + esc(tail)
    last = m.index! + m[0].length
  }
  out += esc(text.slice(last))
  return out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}

/** 붙여 넣으면 소제목 · 문단 · 목록 · 링크가 살아 있는 HTML. 사진 자리는 눈에 띄는 한 줄로 남긴다(사람이 사진으로 바꿈) */
export function blocksToHtml(blocks: Block[]): string {
  return blocks.map(b => {
    if (b.type === 'h') return `<h3><b>${inline(b.text)}</b></h3>`
    if (b.type === 'photo') return `<p style="color:#888">〔사진 자리: ${esc(b.text)}〕</p>`
    if (b.type === 'ul' || b.type === 'ol') return `<${b.type}>${b.items.map(i => `<li>${inline(i)}</li>`).join('')}</${b.type}>`
    return `<p>${b.text.split('\n').map(inline).join('<br>')}</p>`
  }).join('\n')
}

/** 서식을 못 받는 곳에 붙일 글 */
export function blocksToPlain(blocks: Block[]): string {
  const bare = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1')
  return blocks.map(b => {
    if (b.type === 'h') return bare(b.text)
    if (b.type === 'photo') return `〔사진 자리: ${b.text}〕`
    if (b.type === 'ul') return b.items.map(i => `- ${bare(i)}`).join('\n')
    if (b.type === 'ol') return b.items.map((i, n) => `${n + 1}. ${bare(i)}`).join('\n')
    return bare(b.text)
  }).join('\n\n')
}

/** 미리보기용: '**굵게**' 를 나눠 [글, 굵게?] 조각으로 */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  return text.split(/\*\*(.+?)\*\*/g).map((t, i) => ({ text: t, bold: i % 2 === 1 })).filter(p => p.text)
}

/** 태그 칸(쉼표 · 공백 · # 섞임) → '#태그 #태그' (30개까지 · 겹치는 것 뺌) */
export function hashTags(tags: string): string {
  const seen = new Set<string>()
  for (const t of tags.split(/[\s,#]+/)) { const v = t.trim(); if (v) seen.add(v) }
  return [...seen].slice(0, 30).map(t => `#${t}`).join(' ')
}

export interface PublishCheck { ok: boolean; label: string }
export const PUBLISH_CHANNELS = ['네이버 블로그', '홈페이지'] as const
const RULES: Record<string, { title: [number, number]; body: number }> = {
  '네이버 블로그': { title: [15, 40], body: 1500 },
  홈페이지: { title: [8, 50], body: 400 },
}

/** 게시 전 점검 — 모두 사람이 고칠 수 있는 것만 알려 준다 */
export function publishChecks(channel: string, title: string, body: string, tags: string): PublishCheck[] {
  const rule = RULES[channel]
  if (!rule) return []
  const blocks = parseBlocks(body)
  const t = title.trim().length, len = body.replace(/\s+/g, '').length
  const photos = blocks.filter(b => b.type === 'photo').length
  const heads = blocks.filter(b => b.type === 'h').length
  const untagged = (body.match(LINK_RE) ?? []).filter(u => /(?:^|\.)(?:thewklyn\.com|arteriors\.co\.kr)(?:[/:?#]|$)/.test(u.replace(/^https?:\/\//, '')) && !u.includes('utm_source=')).length
  const checks: PublishCheck[] = [
    { ok: t >= rule.title[0] && t <= rule.title[1], label: `제목 ${t}자 (권장 ${rule.title[0]}~${rule.title[1]}자)` },
    { ok: len >= rule.body, label: `본문 ${len.toLocaleString('ko-KR')}자 (권장 ${rule.body.toLocaleString('ko-KR')}자 이상 · 공백 제외)` },
    { ok: !/\[\s*(확인 필요|NEED)[^\]]*\]/i.test(`${title}\n${body}`), label: '[확인 필요] 로 남은 곳이 없어야 합니다' },
  ]
  if (channel === '네이버 블로그') {
    checks.push({ ok: heads >= 2, label: `소제목 ${heads}개 (권장 2개 이상)` })
    checks.push({ ok: photos >= 1, label: photos ? `사진 자리 ${photos}곳 — 붙여 넣은 뒤 사진으로 바꾸세요` : '사진 자리가 없습니다 — [사진: 무엇] 한 줄을 넣어 두면 빠뜨리지 않습니다' })
    checks.push({ ok: hashTags(tags).length > 0, label: hashTags(tags) ? `태그 ${hashTags(tags).split(' ').length}개` : '태그가 없습니다' })
    checks.push({ ok: untagged === 0, label: untagged ? `우리 홈페이지 주소 ${untagged}개에 꼬리표가 없습니다 — 저장하면 자동으로 붙습니다` : '우리 홈페이지 주소에 꼬리표가 붙어 있습니다 (또는 주소 없음)' })
  }
  return checks
}
