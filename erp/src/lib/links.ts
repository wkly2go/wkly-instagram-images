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
