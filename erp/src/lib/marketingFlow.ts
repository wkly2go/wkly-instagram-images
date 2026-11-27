// 마케팅 자동화 한 화면 흐름의 순수 규칙 (2026-11-27 대표 지시 '마케팅 자동화 프로그램 · 자동화 기획서를 바탕으로 제작')
//  분석 → 제작 → 승인 · 배포 → 광고 → 문의 → 수주. 숫자는 DB 함수 marketing_flow() 가 한 번에 준다 (AI 없음)
//  원칙(같은 날 대표 지시): 제작은 사람이 원할 때만 · CRM 은 고객 요청 · 문의가 있을 때만 → 이 화면은 스스로 만들거나 보내지 않고 '지금 할 일'만 알려 준다
export type Counts = Record<string, number>
export interface MarketingFlow {
  at: string
  analyze: { competitor_posts_7d: number; competitors: number; research_7d: Counts; latest_trend: { id: string; title: string; at: string } | null }
  create: { campaigns_14d: number; campaign_status: Counts; ai_drafts: number; video: Counts }
  publish: { content_status: Counts; content_14d: number }
  ads: { settings: { mode: string; monthly_cap: number; daily_cap: number; kill_switch: boolean } | null; proposals: number; meta_drafts: Counts }
  inquiries: { total_30d: number; new: number; from_ads_30d: number; tagged_30d: number; direct_30d: number }
  deals: { linked_90d: number; by_status: Counts }
  by_campaign: { campaign: string; source: string; inquiries: number; direct: number; projects: number; won: number }[]
}
export type StepTone = 'ok' | 'todo' | 'idle'
export interface FlowStep { key: string; title: string; lines: string[]; todo: string | null; tone: StepTone; link: string; linkLabel: string }

const sum = (c: Counts | undefined) => Object.values(c ?? {}).reduce((a, b) => a + Number(b || 0), 0)
const n = (c: Counts | undefined, k: string) => Number(c?.[k] ?? 0)

/** 단계마다 숫자 두세 줄과 '지금 할 일' 한 줄. 할 일이 없으면 null */
export function flowSteps(f: MarketingFlow): FlowStep[] {
  const research = sum(f.analyze.research_7d)
  const waitingVideo = n(f.create.video, '대기') + n(f.create.video, '편집 중')
  const drafts = n(f.create.campaign_status, 'draft')
  const writing = n(f.publish.content_status, '작성 중')
  const review = n(f.publish.content_status, '검수 중') + n(f.publish.content_status, '검수 요청')
  const s = f.ads.settings
  const capsMissing = !s || !(s.monthly_cap > 0) || !(s.daily_cap > 0)
  const metaOn = n(f.ads.meta_drafts, '켜짐')
  const won = n(f.deals.by_status, '진행') + n(f.deals.by_status, '완료')
  const untagged = f.inquiries.total_30d - f.inquiries.tagged_30d
  return [
    { key: 'analyze', title: '분석', link: '/ads?tab=competitors', linkLabel: '경쟁사 · 트렌드 보기',
      lines: [`이번 주 리서치 자료 ${research}건`, `경쟁사 ${f.analyze.competitors}곳 · 새 글 ${f.analyze.competitor_posts_7d}건`],
      todo: research + f.analyze.competitor_posts_7d === 0 ? '이번 주 들어온 자료가 없습니다. 수집 상태를 확인하세요.' : null,
      tone: research + f.analyze.competitor_posts_7d === 0 ? 'todo' : 'ok' },
    { key: 'create', title: '제작', link: '/ads?tab=studio', linkLabel: '한 번에 만들기',
      lines: [`준비 중 캠페인 ${drafts}건`, `영상 편집 ${waitingVideo ? `진행 ${waitingVideo}건` : `완료 ${n(f.create.video, '완료')}건 (2주)`}`],
      todo: drafts > 0 ? `준비 중인 캠페인 ${drafts}건을 마무리하세요.` : null,
      tone: drafts > 0 ? 'todo' : f.create.campaigns_14d > 0 ? 'ok' : 'idle' },
    { key: 'publish', title: '승인 · 배포', link: '/ads?tab=content', linkLabel: '콘텐츠 · 배포',
      lines: [`작성 중 ${writing}건 · 검수 ${review}건`, `발행 ${n(f.publish.content_status, '발행')}건`],
      todo: review > 0 ? `검수를 기다리는 콘텐츠 ${review}건이 있습니다.` : writing > 0 ? `작성 중인 콘텐츠 ${writing}건이 있습니다.` : null,
      tone: review + writing > 0 ? 'todo' : n(f.publish.content_status, '발행') > 0 ? 'ok' : 'idle' },
    { key: 'ads', title: '광고', link: '/ads?tab=autopilot', linkLabel: '자동 운영',
      lines: [s ? `켜진 광고 ${metaOn}건 · 판단 대기 ${f.ads.proposals}건` : '설정은 관리자만 봅니다', s?.kill_switch ? '긴급 정지 켜짐' : capsMissing && s ? '월 · 하루 한도 미입력' : '한도 입력됨'],
      todo: !s ? null : f.ads.proposals > 0 ? `규칙 제안 ${f.ads.proposals}건을 승인 · 거절하세요.` : capsMissing ? '월 · 하루 한도를 넣어야 광고가 시작됩니다.' : null,
      tone: !s ? 'idle' : f.ads.proposals > 0 || capsMissing ? 'todo' : 'ok' },
    { key: 'inquiries', title: '문의', link: '/sales', linkLabel: '문의함',
      lines: [`30일 문의 ${f.inquiries.total_30d}건 (직접 ${f.inquiries.direct_30d})`, `광고 유입 ${f.inquiries.from_ads_30d}건 · 출처 모름 ${Math.max(0, untagged)}건`],
      todo: f.inquiries.new > 0 ? `답을 기다리는 새 문의 ${f.inquiries.new}건이 있습니다.` : null,
      tone: f.inquiries.new > 0 ? 'todo' : 'ok' },
    { key: 'deals', title: '수주', link: '/sales', linkLabel: '영업 · 수주',
      lines: [`문의에서 이어진 프로젝트 ${f.deals.linked_90d}건 (90일)`, `진행 · 완료 ${won}건`],
      todo: null, tone: won > 0 ? 'ok' : 'idle' },
  ]
}

/** 꼬리표가 붙은 문의 비율(%) — 낮으면 소재별 성과를 알 수 없다 */
export function taggedRate(f: MarketingFlow): number | null {
  return f.inquiries.total_30d > 0 ? Math.round((f.inquiries.tagged_30d / f.inquiries.total_30d) * 100) : null
}

// ── 대시보드 (숫자 띠 · 추이 그래프 · 출처 표) — DB 함수 marketing_flow_trend() ──
export interface FlowTrend {
  daily: { d: string; total: number; direct: number; ads: number }[]
  prev: { total: number; direct: number; ads: number; tagged: number }
  by_source: { source: string; inquiries: number; projects: number }[]
  by_kind: { kind: string; inquiries: number }[]
  week_start: string
  week: WeekItem[]
}
export interface WeekItem { id: string; type: 'content' | 'video'; title: string; status: string; at: string; channels: string[] }
export interface Kpi { key: string; label: string; value: string; delta: number | null; note: string }

/** 앞 30일과 견준 변화(%). 앞 기간이 0이면 견줄 수 없으므로 null */
export function deltaPct(now: number, prev: number | undefined): number | null {
  if (!prev || prev <= 0) return null
  return Math.round(((now - prev) / prev) * 100)
}

/** 맨 위 숫자 띠 여섯 칸 */
export function flowKpis(f: MarketingFlow, t: FlowTrend | null): Kpi[] {
  const i = f.inquiries
  const rate = taggedRate(f)
  const prevRate = t && t.prev.total > 0 ? Math.round((t.prev.tagged / t.prev.total) * 100) : null
  const won = n(f.deals.by_status, '진행') + n(f.deals.by_status, '완료')
  return [
    { key: 'total', label: '문의 (30일)', value: `${i.total_30d}`, delta: deltaPct(i.total_30d, t?.prev.total), note: '앞 30일 대비' },
    { key: 'direct', label: '직접 문의', value: `${i.direct_30d}`, delta: deltaPct(i.direct_30d, t?.prev.direct), note: '앞 30일 대비' },
    { key: 'ads', label: '광고 유입', value: `${i.from_ads_30d}`, delta: deltaPct(i.from_ads_30d, t?.prev.ads), note: '앞 30일 대비' },
    { key: 'tagged', label: '출처를 아는 문의', value: rate == null ? '–' : `${rate}%`, delta: rate != null && prevRate != null ? rate - prevRate : null, note: '앞 30일 대비 (%p)' },
    { key: 'new', label: '답 기다리는 문의', value: `${i.new}`, delta: null, note: i.new > 0 ? '문의함에서 응대' : '밀린 문의 없음' },
    { key: 'deals', label: '프로젝트로 이어짐', value: `${f.deals.linked_90d}`, delta: null, note: `90일 · 진행 · 완료 ${won}건` },
  ]
}

/** 추이 그래프 좌표 — 0~1 로 정규화한 점과 눈금 */
export function trendScale(daily: FlowTrend['daily']): { max: number; ticks: number[] } {
  const peak = Math.max(1, ...daily.map(x => x.total))
  const step = peak <= 4 ? 1 : peak <= 10 ? 2 : peak <= 25 ? 5 : peak <= 50 ? 10 : Math.ceil(peak / 5 / 10) * 10
  const max = Math.ceil(peak / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= max; v += step) ticks.push(v)
  return { max, ticks }
}

/** 막대 폭(%) — 가장 큰 값이 100 */
export function shareWidths(values: number[]): number[] {
  const top = Math.max(0, ...values)
  return values.map(v => (top > 0 ? Math.max(2, Math.round((v / top) * 100)) : 0))
}

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일']
export interface WeekDay { date: string; name: string; day: number; today: boolean; items: WeekItem[] }

/** 이번 주 월~일 일곱 칸. 항목은 한국 날짜 기준으로 그날 칸에 */
export function weekDays(t: FlowTrend, nowMs: number): WeekDay[] {
  const kst = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
  const start = Date.parse(`${t.week_start}T00:00:00Z`)
  const today = kst(nowMs)
  return DAY_NAMES.map((name, i) => {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    return { date, name, day: Number(date.slice(8)), today: date === today, items: t.week.filter(w => kst(Date.parse(w.at)) === date) }
  })
}
