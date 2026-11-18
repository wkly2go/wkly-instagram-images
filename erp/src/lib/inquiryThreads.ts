import type { InquiryThread, WebInquiry } from './types'

/**
 * 웹 문의함 구분 (2026-11-18 · 문의 메일 응대 추적)
 * 회사 메일과 10분마다 맞춰 본 대화 상태(private.sales_inquiry_threads)로 나눈다.
 *  - 바로 응대: 고객이 답을 기다리는 대화 · 아직 메일 답장 기록이 없는 직접 문의
 *  - 회신 대기: 우리가 답한 뒤 고객 회신을 기다리는 대화 (마지막 연락 뒤 21일까지)
 *  - 관심 신호 · 구독 · 자료 신청 · 처리한 것: 예전 규칙 그대로
 * React 를 쓰지 않는 순수 함수만 둔다 (테스트에서 바로 불러 씀).
 */
export type InquiryGroup = 'reply' | 'waiting' | 'signal' | 'other' | 'done'
export type ThreadView = Pick<InquiryThread, 'state' | 'in_count' | 'last_in_at' | 'last_out_at'>

export const SIGNAL = ['다음 팝업 기획', '첫 팝업 준비', '상권·입지 검토']
export const DAY_MS = 86_400_000
/** 회신 대기로 보여 주는 기간 (14일째 후속 알림 뒤 1주) */
export const WAIT_DAYS = 21

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN)

/** 마지막 연락 시각: 보통은 우리 답장 · '답장 필요 없음'으로 넘긴 대화는 그 고객 메일 */
export function waitFrom(t: Pick<InquiryThread, 'state' | 'last_in_at' | 'last_out_at'>): string | null {
  if (t.state === '회신 대기' && time(t.last_in_at) > time(t.last_out_at)) return t.last_in_at
  return t.last_out_at
}

/** 마지막 연락 뒤 지난 날 수 (내림) */
export function waitDays(t: Pick<InquiryThread, 'state' | 'last_in_at' | 'last_out_at'>, now = Date.now()): number | null {
  const from = time(waitFrom(t))
  return Number.isFinite(from) ? Math.max(0, Math.floor((now - from) / DAY_MS)) : null
}

export function inquiryGroup(q: Pick<WebInquiry, 'kind' | 'category' | 'status'>, t?: ThreadView | null, now = Date.now()): InquiryGroup {
  const status = q.status ?? '신규'
  if (status === '제외') return 'done'
  if (t?.state === '우리 답 필요') return 'reply'
  // 메일 기록을 맞춰 본 문의는 '확인'이어도 답장 기록이 없으면 남긴다 · 맞춰 보지 못한 문의는 예전처럼 '신규'만
  if (q.kind === '문의' && (t ? t.state === '미응대' && (status === '신규' || status === '확인') : status === '신규')) return 'reply'
  const days = t?.state === '회신 대기' && (q.kind === '문의' || t.in_count > 0) ? waitDays(t, now) : null
  if (days != null && days < WAIT_DAYS) return 'waiting'
  if (status !== '신규') return 'done'
  return q.kind === '리포트 신청' && SIGNAL.includes(q.category ?? '') ? 'signal' : 'other'
}

/** 후속 연락 단계 (알림과 같은 3 · 7 · 14일) */
export function followupStage(days: number | null): 3 | 7 | 14 | null {
  if (days == null) return null
  return days >= 14 ? 14 : days >= 7 ? 7 : days >= 3 ? 3 : null
}

/** 메일 기록(mail_index)은 회사 공용 메일함 기준이라 그 계정으로 대화를 연다 */
export const INQUIRY_MAILBOX = 'info@thewklyn.com'
export const inquiryMailUrl = (threadId: string) => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(INQUIRY_MAILBOX)}#all/${encodeURIComponent(threadId)}`

/** '20시간 전' · '3일 전' */
export function agoLabel(iso: string | null | undefined, now = Date.now()): string {
  const at = time(iso)
  if (!Number.isFinite(at)) return ''
  const h = Math.floor((now - at) / 3_600_000)
  return h < 1 ? '방금' : h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`
}

/** 급한 순서: 바로 응대는 가장 오래 기다린 것부터, 회신 대기는 후속 연락이 가장 늦은 것부터 */
export function urgency(q: Pick<WebInquiry, 'submitted_at'>, t?: ThreadView | null): number {
  if (t?.state === '우리 답 필요') return time(t.last_in_at)
  if (t?.state === '회신 대기') return time(waitFrom(t))
  return time(q.submitted_at)
}
