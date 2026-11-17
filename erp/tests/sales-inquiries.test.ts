import assert from 'node:assert/strict'
import { test } from 'node:test'

// The component file imports React; test the pure rules by re-stating the inputs through a tiny loader.
const SIGNAL = ['다음 팝업 기획', '첫 팝업 준비', '상권·입지 검토']
const group = (q: { kind: string | null; category: string | null; status: string | null }) =>
  (q.status ?? '신규') !== '신규' ? 'done' : q.kind === '문의' ? 'reply' : q.kind === '리포트 신청' && SIGNAL.includes(q.category ?? '') ? 'signal' : 'other'

test('inquiries are sorted into reply, signal, other and done', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/components/SalesInquiries.tsx', import.meta.url), 'utf8')
  // the rule in the component must stay the same as the one tested here
  assert.ok(src.includes("(q.status ?? '신규') !== '신규' ? 'done' : q.kind === '문의' ? 'reply' : q.kind === '리포트 신청' && SIGNAL.includes(q.category ?? '') ? 'signal' : 'other'"))
  assert.ok(src.includes("const SIGNAL = ['다음 팝업 기획', '첫 팝업 준비', '상권·입지 검토']"))
  assert.equal(group({ kind: '문의', category: null, status: '신규' }), 'reply')
  assert.equal(group({ kind: '문의', category: null, status: null }), 'reply')
  assert.equal(group({ kind: '리포트 신청', category: '첫 팝업 준비', status: '신규' }), 'signal')
  assert.equal(group({ kind: '리포트 신청', category: '공부·리서치', status: '신규' }), 'other')
  assert.equal(group({ kind: '구독', category: '구독', status: '신규' }), 'other')
  assert.equal(group({ kind: '문의', category: null, status: '응대 완료' }), 'done')
  // consent: given on the site, or recorded in the inbox with the memo mark; signals and others are split by it
  assert.ok(src.includes("export const inquiryConsent = (q: Pick<WebInquiry, 'newsletter' | 'memo'>): boolean => q.newsletter === true || (q.memo ?? '').includes(CONSENT_MARK)"))
  assert.ok(src.includes("export const CONSENT_MARK = '[수신 동의]'"))
  assert.ok(src.includes("(tab === 'signal' || tab === 'other' ? [true, false] : [null])"))
  const sql = await (await import('node:fs/promises')).readFile(new URL('../supabase/migrations/20261117120000_sales_inquiry_prospects.sql', import.meta.url), 'utf8')
  // the database uses the same consent rule and never registers a report request without consent
  assert.ok(sql.includes("(w.newsletter is true or coalesce(w.memo, '') like '%[수신 동의]%')"))
  // replies only open a mail window; nothing is sent by the app
  assert.ok(!/sb\.functions|functions\.invoke|fetch\(|sendMail|sendSales/i.test(src))
})
