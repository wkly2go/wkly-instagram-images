// 프로젝트 '대화' 모아 보기 (2026-11-19 대표 지시 '개선해' · 기획 '메신저 협업 단순화') — 인트라넷 채팅 · 슬랙 · 카톡 · 메일 · 외부 협업방을 한 줄로
// 서버 함수 project_timeline(부르는 사람 권한 그대로) 가 출처마다 최근 글을 모아 시간순으로 준다.
const gmailThreadUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${threadId}` // types.ts 와 같은 주소 (시험에서 바로 읽게 따로 둠)

export const TIMELINE_SOURCES = ['인트라넷', '슬랙', '카톡', '메일', '협업방'] as const
export type TimelineSource = (typeof TIMELINE_SOURCES)[number]
export interface TimelineItem { source: TimelineSource; at: string; who: string; body: string; ref: string }

/** 줄을 누르면 갈 곳: 인트라넷 채팅방 · 메일 대화 · 같은 화면의 출처 칸 */
export function timelineLink(it: Pick<TimelineItem, 'source' | 'ref'>): { href: string; external: boolean } | null {
  const [kind, a] = it.ref.split(':')
  if (kind === 'chat' && a) return { href: `/chat?room=${a}`, external: false }
  if (kind === 'mail' && a) return { href: gmailThreadUrl(a), external: true }
  if (kind === 'collab') return { href: '#collab', external: false }
  if (kind === 'slack') return { href: '#slack', external: false }
  if (kind === 'kakao') return { href: '#kakao', external: false }
  return null
}

/** 날짜(한국 시각)별 묶음 — 가장 최근 날 먼저, 같은 날 안에서는 최근 글 먼저 */
export function groupByDay(items: TimelineItem[]): { day: string; items: TimelineItem[] }[] {
  const key = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10)
  const out: { day: string; items: TimelineItem[] }[] = []
  for (const it of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
    const d = key(it.at)
    const last = out[out.length - 1]
    if (last?.day === d) last.items.push(it)
    else out.push({ day: d, items: [it] })
  }
  return out
}

/** 출처별 건수 (거르기 칩에 씀) */
export const countBySource = (items: TimelineItem[]) =>
  Object.fromEntries(TIMELINE_SOURCES.map(s => [s, items.filter(i => i.source === s).length])) as Record<TimelineSource, number>

/** 같은 내용이 두 출처에 겹치면(예: 메일 제목을 채팅에 붙여 넣음) 그대로 둔다 — 지우지 않고 출처로 구분해 보인다 */
export const PAGE_SIZE = 60
