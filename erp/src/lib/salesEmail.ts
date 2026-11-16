// Designed sales email: the approved cover text and the approved execution plan rendered into one HTML mail.
// The same function renders the preview the administrator approves and the mail the dispatcher sends, so what is
// approved is what is sent. Only the approved words are used; the layout adds no claims of its own.

export interface ProposalStep {step: string; period: string; work: string; output: string}
export interface ParsedProposal {
  title: string; summary: string; why: string; approach: string;
  steps: ProposalStep[]; roles: {who: string; text: string}[]; budget: string; next: string;
  /** Text that did not fit the structure (older drafts): shown as plain paragraphs, never dropped. */
  rest: string; structured: boolean;
}
const HEADS: Record<string, keyof Pick<ParsedProposal,'why'|'approach'|'budget'|'next'>|'steps'|'roles'> = {
  '왜 지금': 'why', '수행 방식': 'approach', '진행 계획': 'steps', '역할 분담': 'roles', '견적 기준': 'budget', '다음 단계': 'next',
}
export function parseProposal(md: string): ParsedProposal {
  const p: ParsedProposal = {title:'',summary:'',why:'',approach:'',steps:[],roles:[],budget:'',next:'',rest:'',structured:false}
  let current: string | null = null
  const rest: string[] = []
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    const head = /^#{1,3}\s*(.+?)\s*$/.exec(line)
    if (/^제목\s*[:：]/.test(line)) { p.title = line.replace(/^제목\s*[:：]\s*/, ''); continue }
    if (/^요약\s*[:：]/.test(line)) { p.summary = line.replace(/^요약\s*[:：]\s*/, ''); continue }
    if (head) {
      const key = Object.keys(HEADS).find(k => head[1].replace(/^\d+[.)]\s*/, '').startsWith(k))
      if (key) { current = HEADS[key]; p.structured = true; continue }
      if (!p.title) { p.title = head[1]; continue }
      current = null; rest.push(head[1]); continue
    }
    if (!line) { if (current && current !== 'steps' && current !== 'roles') (p as unknown as Record<string,string>)[current] += '\n'; else if (!current) rest.push(''); continue }
    if (current === 'steps') {
      const cells = line.replace(/^(?:[-*]\s*|\d+[.)]\s+)/, '').split('|').map(c => c.trim())
      if (cells.length >= 3) p.steps.push({step: cells[0], period: cells[1] ?? '', work: cells[2] ?? '', output: cells[3] ?? ''})
      else if (p.steps.length) p.steps[p.steps.length - 1].work += ' ' + line
      continue
    }
    if (current === 'roles') {
      const m = /^[-*]?\s*([^:：]{1,30})[:：]\s*(.+)$/.exec(line)
      if (m) p.roles.push({who: m[1].trim(), text: m[2].trim()})
      else if (p.roles.length) p.roles[p.roles.length - 1].text += ' ' + line.replace(/^[-*]\s*/, '')
      continue
    }
    if (current) { const k = current as 'why'|'approach'|'budget'|'next'; p[k] += (p[k] && !p[k].endsWith('\n') ? '\n' : '') + line; continue }
    if (!p.title) { p.title = line; continue }
    rest.push(line)
  }
  for (const k of ['why', 'approach', 'budget', 'next'] as const) p[k] = p[k].trim()
  p.rest = rest.join('\n').trim()
  return p
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const paras = (s: string, style: string) => s.split(/\n{2,}|\n/).map(t => t.trim()).filter(Boolean).map(t => `<p style="${style}">${esc(t)}</p>`).join('')
const C = {bg:'#F6F4EF', card:'#FFFFFF', ink:'#1F2A24', sub:'#5F6A63', line:'#E7E3DA', green:'#1F6B4A', tint:'#EEF5F0', warm:'#F7F1E8', pink:'#FD37BE'}
const OPT_OUT = /원치 않|수신을 원하지|받지 않으시려면|불필요하시면|그만 받/
const FONT = "'Pretendard','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif"
const P = `margin:0 0 12px;font-size:15px;line-height:1.75;color:${C.ink};`
const H = (t: string) => `<tr><td style="padding:28px 40px 10px;"><div style="font-size:12px;letter-spacing:2px;color:${C.green};font-weight:700;">${esc(t)}</div></td></tr>`

export interface SalesEmailInput {subject: string; body: string; proposal?: string | null; sender: string}
/** Table layout with inline styles only (mail apps drop <style>); light colours, 640px, readable on a phone. */
export function renderSalesEmailHtml({subject, body, proposal, sender}: SalesEmailInput): string {
  const pr = proposal?.trim() ? parseProposal(proposal) : null
  const reply = `mailto:${encodeURIComponent(sender)}?subject=${encodeURIComponent('Re: ' + subject)}`
  const rows: string[] = []
  rows.push(`<tr><td style="padding:28px 40px 0;"><div style="font-size:12px;letter-spacing:3px;color:${C.sub};font-weight:700;">THE WKLY <span style="color:${C.pink};">×</span> ARTERIOR</div></td></tr>`)
  rows.push(`<tr><td style="padding:14px 40px 8px;"><div style="font-size:22px;line-height:1.4;font-weight:700;color:${C.ink};">${esc(pr?.title || subject)}</div>${pr?.summary ? `<div style="margin-top:8px;font-size:15px;line-height:1.6;color:${C.sub};">${esc(pr.summary)}</div>` : ''}<div style="margin-top:18px;width:40px;height:3px;background:${C.green};"></div></td></tr>`)
  // The opt-out sentence and the sign-off close the mail, after the plan; the rest opens it.
  const blocks = body.replace(/\r\n?/g, '\n').split(/\n{2,}|\n/).map(t => t.trim()).filter(Boolean)
  const closing = pr ? blocks.filter((t, i) => OPT_OUT.test(t) || (i === blocks.length - 1 && t.length <= 40 && /더위클리|아트리어/.test(t))) : []
  const opening = blocks.filter(t => !closing.includes(t))
  rows.push(`<tr><td style="padding:18px 40px 4px;">${paras(opening.join('\n'), P)}</td></tr>`)
  if (pr) {
    if (pr.why) { rows.push(H('왜 지금')); rows.push(`<tr><td style="padding:0 40px;">${paras(pr.why, P)}</td></tr>`) }
    if (pr.approach) { rows.push(H('수행 방식')); rows.push(`<tr><td style="padding:0 40px;"><div style="background:${C.tint};padding:18px 20px;">${paras(pr.approach, P.replace('margin:0 0 12px', 'margin:0 0 8px'))}</div></td></tr>`) }
    if (pr.steps.length) {
      rows.push(H('진행 계획'))
      rows.push(`<tr><td style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${pr.steps.map((s, i) => `<tr><td valign="top" style="width:36px;padding:12px 0;border-top:1px solid ${C.line};"><div style="width:26px;height:26px;line-height:26px;text-align:center;background:${C.green};color:#fff;font-size:13px;font-weight:700;">${i + 1}</div></td><td valign="top" style="padding:12px 0 12px 8px;border-top:1px solid ${C.line};"><div style="font-size:15px;font-weight:700;color:${C.ink};">${esc(s.step)}${s.period ? ` <span style="font-weight:400;color:${C.sub};font-size:13px;">· ${esc(s.period)}</span>` : ''}</div><div style="margin-top:4px;font-size:14px;line-height:1.65;color:${C.ink};">${esc(s.work)}</div>${s.output ? `<div style="margin-top:4px;font-size:13px;color:${C.green};">산출물 · ${esc(s.output)}</div>` : ''}</td></tr>`).join('')}</table></td></tr>`)
    }
    if (pr.roles.length) {
      rows.push(H('역할 분담'))
      rows.push(`<tr><td style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${pr.roles.slice(0, 2).map((r, i) => `<td valign="top" width="50%" style="padding:${i ? '0 0 0 6px' : '0 6px 0 0'};"><div style="background:${i ? C.warm : C.tint};padding:16px 18px;"><div style="font-size:13px;font-weight:700;color:${C.ink};">${esc(r.who)}</div><div style="margin-top:6px;font-size:14px;line-height:1.65;color:${C.ink};">${esc(r.text)}</div></div></td>`).join('')}</tr></table></td></tr>`)
    }
    if (pr.budget) { rows.push(H('견적 기준')); rows.push(`<tr><td style="padding:0 40px;">${paras(pr.budget, P)}</td></tr>`) }
    if (pr.rest) { rows.push(H('제안 내용')); rows.push(`<tr><td style="padding:0 40px;">${paras(pr.rest, P)}</td></tr>`) }
    rows.push(`<tr><td style="padding:24px 40px 8px;">${pr.next ? paras(pr.next, P) : ''}<a href="${esc(reply)}" style="display:inline-block;background:${C.green};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 22px;">회신으로 미팅 요청하기</a></td></tr>`)
  }
  if (closing.length) rows.push(`<tr><td style="padding:20px 40px 4px;">${paras(closing.join('\n'), P.replace(`color:${C.ink}`, `color:${C.sub}`).replace('font-size:15px', 'font-size:14px'))}</td></tr>`)
  rows.push(`<tr><td style="padding:28px 40px 32px;border-top:1px solid ${C.line};font-size:12px;line-height:1.7;color:${C.sub};"><b style="color:${C.ink};">더위클리컴퍼니</b> · 행사 기획·운영·홍보 콘텐츠 · 서울 마포구 성지길 25-11<br><b style="color:${C.ink};">아트리어디자인스튜디오</b> · 공간 디자인·제작·설치 · 서울 마포구 양화로 50, 4층 402호<br>${esc(sender)} · <a href="https://www.thewklyn.com" style="color:${C.green};">thewklyn.com</a></td></tr>`)
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;background:${C.bg};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:${C.card};font-family:${FONT};">${rows.join('')}</table></td></tr></table></body></html>`
}

/** Plain-text alternative: the approved cover text, then the approved plan with its markdown marks removed. */
export function salesEmailText({body, proposal}: Pick<SalesEmailInput,'body'|'proposal'>): string {
  const plan = (proposal ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/^#{1,3}\s*/, '■ ').replace(/^(제목|요약)\s*[:：]\s*/, '')).join('\n').trim()
  return plan ? `${body.trim()}\n\n──────────\n${plan}\n` : body.trim() + '\n'
}
