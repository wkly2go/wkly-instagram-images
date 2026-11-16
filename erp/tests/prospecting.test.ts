import test from 'node:test'
import assert from 'node:assert/strict'
import { PROSPECT_PLAYS, newProspectPlan, researchLinks, prospectTimeline, researchReadiness, validateProspect, buildProspectDraft, validDate, shiftDate } from '../src/lib/prospecting.ts'
import { validateSales } from '../src/lib/sales.ts'
const today = '2026-11-13'
const plan = () => ({ ...newProspectPlan(), target: '테스트 브랜드', event: '테스트 행사', start: '2027-02-01', end: '2027-02-03', certainty: '확인' as const, sourceUrl: 'https://example.com/event', verifiedOn: today, evidence: '공식 공지 확인', need: '방문 유도', contact: '공개 문의 양식' })
for (const play of PROSPECT_PLAYS) test(play.id + ': produces a valid opportunity without expanding the existing DB schema', () => {
 const p={...plan(),play:play.id,leadDays:play.lead},d=buildProspectDraft(p,'owner',today)
 assert.equal(validateSales(d),null); assert.equal(d.division,play.division); assert.equal(d.owner_id,'owner');assert.equal(d.stage,'발굴')
 assert.ok(d.description.includes(play.offer));assert.ok(d.description.includes(play.question));assert.ok(d.description.includes(p.sourceUrl));assert.ok(d.description.includes(p.verifiedOn))
 assert.equal(d.expected_amount,null);assert.equal(d.next_date,shiftDate(p.start,-play.lead)>today?shiftDate(p.start,-play.lead):today)
 assert.deepEqual(Object.keys(d).sort(),['title','division','client_id','contact_id','owner_id','stage','source','source_url','expected_amount','next_action','next_date','description','result_note','project_id'].sort())
})
for(const [name,patch] of Object.entries({ 'empty target':{target:' '},'invalid day':{start:'2026-02-30'},'reverse period':{end:'2027-01-01'},'missing start':{start:''},'future verification':{verifiedOn:'2027-01-01'},'unsafe URL':{sourceUrl:'javascript:alert(1)'},'credentials':{sourceUrl:'https://user:password@example.com'},'missing proof':{evidence:''},'missing source':{sourceUrl:''},'missing verification':{verifiedOn:''},'fractional lead':{leadDays:7.5},'zero lead':{leadDays:0},'oversize lead':{leadDays:181},'bad month':{month:'2026-13'},'oversize target':{target:'가'.repeat(81)} })) test('rejects '+name,()=>{
 const p={...plan(),...patch};assert.ok(validateProspect(p,today));assert.throws(()=>buildProspectDraft(p,'owner',today))
})
test('unconfirmed and unknown dates require research today rather than future outreach',()=>{
 for(const p of [{...plan(),certainty:'예정' as const},{...newProspectPlan(),target:'브랜드'}]){
  const d=buildProspectDraft(p,'owner',today);assert.equal(d.next_date,today);assert.match(d.next_action,/공식 일정/)
 }
})
test('past events switch to follow-up without pretending a future campaign is possible',()=>{
 const p={...plan(),start:'2026-10-01',end:'2026-10-03'}; const d=buildProspectDraft(p,'owner',today)
 assert.equal(d.next_date,today);assert.match(d.next_action,/종료 행사/);assert.ok(prospectTimeline(p,today).every(x=>x.overdue))
})
test('timeline crosses month/year and leap day boundaries consistently',()=>{
 assert.equal(shiftDate('2028-03-01',-1),'2028-02-29');assert.equal(shiftDate('2027-01-01',-1),'2026-12-31')
 assert.equal(validDate('2027-02-29'),false);assert.equal(validDate('2028-02-29'),true)
 assert.equal(prospectTimeline({...plan(),start:'2027-01-01',end:'2027-01-03'},today)[4].date,'2027-01-06')
 assert.deepEqual(prospectTimeline({...plan(),start:'invalid'},today),[])
})
test('query links encode input and include region/month without leaking evidence or contact fields',()=>{
 const p={...plan(),target:'A&B #브랜드',industry:'뷰티',region:'성수',month:'2027-02',contact:'secret@example.com',evidence:'내부 메모'}
 const links=researchLinks(p);assert.equal(links.length,4)
 for(const x of links){assert.equal(new URL(x.google).hostname,'www.google.com');assert.equal(new URL(x.google).searchParams.get('q'),x.query);assert.equal(new URL(x.naver).searchParams.get('query'),x.query);assert.ok(!x.query.includes('secret@example.com'));assert.ok(!x.query.includes('내부 메모'))}
 assert.match(links[0].query,/성수 2027-02/)
})
test('readiness is transparent input completeness and does not count expired timing',()=>{
 assert.equal(researchReadiness(newProspectPlan(),today).score,0);assert.equal(researchReadiness(plan(),today).score,100)
 assert.equal(researchReadiness({...plan(),start:'2026-01-01'},today).score,85)
})

test('popup agency brief preserves scope and budget and brings forward an urgent selection', () => {
 const brief = { ...plan(), agencyScope: '공간 섭외와 운영', agencyBudget: '협의 중', agencyDecision: today }
 const draft = buildProspectDraft(brief, 'owner', today)
 assert.equal(draft.next_date, today)
 assert.match(draft.next_action, /미발주 범위/)
 assert.match(draft.description, /미발주 대행 범위: 공간 섭외와 운영/)
 assert.match(draft.description, /고객 예산 범위: 협의 중/)
 assert.equal(draft.expected_amount, null)
})
