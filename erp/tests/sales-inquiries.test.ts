import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { DAY_MS, WAIT_DAYS, agoLabel, followupStage, inquiryComposeUrl, inquiryFollowup, inquiryGroup, inquiryMailUrl, urgency, waitDays, waitFrom } from '../src/lib/inquiryThreads.ts'

const NOW = Date.parse('2026-11-18T04:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const H = 3_600_000
const thread = (state: '미응대' | '우리 답 필요' | '회신 대기', o: { in_count?: number; last_in?: number; last_out?: number } = {}) => ({
  state,
  in_count: o.in_count ?? 0,
  last_in_at: o.last_in == null ? null : iso(o.last_in),
  last_out_at: o.last_out == null ? null : iso(o.last_out),
})

test('inquiries without mail tracking keep the old rule', () => {
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '신규' }, null, NOW), 'reply')
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: null }, null, NOW), 'reply')
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '확인' }, null, NOW), 'done')
  assert.equal(inquiryGroup({ kind: '리포트 신청', category: '첫 팝업 준비', status: '신규' }, null, NOW), 'signal')
  assert.equal(inquiryGroup({ kind: '리포트 신청', category: '공부·리서치', status: '신규' }, null, NOW), 'other')
  assert.equal(inquiryGroup({ kind: '구독', category: '구독', status: '신규' }, null, NOW), 'other')
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '응대 완료' }, null, NOW), 'done')
})

test('mail state decides reply and waiting', () => {
  // the customer wrote after our answer (e.g. asked for a rough estimate) → we owe a reply, even when already marked done
  const owe = thread('우리 답 필요', { in_count: 1, last_in: 20 * H, last_out: 21 * H })
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '응대 완료' }, owe, NOW), 'reply')
  // a report request where the person answered our mail is a conversation too
  assert.equal(inquiryGroup({ kind: '리포트 신청', category: '구독', status: '응대 완료' }, owe, NOW), 'reply')
  // a direct inquiry checked by someone but never answered by mail stays visible
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '확인' }, thread('미응대'), NOW), 'reply')
  // answered by phone and marked by hand → done
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '응대 완료' }, thread('미응대'), NOW), 'done')
  // we answered, the customer has not → waiting, until 21 days after the last contact
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '응대 완료' }, thread('회신 대기', { last_out: 5 * DAY_MS }), NOW), 'waiting')
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '응대 완료' }, thread('회신 대기', { last_out: (WAIT_DAYS + 1) * DAY_MS }), NOW), 'done')
  // a report sent with no conversation is not a waiting thread
  assert.equal(inquiryGroup({ kind: '리포트 신청', category: '구독', status: '응대 완료' }, thread('회신 대기', { last_out: DAY_MS }), NOW), 'done')
  // excluded always wins
  assert.equal(inquiryGroup({ kind: '문의', category: null, status: '제외' }, owe, NOW), 'done')
})

test('dismissed customer mail counts as the last contact', () => {
  const dismissed = thread('회신 대기', { in_count: 1, last_in: 2 * DAY_MS, last_out: 9 * DAY_MS })
  assert.equal(waitFrom(dismissed), dismissed.last_in_at)
  assert.equal(waitDays(dismissed, NOW), 2)
  const normal = thread('회신 대기', { in_count: 1, last_in: 9 * DAY_MS, last_out: 2 * DAY_MS })
  assert.equal(waitFrom(normal), normal.last_out_at)
  assert.deepEqual([0, 2, 3, 6, 7, 13, 14, 30].map(followupStage), [null, null, 3, 3, 7, 7, 14, 14])
  assert.equal(followupStage(null), null)
})

test('labels, order and mail links', () => {
  assert.equal(agoLabel(iso(20 * H), NOW), '20시간 전')
  assert.equal(agoLabel(iso(50 * H), NOW), '2일 전')
  assert.equal(agoLabel(iso(10_000), NOW), '방금')
  assert.equal(agoLabel(null, NOW), '')
  // longest wait first
  const older = urgency({ submitted_at: iso(DAY_MS) }, thread('우리 답 필요', { last_in: 30 * H }))
  const newer = urgency({ submitted_at: iso(DAY_MS) }, thread('우리 답 필요', { last_in: 2 * H }))
  assert.ok(older < newer)
  // mail_index is the shared company mailbox, so the link selects that account
  assert.equal(inquiryMailUrl('19a8f'), 'https://mail.google.com/mail/u/?authuser=info%40thewklyn.com#all/19a8f')
})

test('the inbox never sends mail and keeps the consent rule', async () => {
  const src = await readFile(new URL('../src/components/SalesInquiries.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes("export const inquiryConsent = (q: Pick<WebInquiry, 'newsletter' | 'memo'>): boolean => q.newsletter === true || (q.memo ?? '').includes(CONSENT_MARK)"))
  assert.ok(src.includes("export const CONSENT_MARK = '[수신 동의]'"))
  assert.ok(src.includes("(tab === 'signal' || tab === 'other' ? [true, false] : [null])"))
  assert.ok(src.includes('inquiryGroup(q, byId.get(q.id), now)'))
  // replies only open a mail window or the mail thread; nothing is sent by the app
  assert.ok(!/sb\.functions|functions\.invoke|fetch\(|sendMail|sendSales/i.test(src))
  const prospects = await readFile(new URL('../supabase/migrations/20261117120000_sales_inquiry_prospects.sql', import.meta.url), 'utf8')
  assert.ok(prospects.includes("(w.newsletter is true or coalesce(w.memo, '') like '%[수신 동의]%')"))
})

test('mail tracking in the database only reads mail and alerts politely', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261118141500_sales_inquiry_threads.sql', import.meta.url), 'utf8')
  // reads the synced mailbox, skips unsent drafts and our own addresses
  assert.ok(sql.includes("not ('DRAFT' = any (m.labels))"))
  assert.ok(sql.includes("split_part(lower(trim(w.email)), '@', 2) <> 'thewklyn.com'"))
  assert.ok(sql.includes("s.key = 'sales_internal_emails'"))
  // never sends mail or calls the network
  assert.ok(!/net\.http_|gmail|send_message|sales_dispatch/i.test(sql.replace(/--.*$/gm, '')))
  // alerts only in working hours, once per stage, newest duplicate only
  assert.ok(sql.includes("not between 8 and 20"))
  assert.ok(sql.includes('v_key is distinct from r.alert_key and not r.superseded and not v_quiet'))
  // notification titles carry names, never amounts
  for (const m of sql.matchAll(/v_title := ([^;]+);/g)) assert.ok(!/금액|원'|amount|budget/i.test(m[1]), m[1])
  // makes sure new inquiries became sales prospects before closing them
  assert.ok(sql.indexOf('perform private.sales_inquiry_prospects()') < sql.indexOf("set status = '응대 완료'"))
  // runs in the sales pulse every 10 minutes
  assert.ok(sql.includes("('inquiry_threads', '문의 메일 응대 추적', 'private.sales_inquiry_thread_tick()', 10, 10, true)"))
  // the UI function exists for members only, and dismissing is limited to members
  assert.ok(sql.includes('grant execute on function public.sales_inquiry_threads() to authenticated'))
  assert.ok(sql.includes('grant execute on function public.sales_inquiry_thread_dismiss(uuid) to authenticated'))
  assert.ok(!/drop\s+function/i.test(sql), 'keep the deployed function signature (no drop)')
})

test('follow-up drafts: three different templates, reply subject, company name, no amounts', () => {
  const q = { site: 'TW', brand: '테스트 브랜드', title: '성수 팝업', category: null }
  const a = inquiryFollowup(q, 3, 'Re: [더위클리] 문의 주셔서 감사합니다')
  const b = inquiryFollowup(q, 7, null)
  const c = inquiryFollowup({ ...q, site: 'AR' }, 14, '')
  assert.equal(a.subject, 'Re: [더위클리] 문의 주셔서 감사합니다')
  assert.equal(b.subject, 'Re: [더위클리] 성수 팝업')
  assert.ok(c.subject.includes('아트리어') && c.body.includes('아트리어 드림'))
  assert.notEqual(a.body, b.body); assert.notEqual(b.body, c.body)
  for (const d of [a, b, c]) {
    assert.ok(d.body.startsWith('안녕하세요, 테스트 브랜드 담당자님.'))
    assert.ok(!/\d+\s*(만\s*)?원/.test(d.body), 'no prices in a follow-up')
  }
  const url = inquiryComposeUrl('a@b.co', a.subject, a.body)
  assert.ok(url.startsWith('https://mail.google.com/mail/?authuser=info%40thewklyn.com&view=cm'))
  assert.ok(url.includes('to=a%40b.co'))
})
