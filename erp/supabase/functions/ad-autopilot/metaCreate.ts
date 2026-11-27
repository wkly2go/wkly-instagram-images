// 인트라넷 광고 캠페인(marketing_campaigns.document) → 메타 광고 만들기 값 (2026-11-21 대표 지시 '모든 광고와 마케팅은 메타로')
//  - 순수 함수만 (네트워크 없음 · 시험 tests/ad-meta-create.test.ts)
//  - 만든 광고는 늘 '멈춤(PAUSED)'으로 시작 — 켜는 것은 대표 승인(meta_launch) 뒤
//  - 목표: 문의 · 유입 → 링크 클릭(OUTCOME_TRAFFIC) · 인지도 → 도달(OUTCOME_AWARENESS)
//    (문의 양식(리드 폼) 광고는 메타 안 양식이 필요해 아직 쓰지 않음 — 홈페이지 문의로 보냄)

export interface CampaignDoc {
  title: string
  brand: 'wkly' | 'arterior'
  goal: 'leads' | 'traffic' | 'awareness'
  platform: string
  landingUrl: string
  headline: string
  primaryText: string
  description: string
  cta: string
  startDate: string
  endDate: string
  dailyBudget: number | null
  totalBudget: number | null
  status: string
}
export interface MetaIds { pageId: string; igUserId: string | null }
export interface MetaSpec {
  campaign: Record<string, string>
  adset: Record<string, string>
  /** link_data 의 image_hash 자리는 '{{hashes}}' — 받은 이미지 해시로 채움 */
  creative: (hashes: string[]) => Record<string, string>
  ad: (adsetId: string, creativeId: string) => Record<string, string>
  dailyBudget: number | null
}

const CTA: [RegExp, string][] = [
  [/문의|상담|연락/, 'CONTACT_US'],
  [/신청|가입|등록/, 'SIGN_UP'],
  [/예약/, 'BOOK_NOW'],
  [/구매|주문|쇼핑/, 'SHOP_NOW'],
  [/다운|받기/, 'DOWNLOAD'],
  [/구독/, 'SUBSCRIBE'],
]
/** 화면의 행동 유도 글 → 메타 버튼 종류 (모르면 '더 알아보기') */
export function metaCta(text: string): string {
  for (const [re, v] of CTA) if (re.test(text)) return v
  return 'LEARN_MORE'
}

const todayKst = (now: Date) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** 만들기 전에 막을 것 — 문장 목록 (비면 만들 수 있음) */
export function metaProblems(doc: CampaignDoc, ids: Partial<MetaIds>, images: number, now = new Date()): string[] {
  const out: string[] = []
  if (doc.platform !== 'meta') out.push("매체가 '메타'인 캠페인만 메타 광고로 만들 수 있습니다.")
  if (doc.status !== 'ready') out.push("캠페인을 '준비 완료'로 저장한 뒤 만들 수 있습니다.")
  if (!/^https:\/\//.test(doc.landingUrl.trim())) out.push('연결 주소(랜딩)가 https:// 로 시작해야 합니다.')
  if (!doc.primaryText.trim()) out.push('광고 본문이 비어 있습니다.')
  if (!doc.headline.trim()) out.push('광고 제목이 비어 있습니다.')
  if (images < 1) out.push('광고 이미지(JPG · PNG)를 1장 이상 올려 주세요.')
  if (images > 10) out.push('이미지는 10장까지 쓸 수 있습니다.')
  if (!doc.dailyBudget && !(doc.totalBudget && doc.endDate)) out.push('하루 예산, 또는 총예산과 종료일을 정해 주세요.')
  if (doc.dailyBudget != null && doc.dailyBudget < 1000) out.push('하루 예산은 1,000원 이상이어야 합니다.')
  if (doc.endDate && doc.endDate < todayKst(now)) out.push('종료일이 이미 지났습니다.')
  if (!ids.pageId) out.push('메타 광고에 쓸 페이스북 페이지 번호가 없습니다. 자동 운영 › 연결에서 넣어 주세요.')
  return out
}

/** 광고가 보내는 주소에 꼬리표(UTM)를 붙인다 — 어느 광고에서 온 문의인지 알기 위해. 이미 붙어 있으면 그대로 */
export function adLink(doc: Pick<CampaignDoc, 'landingUrl' | 'title'>): string {
  const raw = doc.landingUrl.trim()
  try {
    const url = new URL(raw)
    if (url.searchParams.has('utm_source')) return raw
    const campaign = doc.title.trim().replace(/\[[^\]]*\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'ad'
    url.searchParams.set('utm_source', 'meta')
    url.searchParams.set('utm_medium', 'paid_social')
    url.searchParams.set('utm_campaign', campaign)
    return url.toString()
  } catch { return raw }
}

export function buildMetaSpec(doc: CampaignDoc, ids: MetaIds, now = new Date()): MetaSpec {
  const awareness = doc.goal === 'awareness'
  const name = `[인트라넷] ${doc.title}`.slice(0, 200)
  const today = todayKst(now)
  const adset: Record<string, string> = {
    name: `${name} · 기본`.slice(0, 200),
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: awareness ? 'REACH' : 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: JSON.stringify({
      geo_locations: { countries: ['KR'] },
      age_min: 20,
      targeting_automation: { advantage_audience: 1 },
    }),
  }
  if (!awareness) adset.destination_type = 'WEBSITE'
  if (doc.startDate && doc.startDate > today) adset.start_time = `${doc.startDate}T00:00:00+0900`
  if (doc.endDate) adset.end_time = `${doc.endDate}T23:59:00+0900`
  let daily: number | null = null
  if (doc.dailyBudget) { daily = Math.round(doc.dailyBudget); adset.daily_budget = String(daily) }
  else if (doc.totalBudget) adset.lifetime_budget = String(Math.round(doc.totalBudget))

  const link = adLink(doc)
  const cta = { type: metaCta(doc.cta), value: { link } }
  const creative = (hashes: string[]) => {
    const identity: Record<string, string> = { page_id: ids.pageId }
    if (ids.igUserId) identity.instagram_user_id = ids.igUserId
    const linkData = hashes.length > 1
      ? {
          link, message: doc.primaryText, multi_share_end_card: false,
          child_attachments: hashes.map(h => ({ link, image_hash: h, name: doc.headline.slice(0, 255), description: doc.description.slice(0, 255), call_to_action: cta })),
        }
      : { link, message: doc.primaryText, name: doc.headline.slice(0, 255), description: doc.description.slice(0, 255), image_hash: hashes[0], call_to_action: cta }
    return { name: `${name} · 소재`.slice(0, 200), object_story_spec: JSON.stringify({ ...identity, link_data: linkData }) }
  }
  return {
    campaign: {
      name,
      objective: awareness ? 'OUTCOME_AWARENESS' : 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      buying_type: 'AUCTION',
      special_ad_categories: '[]',
      is_adset_budget_sharing_enabled: 'false',
    },
    adset,
    creative,
    ad: (adsetId, creativeId) => ({ name: `${name} · 광고`.slice(0, 200), adset_id: adsetId, creative: JSON.stringify({ creative_id: creativeId }), status: 'PAUSED' }),
    dailyBudget: daily,
  }
}

/** 켜기 전 하루 한도 확인 — 켜진 캠페인 하루 합계 + 이 광고가 한도 안인지 (한도 0 = 확인 안 함) */
export function launchProblem(dailyCap: number, activeDaily: number, thisDaily: number | null, kill: boolean): string | null {
  if (kill) return '긴급 정지 중이라 켤 수 없습니다. 자동 운영에서 정지를 풀어 주세요.'
  if (dailyCap > 0 && thisDaily != null && activeDaily + thisDaily > dailyCap)
    return `켜진 광고 하루 예산 합계(${activeDaily.toLocaleString('ko-KR')}원) + 이 광고(${thisDaily.toLocaleString('ko-KR')}원)가 하루 한도 ${dailyCap.toLocaleString('ko-KR')}원을 넘습니다.`
  return null
}
