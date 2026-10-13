// 외부 연결: Gmail 작성창, 전화

export function gmailComposeUrl(opts: { to?: string | null; subject?: string | null; body?: string | null }): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1' })
  if (opts.to) q.set('to', opts.to)
  if (opts.subject) q.set('su', opts.subject)
  if (opts.body) q.set('body', opts.body)
  return `https://mail.google.com/mail/?${q.toString()}`
}

export function openGmail(opts: { to?: string | null; subject?: string | null; body?: string | null }) {
  window.open(gmailComposeUrl(opts), '_blank', 'noopener')
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`
}

/** 광고성 메일 하단 수신거부 안내 (정보통신망법: 제목 (광고) 표기 + 수신거부 방법) */
export const AD_FOOTER = '\n\n—\n보내는 곳: 더위클리 · info@thewklyn.com\n수신을 원하지 않으시면 이 메일에 "수신거부"라고 회신해 주세요.'
