import type { InterviewSalesInfo, InterviewStage, SalesInterview, SalesInterviewDraft } from './types'

/**
 * 서면 인터뷰 관리 (2026-11-18 · 대표 지시 '영업수주에서 인터뷰지와 인터뷰질문 데이터 관리하고 제작은 광고 컨텐츠에서'
 *  → '작업 환경에 맞게 인트라넷에 반영하고 현재 작업중인 자료도 이전해줘')
 * 예전 구글 시트 '인터뷰피드 발송현황'의 탭(답변 온 브랜드 · 발송 전체 · 1차 가공 · 로우 데이터)을 한 줄로 합친 표 sales_interviews 의 규칙.
 * React 를 쓰지 않는 순수 함수만 둔다 (테스트에서 바로 불러 씀).
 */
export const INTERVIEW_STAGES: InterviewStage[] = ['발송', '답변', '인터뷰지 발송', '자료 수령', '제작', '업로드 완료', '답장 없음', '확인 필요', '불가', '보류']
/** 진행 현황에 보이는 단계 (브랜드가 참여하기로 한 뒤 업로드 전까지) */
export const ACTIVE_STAGES: InterviewStage[] = ['답변', '인터뷰지 발송', '자료 수령', '제작']
const CLOSED_STAGES: InterviewStage[] = ['답장 없음', '불가', '보류']
export const STAGE_TONE: Record<InterviewStage, 'wait' | 'go' | 'ok' | 'done' | 'off' | 'warn'> = {
  발송: 'wait', 답변: 'go', '인터뷰지 발송': 'go', '자료 수령': 'ok', 제작: 'ok', '업로드 완료': 'done',
  '답장 없음': 'off', '확인 필요': 'warn', 불가: 'off', 보류: 'off',
}

/** 더위클리 팝업 큐레이션 인터뷰지 10문항 (구글 폼 기준 · 브랜드마다 문장은 조금씩 다름) · '영업'은 내부 참고용 답 */
export const INTERVIEW_QUESTIONS = [
  { no: 'Q1', section: '브랜드 철학 · 팝업 목표', label: '공간을 고른 이유 · 심고자 한 브랜드 이미지', use: '콘텐츠' },
  { no: 'Q2', section: '브랜드 철학 · 팝업 목표', label: '핵심 KPI · 예상 방문객', use: '콘텐츠' },
  { no: 'Q3', section: '브랜드 철학 · 팝업 목표', label: '전체 예산 규모 (기획 · 시공 · 운영)', use: '영업' },
  { no: 'Q4', section: '공간 기획 · 인테리어', label: '인테리어 중점 요소 · 키 포인트 공간', use: '콘텐츠' },
  { no: 'Q5', section: '공간 기획 · 인테리어', label: '사진 · 공유를 부르는 장치', use: '콘텐츠' },
  { no: 'Q6', section: '마케팅 · 고객 접점', label: '체류 구간의 구매 · 브랜드 경험 전략', use: '콘텐츠' },
  { no: 'Q7', section: '마케팅 · 고객 접점', label: '체험 요소 · 현장 이벤트', use: '콘텐츠' },
  { no: 'Q8', section: '인사이트 · 향후 비전', label: '기대하는 전환점', use: '콘텐츠' },
  { no: 'Q9', section: '인사이트 · 향후 비전', label: '어려움 · 인사이트 · 조언', use: '콘텐츠' },
  { no: 'Q10', section: '향후 계획 · 파트너 기준', label: '향후 팝업 계획 · 파트너 선정 기준 (필수)', use: '영업' },
] as const

export const SALES_INFO_FIELDS: [keyof InterviewSalesInfo, string][] = [
  ['category', '카테고리'], ['region', '지역'], ['budget', '예산'], ['partner', '파트너 선정 기준'], ['next_plan', '차기 계획'],
]

const DAY_MS = 86_400_000
const KST_MS = 9 * 3_600_000
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
/** 한국 날짜 YYYY-MM-DD */
export const todayKst = (now = Date.now()) => new Date(now + KST_MS).toISOString().slice(0, 10)
/** b - a (날짜 YYYY-MM-DD 사이 일 수) */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
export const shortMd = (date: string) => { const [, m, d] = date.split('-'); return `${Number(m)}/${Number(d)}` }
export const mdWithDay = (date: string) => `${shortMd(date)}(${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`
/** timestamptz ↔ datetime-local (한국 시간) */
export const toLocalInput = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso) + KST_MS).toISOString().slice(0, 16) : '')
export const fromLocalInput = (value: string) => (value ? `${value}:00+09:00` : null)

/** 자료 수령 표시: 받음 · 지남 · D-n */
export function materialStatus(r: Pick<SalesInterview, 'stage' | 'material_due' | 'material_note'>, today = todayKst()): { label: string; tone: 'ok' | 'hot' | 'soon' | 'plain' } | null {
  if (r.stage === '자료 수령' || r.stage === '제작' || r.stage === '업로드 완료') return { label: '자료 받음', tone: 'ok' }
  if (CLOSED_STAGES.includes(r.stage)) return null
  if (!r.material_due) return r.material_note ? { label: r.material_note, tone: 'plain' } : null
  const d = daysBetween(today, r.material_due)
  if (d < 0) return { label: `자료 ${shortMd(r.material_due)} 지남`, tone: 'hot' }
  return { label: `자료 ${shortMd(r.material_due)} ${d === 0 ? '오늘' : `D-${d}`}`, tone: d <= 2 ? 'soon' : 'plain' }
}

/** 같은 날 업로드가 둘 이상인 날짜 → 그 날의 줄 id (불가 · 보류 · 답장 없음 제외) */
export function uploadConflicts(rows: Pick<SalesInterview, 'id' | 'stage' | 'upload_on'>[]): Map<string, string[]> {
  const by = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.upload_on || CLOSED_STAGES.includes(r.stage)) continue
    by.set(r.upload_on, [...(by.get(r.upload_on) ?? []), r.id])
  }
  return new Map([...by].filter(([, ids]) => ids.length > 1))
}

/** 메일 자동 확인 표시: 인터뷰지를 보낸 뒤 첨부 메일 · 브랜드 메일이 우리 답보다 늦음 */
export function mailSignal(r: Pick<SalesInterview, 'stage' | 'mail_last_in_at' | 'mail_last_out_at' | 'mail_attach_at' | 'form_sent_at'>): { label: string; tone: 'hot' | 'ok' } | null {
  const t = (s: string | null) => (s ? Date.parse(s) : Number.NaN)
  if (r.stage === '업로드 완료' || CLOSED_STAGES.includes(r.stage)) return null
  if (r.stage === '인터뷰지 발송' && r.mail_attach_at && !(t(r.mail_attach_at) <= t(r.form_sent_at))) return { label: '첨부 메일 도착', tone: 'ok' }
  if (r.mail_last_in_at && !(t(r.mail_last_in_at) <= t(r.mail_last_out_at))) return { label: '브랜드 메일 · 답장 필요', tone: 'hot' }
  return null
}

/** 업로드 예정일 순 (없는 것은 뒤) → 자료 수령 예정일 → 이름 */
export function byUpload(a: Pick<SalesInterview, 'upload_on' | 'material_due' | 'brand'>, b: Pick<SalesInterview, 'upload_on' | 'material_due' | 'brand'>): number {
  const key = (r: typeof a) => [r.upload_on ?? '9999', r.material_due ?? '9999', r.brand]
  const [x, y] = [key(a), key(b)]
  return x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2], 'ko')
}

/** 시트 · 구글 폼 응답에서 복사한 한 줄 → 답 (칸은 탭으로 나뉨 · 줄바꿈이 든 칸은 큰따옴표로 감쌈)
 *  12칸 이상: 타임스탬프 · 브랜드 · Q1~Q10 / 11칸: 타임스탬프 · Q1~Q10 / 그 밖: Q1부터 차례로 */
export function answersFromPaste(text: string): { answers: Record<string, string>; stamp: string | null } {
  const cells = splitTsvRow(text.replace(/\r\n?/g, '\n').replace(/\n+$/, ''))
  const start = cells.length >= 12 ? 2 : cells.length === 11 ? 1 : 0
  const stamp = start > 0 ? cells[0].trim() || null : null
  const answers: Record<string, string> = {}
  cells.slice(start, start + 10).forEach((c, i) => { if (c.trim()) answers[`Q${i + 1}`] = c.trim() })
  return { answers, stamp }
}
function splitTsvRow(text: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === '\t') { out.push(cell); cell = '' }
    else cell += ch
  }
  out.push(cell)
  return out
}

/** 새 섭외 한 줄 (이번 달 묶음 · 오늘 발송) */
export function emptyInterview(today = todayKst()): SalesInterviewDraft {
  return {
    batch: `${Number(today.slice(5, 7))}월 발송`, brand: '', event_name: null, venue: null, stage: '발송',
    send_channel: 'DM', sent_on: today, contact: null, reply_channel: null, replied_at: null, image_use: null, interview_ok: null,
    form_url: null, form_sent_at: null, form_note: null, material_due: null, material_note: null, upload_on: null, upload_note: null,
    post_url: null, note: null, answers: {}, answered_at: null, answered_note: null, sales_info: {}, owner_id: null, content_id: null,
  }
}

/** 인터뷰 피드 콘텐츠 초안 글 (광고·콘텐츠 제작 대기열 · AI 없이 답을 옮겨 적음)
 *  영업용 문항 Q3(예산) · Q10(향후 계획 · 파트너 기준)은 넣지 않는다 — 인터뷰지에 '내부 참고용'으로 안내한 답 */
export function interviewContentText(r: Pick<SalesInterview, 'brand' | 'event_name' | 'venue' | 'answers' | 'note'>): { title: string; original: string; instagram: string; blog: string; tags: string } {
  const qa = INTERVIEW_QUESTIONS.filter(q => q.use === '콘텐츠' && r.answers[q.no]?.trim())
  const title = `[인터뷰 피드] ${r.brand}${r.event_name ? ` · ${r.event_name}` : ''}`.slice(0, 160)
  const original = [title, r.venue ? `장소 · 일정: ${r.venue}` : '', '', ...qa.flatMap(q => [`Q. ${q.label}`, `A. ${r.answers[q.no].trim()}`, ''])]
    .join('\n').trim().slice(0, 20000)
  const lead = firstSentences(r.answers.Q1 || r.answers.Q2 || '', 240)
  const handle = (r.note ?? '').match(/@[A-Za-z0-9._]{2,30}/)?.[0]?.replace(/\.$/, '')
  const instagram = [`[더위클리 팝업 큐레이션] ${r.brand}`, r.event_name ?? '', r.venue ?? '', '', lead, '', '인터뷰 전문은 더위클리 홈페이지에서 만나 보세요.', handle ?? '']
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== '')).join('\n').trim().slice(0, 10000)
  const blog = qa.map(q => `Q. ${q.label}\n${r.answers[q.no].trim()}`).join('\n\n').slice(0, 10000)
  const tag = r.brand.replace(/[^0-9A-Za-z가-힣]/g, '')
  const tags = ['#더위클리', '#팝업스토어', '#팝업', tag ? `#${tag}` : ''].filter(Boolean).join(' ').slice(0, 500)
  return { title, original, instagram, blog, tags }
}
/** 앞 문장들을 n자 안에서 자름 (문장 끝에서) */
function firstSentences(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  const end = Math.max(cut.lastIndexOf('다. '), cut.lastIndexOf('요. '), cut.lastIndexOf('. '))
  return end > n / 3 ? cut.slice(0, end + 2).trim() : `${cut.trim()}…`
}
/** 화면에서 고치는 칸 (메일 자동 확인 칸 · 메일 주소 목록 · 출처는 서버가 채움) */
export const DRAFT_KEYS = [
  'batch', 'brand', 'event_name', 'venue', 'stage', 'send_channel', 'sent_on', 'contact', 'reply_channel', 'replied_at', 'image_use',
  'interview_ok', 'form_url', 'form_sent_at', 'form_note', 'material_due', 'material_note', 'upload_on', 'upload_note', 'post_url',
  'note', 'answers', 'answered_at', 'answered_note', 'sales_info', 'owner_id', 'content_id',
] as const satisfies readonly (keyof SalesInterviewDraft)[]
/** 저장된 줄 → 고칠 칸만 */
export function draftOf(r: SalesInterview): SalesInterviewDraft {
  const d: Record<string, unknown> = {}
  for (const k of DRAFT_KEYS) d[k] = r[k]
  return { ...(d as SalesInterviewDraft), answers: { ...(r.answers ?? {}) }, sales_info: { ...(r.sales_info ?? {}) } }
}
const httpUrl = (v: string | null) => !v || /^https?:\/\/\S+$/i.test(v.trim())
export function validateInterview(d: SalesInterviewDraft): string | null {
  if (!d.brand.trim() || d.brand.length > 200) return '브랜드 이름을 적어 주세요.'
  if (!INTERVIEW_STAGES.includes(d.stage)) return '단계를 골라 주세요.'
  if (!httpUrl(d.form_url) || !httpUrl(d.post_url)) return '인터뷰지 · 게시 링크는 https:// 로 시작하는 주소만 넣을 수 있습니다.'
  return null
}
/** 빈 글은 null 로 · 답과 영업 정보의 빈 칸은 뺌 */
export function cleanDraft(d: SalesInterviewDraft): SalesInterviewDraft {
  const out = { ...d } as Record<string, unknown>
  for (const [k, v] of Object.entries(out)) if (typeof v === 'string') out[k] = v.trim() === '' && k !== 'batch' && k !== 'brand' ? null : k === 'brand' ? v.trim() : v
  const pick = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, (v as string).trim()]))
  return { ...(out as SalesInterviewDraft), answers: pick(d.answers), sales_info: pick(d.sales_info as Record<string, string | undefined>) }
}

/**
 * 한 화면 보기 · 비교 (2026-11-21 대표 지시 '한 화면에서 모든 자료를 확인할 수 있도록 · 자유롭게 다른 인터뷰지와 비교')
 * 비교 표의 줄: 기본 정보 → 인터뷰 답 Q1~Q10 → 영업 정보. 값이 없으면 ''.
 */
export interface CompareLine { key: string; group: '기본' | '인터뷰 답' | '영업 정보'; label: string; sales?: boolean; values: string[] }
type CompareRow = Pick<SalesInterview, 'stage' | 'event_name' | 'venue' | 'sent_on' | 'replied_at' | 'material_due' | 'upload_on' | 'post_url' | 'answers' | 'sales_info' | 'note' | 'image_use'>
export function compareLines(rows: CompareRow[]): CompareLine[] {
  const base: [string, string, (r: CompareRow) => string | null | undefined][] = [
    ['stage', '단계', r => r.stage],
    ['event', '팝업 · 행사', r => r.event_name],
    ['venue', '장소', r => r.venue],
    ['sent', '발송일', r => r.sent_on],
    ['replied', '답 받은 날', r => r.replied_at?.slice(0, 10)],
    ['material', '자료 수령 예정', r => r.material_due],
    ['upload', '업로드 예정', r => r.upload_on],
    ['image', '이미지 사용', r => r.image_use],
    ['post', '게시 링크', r => r.post_url],
    ['note', '비고', r => r.note],
  ]
  const out: CompareLine[] = base.map(([key, label, get]) => ({ key, group: '기본', label, values: rows.map(r => (get(r) ?? '').trim()) }))
  for (const q of INTERVIEW_QUESTIONS) out.push({ key: q.no, group: '인터뷰 답', label: `${q.no} · ${q.label}`, sales: q.use === '영업', values: rows.map(r => (r.answers?.[q.no] ?? '').trim()) })
  for (const [k, label] of SALES_INFO_FIELDS) out.push({ key: `s_${k}`, group: '영업 정보', label, values: rows.map(r => (r.sales_info?.[k] ?? '').trim()) })
  return out
}
/** '다른 것만': 비교하는 브랜드끼리 값이 다르거나 일부만 답한 줄 · '답 있는 것만': 하나라도 값이 있는 줄 */
export function filterLines(lines: CompareLine[], mode: 'all' | 'filled' | 'diff'): CompareLine[] {
  if (mode === 'all') return lines
  const filled = lines.filter(l => l.values.some(v => v))
  if (mode === 'filled') return filled
  return filled.filter(l => new Set(l.values.map(v => v.replace(/\s+/g, ' ').toLowerCase())).size > 1)
}
/** 문항별로 모아 보기: 그 문항에 답한 브랜드만 · 글자 수 함께 */
export function answersFor<T extends Pick<SalesInterview, 'id' | 'brand' | 'answers'>>(rows: T[], qno: string): { row: T; text: string; chars: number }[] {
  return rows.map(row => ({ row, text: (row.answers?.[qno] ?? '').trim() })).filter(x => x.text).map(x => ({ ...x, chars: x.text.length }))
}
/** 한 브랜드 자료가 얼마나 모였는지 (답 n/10 · 영업 정보 n/5) */
export function completeness(r: Pick<SalesInterview, 'answers' | 'sales_info'>): { answers: number; sales: number } {
  return {
    answers: INTERVIEW_QUESTIONS.filter(q => (r.answers?.[q.no] ?? '').trim()).length,
    sales: SALES_INFO_FIELDS.filter(([k]) => (r.sales_info?.[k] ?? '').trim()).length,
  }
}
