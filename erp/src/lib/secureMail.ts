/**
 * 카드사 보안메일(이용대금명세서) 읽기 (대표 지시 2026-11-12 "보안메일 읽기 기능 만들어")
 *  - 우리카드 등 YettieSoft VestMail 명세서(.html · 메일 원본 .eml)를 올리면 그 자리에서 비밀번호를 물어 풂
 *  - 푸는 일은 명세서 파일 안에 들어 있는 카드사 자체 코드가 함 (인트라넷이 암호 방식을 흉내 내지 않음)
 *    → 화면에 보이지 않는 격리된 틀(sandbox iframe · 인트라넷 로그인 · 저장소에 손대지 못함)에서 실행하고 결과 글만 받음
 *  - 비밀번호는 이 창이 열려 있는 동안 메모리에만 두고 저장 · 전송하지 않음
 *  - 풀린 명세서의 표 → 카드 이용 한 건씩 (pdfGrid.cardGridFromLines 공통), 건별 내역이 없으면 청구 요약
 */
import { cardBillFromLines, cardGridFromLines, CARD_BILL_MARK, pdfGrids } from './pdfGrid'

type Cell = string | number | null
type Grid = Cell[][]

let lastPassword: string | undefined

/** 바이트 → 글: 문서가 밝힌 문자 집합(charset)을 따르고, 없으면 UTF-8 → 깨지면 EUC-KR */
export function decodeBytes(bytes: Uint8Array, charset?: string): string {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096))
  const cs = (charset || head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || '').toLowerCase()
  const tryDec = (c: string) => {
    try {
      return new TextDecoder(c).decode(bytes)
    } catch {
      return null
    }
  }
  if (cs && !/utf-?8/.test(cs)) {
    const t = tryDec(/ks_c_5601|euc-?kr|cp949|x-windows-949/.test(cs) ? 'euc-kr' : cs)
    if (t) return t
  }
  const u = new TextDecoder('utf-8').decode(bytes)
  return u.includes('�') ? (tryDec('euc-kr') ?? u) : u
}

export const isVestMail = (html: string) => /VestMail/i.test(html) || (/doAction/.test(html) && /s\[0\]\s*=\s*"/.test(html))

// ---------- 메일 원본(.eml) 풀기 ----------
interface MimePart {
  type: string
  charset?: string
  name?: string
  bytes: Uint8Array
}
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
const toBytes = (s: string) => Uint8Array.from(s, ch => ch.charCodeAt(0) & 0xff)
function headerMap(block: string) {
  const h = new Map<string, string>()
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) h.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
  }
  return h
}
const param = (v: string | undefined, k: string) => v?.match(new RegExp(`${k}\\*?=\\s*"?([^";]+)"?`, 'i'))?.[1]
function decodeBody(body: string, enc: string): Uint8Array {
  if (/base64/i.test(enc)) {
    const bin = atob(body.replace(/[^A-Za-z0-9+/=]/g, ''))
    return toBytes(bin)
  }
  if (/quoted-printable/i.test(enc)) return toBytes(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))))
  return toBytes(body)
}
export function mimeParts(raw: string, depth = 0): MimePart[] {
  const sep = raw.search(/\r?\n\r?\n/)
  if (sep < 0 || depth > 6) return []
  const h = headerMap(raw.slice(0, sep))
  const body = raw.slice(sep).replace(/^\r?\n\r?\n/, '')
  const ct = h.get('content-type') ?? 'text/plain'
  const boundary = param(ct, 'boundary')
  if (/^multipart\//i.test(ct) && boundary) {
    const out: MimePart[] = []
    for (const piece of body.split(`--${boundary}`).slice(1)) {
      if (piece.startsWith('--')) break
      out.push(...mimeParts(piece.replace(/^\r?\n/, ''), depth + 1))
    }
    return out
  }
  return [
    {
      type: ct.split(';')[0].trim().toLowerCase(),
      charset: param(ct, 'charset'),
      name: param(h.get('content-disposition'), 'filename') ?? param(ct, 'name'),
      bytes: decodeBody(body, h.get('content-transfer-encoding') ?? ''),
    },
  ]
}

// ---------- 보안메일 풀기 (격리된 틀 안에서 명세서 자체 코드 실행) ----------
type VmResult = { html?: string; blob?: Blob; name?: string }
export function openVestMail(html: string, password: string, timeoutMs = 90_000): Promise<VmResult> {
  return new Promise((resolve, reject) => {
    const token = Math.random().toString(36).slice(2)
    const js = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c')
    const hook = `<script>(function(){var T=${js(token)},P=${js(password)};function send(m){m.__vm=T;try{parent.postMessage(m,'*')}catch(e){}}
window.alert=function(t){send({type:'alert',text:String(t)})};window.confirm=function(){return true};
var ow=document.write;document.write=function(){var s=Array.prototype.join.call(arguments,'');if(window.__vmGo){send({type:'html',html:s});return}return ow.apply(document,arguments)};
var oc=URL.createObjectURL;URL.createObjectURL=function(b){if(window.__vmGo&&b instanceof Blob)send({type:'blob',blob:b,name:String(window.fn||'')});return oc.apply(URL,arguments)};
window.addEventListener('load',function(){setTimeout(function(){try{var p=document.getElementById('password');if(!p||typeof window.doAction!=='function'){send({type:'error',text:'no-form'});return}
p.className=String(p.className||'').replace('keypad_ON','');p.value=P;
if(window.PDFView&&PDFView.open){PDFView.open=function(u){send({type:'blob',blob:new Blob([u],{type:'application/pdf'}),name:'statement.pdf'})}}
window.__vmGo=1;window.doAction()}catch(e){send({type:'error',text:String(e)})}},300)})})();</script>`
    // 카드사 코드보다 먼저 덮어써야 하므로 <head> 바로 뒤에 넣음
    const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + hook) : hook + html
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none;border:0'
    const done = (fn: () => void) => {
      clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      frame.remove()
      fn()
    }
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __vm?: string; type?: string; html?: string; blob?: Blob; name?: string; text?: string }
      if (e.source !== frame.contentWindow || !d || d.__vm !== token) return
      if (d.type === 'html' && d.html) done(() => resolve({ html: d.html }))
      else if (d.type === 'blob' && d.blob) done(() => resolve({ blob: d.blob, name: d.name }))
      else if (d.type === 'alert') {
        // 처리 중 안내 등은 넘기고, 비밀번호 틀림만 실패로
        if (/password|비밀번호|invalid|잘못/i.test(d.text ?? '')) done(() => reject(new Error('WRONG_PASSWORD')))
      } else if (d.type === 'error') done(() => reject(new Error(d.text === 'no-form' ? '보안메일 비밀번호 입력 칸을 찾지 못했습니다 (지원하지 않는 보안메일 형식)' : `보안메일을 풀지 못했습니다: ${d.text}`)))
    }
    const timer = setTimeout(() => done(() => reject(new Error('보안메일을 푸는 데 시간이 너무 걸려 멈췄습니다'))), timeoutMs)
    window.addEventListener('message', onMsg)
    frame.srcdoc = doc
    document.body.appendChild(frame)
  })
}

/** 풀린 명세서 HTML → 장부 표 */
export function htmlGrids(html: string): Grid[] {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  dom.querySelectorAll('script,style,noscript').forEach(n => n.remove())
  const clean = (s: string | null) => (s ?? '').replace(/[\u0000-\u001f ]/g, ' ').replace(/\s+/g, ' ').trim()
  // 표 안의 표가 있으면 가장 안쪽 줄만 (바깥 줄은 안쪽 글을 모두 품어 겹침)
  const rows = [...dom.querySelectorAll('tr')].filter(tr => !tr.querySelector('table'))
  const lines = rows.map(tr => [...tr.querySelectorAll('th,td')].map(td => clean(td.textContent)).filter(Boolean)).filter(l => l.length)
  // 표 밖 글(결제일 · 결제계좌 등)도 기준일 · 요약에 쓰도록 덧붙임
  const outside = clean(dom.body?.textContent ?? '')
  const card = cardGridFromLines([[outside.slice(0, 3000)], ...lines])
  if (card) {
    // 카드사 이름(명세서 머리 글)을 맨 윗줄에 남겨 장부의 카드 이름으로 씀 (예: 우리카드 · 현대카드)
    const company = outside.match(/(우리|현대|국민|KB국민|신한|삼성|롯데|하나|비씨|BC|NH농협|농협|IBK|기업)\s*카드/)?.[1]
    if (company) card[0] = [`${company}카드 ${String(card[0][0] ?? '')}`.trim()]
    return [card]
  }
  const bill = cardBillFromLines([...outside.split(/(?<=원)\s/).map(s => [s]), ...lines])
  if (bill) return [[[CARD_BILL_MARK, bill.company, bill.total, bill.payDate, bill.from, bill.to, bill.account]]]
  return [lines]
}

async function askPassword(name: string, again: boolean): Promise<string> {
  if (lastPassword && !again) return lastPassword
  if (typeof window === 'undefined') throw new Error('보안메일 비밀번호가 필요합니다')
  const pw = window.prompt(
    `${again ? '비밀번호가 맞지 않습니다. 다시 넣어 주세요.\n\n' : ''}'${name}' 은(는) 카드사 보안메일입니다.\n명세서 메일에 적힌 비밀번호(사업자번호 10자리 또는 생년월일 6자리 등)를 넣어 주세요.\n인트라넷에 저장하지 않고, 이 창을 닫으면 잊습니다.`,
  )
  if (!pw) throw new Error('보안메일 비밀번호를 넣지 않아 읽지 않았습니다 — 다시 올리고 비밀번호를 넣어 주세요')
  return pw.replace(/-/g, '').trim()
}

/** .html · .eml 명세서 → readGrid 와 같은 모양
 *  여러 파일을 한꺼번에 올려도 비밀번호는 한 번만 묻도록 보안메일은 한 개씩 차례로 풂 */
let queue: Promise<unknown> = Promise.resolve()
export function secureMailGrids(data: ArrayBuffer, name: string): Promise<Grid[]> {
  const job = queue.then(() => readSecureMail(data, name))
  queue = job.catch(() => undefined)
  return job
}
async function readSecureMail(data: ArrayBuffer, name: string): Promise<Grid[]> {
  const bytes = new Uint8Array(data)
  let html: string
  if (/\.eml$/i.test(name)) {
    const parts = mimeParts(latin1(bytes)).filter(p => /html/.test(p.type) || /\.html?$/i.test(p.name ?? ''))
    if (!parts.length) throw new Error('메일 안에 명세서(HTML)가 없습니다')
    const texts = parts.map(p => decodeBytes(p.bytes, p.charset))
    html = texts.find(isVestMail) ?? texts.sort((a, b) => b.length - a.length)[0]
  } else html = decodeBytes(bytes)
  if (!isVestMail(html)) return htmlGrids(html)
  let again = false
  for (let tries = 0; tries < 3; tries++) {
    const pw = await askPassword(name, again)
    try {
      const r = await openVestMail(html, pw)
      lastPassword = pw
      if (r.html) return htmlGrids(r.html)
      if (r.blob) {
        const buf = await r.blob.arrayBuffer()
        const inner = r.name || ''
        if (/\.pdf$/i.test(inner) || r.blob.type === 'application/pdf') return pdfGrids(buf, inner || name)
        if (/\.(xlsx?|csv)$/i.test(inner)) return (await import('./ledgerImport')).readGrid(buf, inner)
        return htmlGrids(decodeBytes(new Uint8Array(buf)))
      }
      throw new Error('보안메일을 풀었지만 내용이 비어 있습니다')
    } catch (e) {
      if ((e as Error).message !== 'WRONG_PASSWORD') throw e
      lastPassword = undefined
      again = true
    }
  }
  throw new Error('보안메일 비밀번호가 맞지 않습니다')
}
