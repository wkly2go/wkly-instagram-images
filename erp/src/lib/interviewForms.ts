// 인터뷰지 (2026-11-19 대표 지시 '인터뷰지 db 작업 시작해') — 구글 폼을 대신하는 브랜드별 인터뷰지
// 질문 은행(sales_interview_questions)의 기본 문안에 브랜드 · 팝업 · 기간 · 장소를 채워 인터뷰지(sales_interview_forms)를 만든다.
// 브랜드 담당자는 링크(/i/<토큰>)로 로그인 없이 답한다. 서버 규칙(interview_form_submit)과 같은 검사를 화면에서도 미리 한다.
export type QuestionKind = 'long' | 'choice'
export interface BankQuestion { id: string; slot: string; section: string; title: string; body: string; help: string; kind: QuestionKind; options: string[]; use: '콘텐츠' | '영업'; required: boolean; variant: string; is_default: boolean; active: boolean; sort: number }
/** 인터뷰지 안의 질문 한 개 — 만들 때의 글 그대로 보관한다(은행 문안을 나중에 고쳐도 보낸 인터뷰지는 안 바뀜) */
export interface FormQuestion { no: string; section: string; title: string; body: string; help: string; kind: QuestionKind; options: string[]; required: boolean; use: '콘텐츠' | '영업' }
export type FormStatus = '작성 중' | '열림' | '제출' | '닫힘'
export interface InterviewForm { id: string; interview_id: string; token: string; title: string; intro: string; due_on: string | null; upload_on: string | null; questions: FormQuestion[]; status: FormStatus; opened_at: string | null; first_seen_at: string | null; submitted_at: string | null; answers: Record<string, string>; respondent: string | null; respondent_contact: string | null; image_consent: string | null; updated_at: string }
export type BankQuestionDraft = Omit<BankQuestion, 'id'>
export type InterviewFormPatch = Partial<Pick<InterviewForm, 'title' | 'intro' | 'due_on' | 'upload_on' | 'questions' | 'status'>>
export interface FormContext { brand: string; popup: string; period: string; place: string }

/** 답 권장 길이 (지금 구글 폼 안내와 같음 · 강제하지 않음) */
export const ANSWER_HINT_CHARS = 150
export const ANSWER_MAX_CHARS = 5000
const slotNo = (s: string) => Number(s.replace(/\D/g, '')) || 0

// 토씨 고르기: 채운 말 바로 뒤의 '은(는)' · '을(를)' · '이(가)' · '과(와)' 를 끝 글자 받침에 맞춘다. 한글로 끝나지 않으면(영문 · 숫자) 그대로 둔다
const PARTICLES: Record<string, [string, string]> = { '은(는)': ['은', '는'], '을(를)': ['을', '를'], '이(가)': ['이', '가'], '과(와)': ['과', '와'], '와(과)': ['과', '와'] }
function particle(word: string, pair: string): string {
  const code = word.trim().slice(-1).charCodeAt(0)
  if (!(code >= 0xac00 && code <= 0xd7a3)) return pair
  return PARTICLES[pair][(code - 0xac00) % 28 ? 0 : 1]
}
/** {브랜드} · {팝업} · {기간} · {장소} 채우기. 값이 없으면 자리 표시를 남겨 고칠 곳이 보이게 한다 */
export function fillTemplate(text: string, c: FormContext): string {
  const v: Record<string, string> = { 브랜드: c.brand, 팝업: c.popup, 기간: c.period, 장소: c.place }
  return text
    .replace(/\{(브랜드|팝업|기간|장소)\}(은\(는\)|을\(를\)|이\(가\)|과\(와\)|와\(과\))?/g, (m, k: string, pair?: string) => {
      const word = v[k]?.trim()
      return word ? word + (pair ? particle(word, pair) : '') : m
    })
    .replace(/[ \t]{2,}/g, ' ').trim()
}
/** 아직 채우지 못한 자리 표시 */
export const unfilled = (text: string) => [...new Set(text.match(/\{(브랜드|팝업|기간|장소)\}/g) ?? [])]

/** 서면 인터뷰의 '장소 · 일정' 한 칸(예: 더현대 서울 B2 · 11/5~11/11)을 장소와 기간으로 나눈다 — 날짜가 든 토막이 기간 */
export function contextOf(row: { brand: string; event_name: string | null; venue: string | null }): FormContext {
  const parts = (row.venue ?? '').split(/\s*[·|]\s*|\s{2,}/).map(x => x.trim()).filter(Boolean)
  const isDate = (x: string) => /\d{1,2}\s*[/.월]\s*\d{1,2}|\d{1,2}\s*일|~/.test(x)
  return { brand: row.brand.trim(), popup: (row.event_name ?? '').trim(), period: parts.filter(isDate).join(' '), place: parts.filter(x => !isDate(x)).join(' ') }
}
/** 브랜드에게 링크와 함께 보낼 짧은 안내 글 (사람이 메일 · DM 에 붙여 보냄 · 인트라넷이 보내지 않음) */
export function shareText(f: Pick<InterviewForm, 'title' | 'due_on'>, url: string): string {
  return [f.title, '', '아래 링크에서 바로 작성하실 수 있습니다. 로그인은 필요 없고, 쓰던 내용은 같은 기기에서 이어서 쓸 수 있습니다.', url, f.due_on ? `\n답변 수령 희망일: ${md(f.due_on)}` : ''].filter((x, i) => x || i === 1).join('\n').trim()
}
/** 질문 은행에서 자리마다 한 문안: 고른 문안(picks: 자리 → 은행 id)이 있으면 그것, 없으면 기본 */
export function pickQuestions(bank: BankQuestion[], picks: Record<string, string> = {}): BankQuestion[] {
  const live = bank.filter(q => q.active)
  const slots = [...new Set(live.map(q => q.slot))].sort((a, b) => slotNo(a) - slotNo(b))
  return slots.flatMap(slot => {
    const of = live.filter(q => q.slot === slot)
    const q = of.find(x => x.id === picks[slot]) ?? of.find(x => x.is_default) ?? of.sort((a, b) => a.sort - b.sort)[0]
    return q ? [q] : []
  })
}
export const toFormQuestion = (q: BankQuestion, c: FormContext): FormQuestion => ({ no: q.slot, section: q.section, title: q.title, body: fillTemplate(q.body, c), help: q.help, kind: q.kind, options: q.kind === 'choice' ? [...q.options] : [], required: q.required, use: q.use })

const md = (d: string | null | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? ''); return m ? `${m[1]}.${m[2]}.${m[3]}` : '' }
/** 맨 위 안내문 기본 글 (지금 쓰는 구글 폼 안내의 뜻 그대로). 답변 수령 희망일 · 업로드 예정일은 글에 적지 않는다 — 화면이 날짜 칸에서 따로 보여 준다 */
export function defaultIntro(c: FormContext): string {
  return [
    `더위클리(THE WKLY) 팝업 큐레이션 콘텐츠를 위한 서면 인터뷰입니다. ${c.brand}의 브랜드 철학과 ${c.popup || '이번 팝업'}의 기획 의도, 방문객 경험을 기록하려 합니다.`,
    '보내 주신 답은 더위클리 공식 SNS · 홈페이지 콘텐츠와 아카이브에 쓰입니다. 예산과 파트너 선정 기준에 관한 답은 내부 참고용으로만 쓰며 콘텐츠에 싣지 않습니다.',
    `'필수' 표시가 없는 질문은 선택입니다. 답은 질문마다 공백 포함 ${ANSWER_HINT_CHARS}자 이상을 권합니다. 내용이 짧으면 인스타그램에는 올라가도 홈페이지 인터뷰에는 실리지 않을 수 있습니다.`,
  ].filter(Boolean).join('\n\n')
}
/** 인터뷰 한 건 + 질문 은행 → 인터뷰지 초안 (저장 전) */
export function buildForm(c: FormContext, bank: BankQuestion[], opts: { dueOn?: string | null; uploadOn?: string | null; picks?: Record<string, string> } = {}) {
  const questions = pickQuestions(bank, opts.picks).map(q => toFormQuestion(q, c))
  return { title: `[더위클리] ${c.brand} 팝업 큐레이션 콘텐츠 인터뷰지`.slice(0, 200), intro: defaultIntro(c), due_on: opts.dueOn ?? null, upload_on: opts.uploadOn ?? null, questions }
}
/** 보내기 전에 볼 것: 질문 없음 · 자리 표시가 남음 · 고르기 문항에 보기 없음 */
export function formProblems(f: Pick<InterviewForm, 'title' | 'intro' | 'questions'>): string[] {
  const out: string[] = []
  if (!f.title.trim()) out.push('제목이 비어 있습니다')
  if (!f.questions.length) out.push('질문이 없습니다')
  const left = [...new Set([...unfilled(f.title), ...unfilled(f.intro), ...f.questions.flatMap(q => unfilled(q.body))])]
  if (left.length) out.push(`채우지 않은 자리가 있습니다: ${left.join(' ')}`)
  for (const q of f.questions) {
    if (!q.body.trim()) out.push(`${q.no} 질문 글이 비어 있습니다`)
    const loose = q.body.match(/은\(는\)|을\(를\)|이\(가\)|과\(와\)|와\(과\)/)
    if (loose) out.push(`${q.no} 토씨를 골라 주세요: ${loose[0]}`)
    if (q.kind === 'choice' && q.options.length < 2) out.push(`${q.no} 고르기 문항에 보기가 2개 이상 있어야 합니다`)
  }
  if (new Set(f.questions.map(q => q.no)).size !== f.questions.length) out.push('질문 번호가 겹칩니다')
  return out
}
/** 답 검사 (서버 interview_form_submit 과 같은 규칙) — 문제 없으면 보낼 답만 추려 준다 */
export function checkAnswers(questions: FormQuestion[], raw: Record<string, string>): { ok: true; answers: Record<string, string> } | { ok: false; no: string; message: string } {
  const answers: Record<string, string> = {}
  for (const q of questions) {
    const a = (raw[q.no] ?? '').trim()
    if (a.length > ANSWER_MAX_CHARS) return { ok: false, no: q.no, message: `${q.no} 문항의 답이 너무 깁니다 (${ANSWER_MAX_CHARS.toLocaleString('ko-KR')}자까지)` }
    if (!a && q.required) return { ok: false, no: q.no, message: `${q.no} 문항은 필수입니다. 답을 적어 주세요.` }
    if (a && q.kind === 'choice' && !q.options.includes(a)) return { ok: false, no: q.no, message: `${q.no} 문항은 보기 가운데 하나를 골라 주세요.` }
    if (a) answers[q.no] = a
  }
  if (!Object.keys(answers).length) return { ok: false, no: questions[0]?.no ?? '', message: '답을 한 개 이상 적어 주세요' }
  return { ok: true, answers }
}
/** 권장 길이에 못 미친 서술형 답 (경고만) */
export const shortAnswers = (questions: FormQuestion[], answers: Record<string, string>) => questions.filter(q => q.kind === 'long' && (answers[q.no] ?? '').trim() && (answers[q.no] ?? '').trim().length < ANSWER_HINT_CHARS).map(q => q.no)
/** 브랜드 담당자에게 보내는 링크 */
export const formPath = (token: string) => `/i/${token}`
export const SUBMIT_REASONS: Record<string, string> = { not_found: '인터뷰지를 찾지 못했습니다. 받으신 링크를 다시 확인해 주세요.', closed: '답변 접수가 끝난 인터뷰지입니다. 고칠 내용은 담당자에게 알려 주세요.', too_many: '여러 번 제출해 잠시 막혔습니다. 담당자에게 알려 주세요.', required: '필수 문항이 비어 있습니다.', bad_choice: '고르기 문항은 보기 가운데 하나를 골라 주세요.', too_long: '답이 너무 깁니다.', empty: '답을 한 개 이상 적어 주세요.', bad_answers: '답을 읽지 못했습니다. 다시 시도해 주세요.' }
/** 질문 은행 기본 문안 (운영 DB 의 처음 문안과 같은 글 · 체험 모드와 시험에서 씀 · 운영은 표 sales_interview_questions 를 읽는다) */
export const DEMO_INTERVIEW_QUESTIONS: BankQuestion[] = [
  {"id": "seed-Q1", "slot": "Q1", "section": "브랜드 철학 및 팝업 기획 의도", "title": "브랜드 소개 · 철학", "body": "{브랜드}은(는) 어떤 브랜드인가요? 브랜드를 대표하는 컬러와 브랜딩(로고 · 네이밍 · 비주얼)에 담긴 의미, 가장 중요하게 생각하는 철학과 지향하는 방향을 자유롭게 적어 주세요.", "help": "예: 브랜드가 시작된 배경, 핵심 가치, 고객에게 주고 싶은 경험", "kind": "long", "options": [], "use": "콘텐츠", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 1},
  {"id": "seed-Q2", "slot": "Q2", "section": "브랜드 철학 및 팝업 기획 의도", "title": "팝업 기획 계기 · 공간을 고른 이유", "body": "{기간} {장소}에서 여는 {팝업}을(를) 기획하게 된 계기와 이 공간을 고른 이유는 무엇인가요? Q1의 브랜드 정체성을 이번 팝업에 어떻게 녹였는지도 함께 들려주세요.", "help": "예: 컬러 활용, 공간 구성과 장면 연출, 소품 · 제품 구성", "kind": "long", "options": [], "use": "콘텐츠", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 2},
  {"id": "seed-Q3", "slot": "Q3", "section": "공간 구성 및 체험 연출", "title": "전체 예산 규모", "body": "이번 팝업의 전체 예산 규모(공간 임차 · 기획 · 시공 · 운영 포함)를 공유 가능한 범위에서 골라 주세요. 내부 참고용으로만 쓰며 콘텐츠에 싣지 않습니다.", "help": "", "kind": "choice", "options": ["1,500만원 미만", "1,500만원 이상 ~ 3,000만원 미만", "3,000만원 이상 ~ 5,000만원 미만", "5,000만원 이상 ~ 7,000만원 미만", "7,000만원 이상 ~ 1억원 미만", "1억원 이상"], "use": "영업", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 3},
  {"id": "seed-Q4", "slot": "Q4", "section": "공간 구성 및 체험 연출", "title": "공간 구현의 중점 요소 · 키 포인트 공간", "body": "{팝업}의 콘셉트를 공간에 구현할 때 가장 중점을 둔 요소(레이아웃 · 컬러 · 세트와 소품 · 조명 등)는 무엇인가요? 제작 기간 · 시공 방식 · 공간 조건 때문에 조정한 부분과, {브랜드}의 정체성이 가장 잘 드러나는 키 포인트 공간(Key Space)도 소개해 주세요.", "help": "", "kind": "long", "options": [], "use": "콘텐츠", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 4},
  {"id": "seed-Q5", "slot": "Q5", "section": "공간 구성 및 체험 연출", "title": "방문객 동선 · 체류 · 촬영", "body": "방문객이 공간을 둘러보고 체험하는 동선은 어떻게 설계했나요? 구역 순서와 체류 시간, 포토존과 촬영 허용 범위를 정한 기준이 있다면 알려 주세요.", "help": "예: 동선 방향, 구역별 소요 시간, 포토존 배치, 대기 인원 관리", "kind": "long", "options": [], "use": "콘텐츠", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 5},
  {"id": "seed-Q6", "slot": "Q6", "section": "마케팅 및 고객 접점", "title": "제품 · 콘텐츠와 팝업 콘셉트의 연결", "body": "제품(또는 콘텐츠) 소개를 팝업 콘셉트와 어떻게 연결했나요? 노출 위치와 비중을 정한 기준, 방문객의 이해와 구매로 이어지게 하는 장치가 있다면 소개해 주세요.", "help": "예: SNS 사전 공개, 현장 이벤트, 구매 혜택", "kind": "long", "options": [], "use": "콘텐츠", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 6},
  {"id": "seed-Q7", "slot": "Q7", "section": "마케팅 및 고객 접점", "title": "현장 운영 · 협업", "body": "방문객이 몰리는 시간대의 현장 운영(입장 접수 · 대기 안내 · 인원 관리)과 운영 인력 구성, 안전 관리는 어떻게 준비했나요? 함께한 파트너가 있다면 역할을 어떻게 나눴는지도 알려 주세요.", "help": "", "kind": "long", "options": [], "use": "콘텐츠", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 7},
  {"id": "seed-Q8", "slot": "Q8", "section": "인사이트 및 향후 비전", "title": "방문객 반응 · 운영 중 조정", "body": "운영하면서 예상과 달랐던 방문객 반응이나 변수는 무엇이었고, 그에 따라 보완하거나 조정한 부분이 있나요? 이번 팝업에서 기대하는 전환점도 함께 들려주세요.", "help": "", "kind": "long", "options": [], "use": "콘텐츠", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 8},
  {"id": "seed-Q9", "slot": "Q9", "section": "인사이트 및 향후 비전", "title": "실무자에게 주는 조언", "body": "팝업을 준비하는 실무자(공간 디자이너 · 마케터)에게 기획 · 제작 · 오픈 일정과 사전 점검 항목을 중심으로 조언을 부탁드립니다. 준비하면서 가장 어려웠던 점과 해결한 방법도 알려 주세요.", "help": "", "kind": "long", "options": [], "use": "콘텐츠", "required": false, "variant": "기본", "is_default": true, "active": true, "sort": 9},
  {"id": "seed-Q10", "slot": "Q10", "section": "인사이트 및 향후 비전", "title": "향후 계획 · 파트너 선정 기준", "body": "{브랜드}의 추가 팝업 등 앞으로의 오프라인 전개 방향과, 기획사 · 대행사 · 협업 파트너를 고를 때 가장 중요하게 보는 기준을 알려 주세요.", "help": "", "kind": "long", "options": [], "use": "영업", "required": true, "variant": "기본", "is_default": true, "active": true, "sort": 10},
]
