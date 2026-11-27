// 게시물 · 광고 주소에 꼬리표(UTM) 자동 붙이기 (2026-11-27 마케팅 자동화 — 문의 중 출처를 아는 것이 38%뿐이라 소재별 성과를 알 수 없었음)
//  - 우리 홈페이지(thewklyn.com · arteriors.co.kr)로 가는 주소에만 붙인다. 남의 사이트 주소는 건드리지 않는다
//  - 이미 꼬리표(utm_source)가 있으면 그대로 둔다 (사람이 정한 값 우선 · 여러 번 저장해도 같은 결과)
//  - 홈페이지 채널 글 안의 주소는 사이트 안 이동이라 붙이지 않는다 (붙이면 처음 들어온 출처가 덮인다)
export const OWN_HOSTS = ['thewklyn.com', 'arteriors.co.kr']
export interface UtmTag { source: string; medium: string; campaign: string; content?: string }

const CHANNEL_TAGS: Record<string, { source: string; medium: string } | null> = {
  '네이버 블로그': { source: 'naver_blog', medium: 'blog' },
  인스타그램: { source: 'instagram', medium: 'social' },
  유튜브: { source: 'youtube', medium: 'video' },
  홈페이지: null,
}

export function isOwnHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return OWN_HOSTS.some(o => h === o || h.endsWith(`.${o}`))
}

/** 꼬리표 이름: 제목에서 공백 · 기호를 '-' 로, 40자까지. 비면 fallback */
export function campaignSlug(title: string, fallback = 'content'): string {
  const s = title.trim().replace(/\[[^\]]*\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return s || fallback
}

export function tagUrl(raw: string, tag: UtmTag): string {
  let url: URL
  try { url = new URL(raw) } catch { return raw }
  if (!['https:', 'http:'].includes(url.protocol) || !isOwnHost(url.hostname) || url.searchParams.has('utm_source')) return raw
  url.searchParams.set('utm_source', tag.source)
  url.searchParams.set('utm_medium', tag.medium)
  url.searchParams.set('utm_campaign', tag.campaign)
  if (tag.content) url.searchParams.set('utm_content', tag.content)
  return url.toString()
}

const URL_RE = /https?:\/\/[^\s<>"'）)\]]+/g
/** 글 안의 우리 홈페이지 주소마다 꼬리표를 붙인다. 주소 끝의 마침표 · 쉼표는 주소로 보지 않는다 */
export function tagLinksInText(text: string, tag: UtmTag): string {
  return text.replace(URL_RE, m => {
    const tail = m.match(/[.,!?:;·]+$/)?.[0] ?? ''
    const core = tail ? m.slice(0, -tail.length) : m
    return tagUrl(core, tag) + tail
  })
}

export interface ChannelText { channel: string; body: string }
/** 콘텐츠 한 건의 채널별 본문에 꼬리표를 붙인다. 바뀐 것이 없으면 같은 배열을 돌려준다 */
export function tagContentVersions<T extends ChannelText>(title: string, versions: T[]): T[] {
  const campaign = campaignSlug(title)
  let changed = false
  const next = versions.map(v => {
    const t = CHANNEL_TAGS[v.channel]
    if (!t || !v.body) return v
    const body = tagLinksInText(v.body, { ...t, campaign })
    if (body === v.body) return v
    changed = true
    return { ...v, body }
  })
  return changed ? next : versions
}
