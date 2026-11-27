// 한 번에 만들기 (2026-11-20 대표 지시 '콘텐츠 기획과 실행에 대한 실질적인 수행 방법 · 간단하게 자동화 · 실행 버튼 한 번에 광고가 만들어지고 배포까지')
// 알릴 내용 한 줄 → AI 한 번 호출로 기획 · 광고 문구 · 채널별 글(블로그 · 인스타 · 유튜브 · 홈페이지)을 함께 받음
// → 캠페인 · 광고 이미지(캔버스) · 콘텐츠 초안을 자동으로 만들고 → 대표 승인 한 번으로 인스타그램 게시.
// 여기는 순수 함수만 (요청문 · 결과 읽기 · 캠페인/콘텐츠 만들기). 시험: tests/auto-campaign.test.ts
import { WKLY_COPY_RULES } from './adCopy.ts'
import type { ChannelDraft, GrowthDraft } from './growth'
import type { MarketingBrand, MarketingCampaign } from './marketing'
import type { VideoEditInput, VideoTemplate } from './videoEdits'

export interface AutoInput {
  /** 무엇을 알릴지 (한두 줄) */
  topic: string
  brand: MarketingBrand
  /** 연결할 주소 (없으면 회사 기본) */
  link: string
  /** 기간 (없으면 오늘부터 7일) */
  startDate: string
  endDate: string
  /** 더 알려 줄 사실 (날짜 · 장소 · 혜택 등 · 선택) */
  facts: string
  /** 네이버 크리에이터샵 · 쇼핑커넥트 주소 (있으면 블로그 글 끝에 자동으로 붙임 · 선택) */
  shopUrl?: string
  /** 분석에서 고른 참고 자료 (형식 · 관점만 참고 · 사실로 쓰지 않음 · 선택) */
  reference?: string
}

/** 카드뉴스 한 장 (인스타그램 캐러셀) */
export interface CardSlide { title: string; body: string }

export interface AutoResult {
  title: string
  audience: string
  insight: string
  kicker: string
  headline: string
  primaryText: string
  description: string
  cta: string
  blog: { title: string; body: string }
  instagram: { caption: string; tags: string }
  youtube: { title: string; body: string }
  homepage: { title: string; body: string }
  /** 카드뉴스 본문 장 (표지 · 마지막 장은 따로 그림) 3~7장 */
  slides: CardSlide[]
}

export const AUTO_BRAND_LABEL: Record<MarketingBrand, string> = { wkly: '더위클리 (팝업 · 공간 대관 · 매거진)', arterior: '아트리어 (인테리어 · 공간 디자인 · 시공)' }
export const AUTO_DEFAULT_LINK: Record<MarketingBrand, string> = { wkly: 'https://www.thewklyn.com/', arterior: 'https://arteriors.co.kr/' }

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\r/g, '').trim().slice(0, n) : '')

/** AI 요청문 — 한 번에 기획 · 광고 문구 · 채널 4개 글을 JSON 으로 (growth-ai 요청 6,000자 한도 안) */
export function autoCampaignPrompt(input: AutoInput): string {
  const facts = clip(input.facts, 1200)
  return [
    `회사: ${AUTO_BRAND_LABEL[input.brand]}`,
    `알릴 내용: ${clip(input.topic, 500)}`,
    facts ? `확인된 사실(이것만 사실로 씀):\n${facts}` : '확인된 사실: 위 알릴 내용뿐 — 날짜 · 가격 · 실적 · 숫자를 지어내지 말고 필요하면 [확인 필요]로 적는다.',
    ...(clip(input.reference, 700) ? [`참고한 분석 자료(요즘 반응이 좋은 주제 · 형식 · 관점만 참고한다. 여기 적힌 숫자 · 날짜 · 남의 브랜드 이야기를 우리 사실처럼 쓰지 않고, 문장을 베끼지 않는다):\n${clip(input.reference, 700)}`] : []),
    `연결 주소: ${clip(input.link, 300) || AUTO_DEFAULT_LINK[input.brand]}`,
    `기간: ${input.startDate || '미정'} ~ ${input.endDate || '미정'}`,
    '',
    WKLY_COPY_RULES,
    '',
    '[할 일] 위 내용으로 인스타그램 · 페이스북 광고 1건과 채널별 글 4개를 한 번에 만든다.',
    '- 광고: 제목 40자 이내 · 본문 첫 줄 125자 안에 핵심 · 행동 유도 10자 이내 · 이미지 위 작은 글(kicker) 15자 이내',
    '- 블로그(네이버 검색 · 홈피드 노출 기준): 사람들이 실제로 검색할 핵심 낱말 하나를 정해 제목 앞쪽에 넣고 본문에 자연스럽게 3~5번(억지 반복 금지) · 제목 30자 안팎 · 본문 1,500~2,500자 · 소제목 3~4개 · 직접 겪은 장면 · 현장 사진 자리를 [사진: 무엇] 으로 표시 · 다른 글 베끼기 · 낱말 나열 금지 · 마지막 줄에 연결 주소',
    '- 인스타그램: 캡션 600자 이내 · 첫 줄이 후킹 · 줄바꿈으로 읽기 쉽게 · 태그는 # 붙여 8~15개',
    '- 유튜브: 영상 제목 50자 이내 + 설명 400자 이내 (영상은 사람이 올림)',
    '- 홈페이지: 소식 글 제목 + 본문 400~800자 (차분한 공지 말투)',
    '- 카드뉴스(인스타 캐러셀): 표지 다음에 넣을 본문 장 4~6개. 한 장에 한 가지 말 — 제목 18자 이내 + 설명 70자 이내. 첫 장은 담당자의 문제 장면, 가운데는 해결 · 근거, 마지막 본문 장은 정리.',
    '',
    '[답 형식] 설명 없이 아래 JSON 하나만 출력한다. 값은 모두 한국어 문자열.',
    '{"title":"캠페인 이름(30자)","audience":"누구에게(60자)","insight":"그 사람이 지금 겪는 상황 한 줄","kicker":"","headline":"","primaryText":"","description":"보조 문구(30자)","cta":"",',
    '"blog":{"title":"","body":""},"instagram":{"caption":"","tags":""},"youtube":{"title":"","body":""},"homepage":{"title":"","body":""},"slides":[{"title":"","body":""}]}',
  ].join('\n').slice(0, 5800)
}

/** AI 답에서 JSON 을 꺼내 정리 (앞뒤 설명 · ```json 울타리가 있어도 됨). 필수 칸이 비면 null */
export function parseAutoResult(text: string): AutoResult | null {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: Record<string, any>
  try { raw = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  const o = (v: unknown) => (v && typeof v === 'object' ? v as Record<string, unknown> : {})
  const r: AutoResult = {
    title: clip(raw.title, 60), audience: clip(raw.audience, 120), insight: clip(raw.insight, 200),
    kicker: clip(raw.kicker, 30), headline: clip(raw.headline, 80), primaryText: clip(raw.primaryText, 600),
    description: clip(raw.description, 90), cta: clip(raw.cta, 20),
    blog: { title: clip(o(raw.blog).title, 200), body: clip(o(raw.blog).body, 9000) },
    instagram: { caption: clip(o(raw.instagram).caption, 2000), tags: clip(o(raw.instagram).tags, 450) },
    youtube: { title: clip(o(raw.youtube).title, 100), body: clip(o(raw.youtube).body, 4000) },
    homepage: { title: clip(o(raw.homepage).title, 200), body: clip(o(raw.homepage).body, 9000) },
    slides: (Array.isArray(raw.slides) ? raw.slides : []).map((x: unknown) => ({ title: clip(o(x).title, 40), body: clip(o(x).body, 160) })).filter((x: CardSlide) => x.title || x.body).slice(0, 7),
  }
  if (!r.headline || !r.primaryText || !r.instagram.caption) return null
  if (!r.title) r.title = r.headline.slice(0, 30)
  if (!r.cta) r.cta = '자세히 보기'
  return r
}

/** 기간 기본값: 오늘(한국 시각)부터 7일 */
export function autoDates(today: string): { startDate: string; endDate: string } {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 6)
  return { startDate: today, endDate: d.toISOString().slice(0, 10) }
}

/** 기본 캠페인 위에 AI 결과를 얹음 — 예산은 비워 둠(광고비는 사람이 정함) · 검토 표시는 꺼 둠 */
export function autoCampaign(base: MarketingCampaign, input: AutoInput, r: AutoResult): MarketingCampaign {
  const link = clip(input.link, 500) || AUTO_DEFAULT_LINK[input.brand]
  return {
    ...base,
    title: r.title, brand: input.brand, platform: 'meta', goal: 'leads',
    landingUrl: link, sourceUrl: link, audience: r.audience || base.audience,
    offer: clip(input.topic, 300), headline: r.headline, primaryText: r.primaryText, description: r.description, cta: r.cta,
    startDate: input.startDate || base.startDate, endDate: input.endDate || base.endDate,
    seasonNote: r.insight, dailyBudget: null, totalBudget: null,
    reviews: { content: false, rights: false, budget: false }, status: 'draft',
  }
}

/** 이미지 위 글 */
export const autoAdText = (r: AutoResult) => ({ kicker: r.kicker, headline: r.headline, sub: r.description, cta: r.cta })

/** 콘텐츠 초안 (4채널 · 모두 '초안' · 사용 권리 확인은 승인 때) */
export function autoContentDraft(base: GrowthDraft, input: AutoInput, r: AutoResult, campaignId: string): GrowthDraft {
  const v = (channel: ChannelDraft['channel'], title: string, body: string, tags = ''): ChannelDraft =>
    ({ channel, title: title.slice(0, 300), body: body.slice(0, 10000), tags: tags.slice(0, 500), status: '초안', rights: false, publication_url: '', external_id: '' })
  const link = clip(input.link, 500) || AUTO_DEFAULT_LINK[input.brand]
  return {
    ...base,
    title: `[한 번에 만들기] ${r.title}`.slice(0, 200),
    campaign_id: campaignId,
    document: {
      ...base.document,
      division: input.brand === 'arterior' ? 'AR' : 'TW',
      source_url: link,
      original: [clip(input.topic, 2000), clip(input.facts, 4000)].filter(Boolean).join('\n\n'),
      note: `한 번에 만들기로 AI 가 만든 초안 · 대상: ${r.audience} · 상황: ${r.insight}`.slice(0, 2000),
      versions: [
        v('네이버 블로그', r.blog.title, blogWithShop(r.blog.body, input.shopUrl)),
        v('인스타그램', r.headline, r.instagram.caption, r.instagram.tags),
        v('유튜브', r.youtube.title, r.youtube.body),
        v('홈페이지', r.homepage.title, r.homepage.body),
      ],
    },
  }
}

/** 릴스 편집도 함께 요청 (2026-11-27 · 사람이 촬영 폴더를 골랐을 때만) — 캠페인과 같은 말로 자막이 나가도록 지시를 만든다.
 *  자막은 14자 안팎이라 문장을 그대로 넣지 않고 '무엇을 말하는 영상인지'만 넘긴다. 게시는 사람이 한다. */
export interface AutoReelOption { folder: string; template: VideoTemplate; seconds: number }
export function autoReelRequest(r: AutoResult, opt: AutoReelOption): VideoEditInput {
  const points = r.slides.map(s => s.title).filter(Boolean).slice(0, 5)
  const instructions = [
    `이 영상은 캠페인 '${r.title}' 와 함께 나갑니다.`,
    `보는 사람: ${r.audience || '팝업 · 공간을 찾는 브랜드 담당자'}`,
    `첫 자막(궁금하게 · 14자 안팎으로 줄여서): ${r.headline}`,
    ...(points.length ? [`가운데 장면에서 보여 줄 것: ${points.join(' · ')}`] : []),
    '자막에는 화면에 보이는 사실만 씁니다. 위 문장의 날짜 · 가격 · 숫자는 자막에 옮기지 않습니다.',
  ].join('\n').slice(0, 2000)
  return { title: `[릴스] ${r.title}`.slice(0, 120), source_folder: opt.folder, template: opt.template, instructions, target_seconds: opt.seconds }
}

/** 블로그 글 끝에 크리에이터샵 · 쇼핑커넥트 안내 한 줄 (주소가 있을 때만 · 이미 들어 있으면 그대로) */
export function blogWithShop(body: string, shopUrl?: string): string {
  const url = clip(shopUrl, 300)
  if (!url || !/^https:\/\//.test(url) || body.includes(url)) return body
  return `${body.trimEnd()}\n\n▶ 소개한 제품 · 공간 모아 보기 (네이버 크리에이터샵): ${url}`
}

/** 승인: 인스타그램 버전만 승인 · 사용 권리 확인 (다른 채널은 사람이 붙여 넣고 발행 주소를 적음) */
export function approveForInstagram(d: GrowthDraft): GrowthDraft {
  return { ...d, document: { ...d.document, versions: d.document.versions?.map(v => (v.channel === '인스타그램' ? { ...v, status: '승인', rights: true } : v)) } }
}

/** 사람이 직접 올리는 채널의 글쓰기 창 */
export const MANUAL_POST_URL: Record<'네이버 블로그' | '유튜브' | '홈페이지', string> = {
  '네이버 블로그': 'https://blog.naver.com/GoBlogWrite.naver',
  '유튜브': 'https://studio.youtube.com/',
  '홈페이지': 'https://imweb.me/',
}
