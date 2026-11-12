import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newGrowth, validateGrowth, contactCandidates, changeChannel, safeWebUrl, koreaDateTimeInput, formatAiCost } from '../src/lib/growth.ts'
import { reserveCost, validateRequest } from '../supabase/functions/growth-ai/policy.ts'
test('AI cost display distinguishes tiny charges from zero',()=>{
 assert.equal(formatAiCost(0),'$0.000000')
 assert.equal(formatAiCost(0.000015),'$0.000015')
 assert.equal(formatAiCost(0.0000001),'<$0.000001')
 assert.equal(formatAiCost(0.000001),'$0.000001')
 assert.equal(formatAiCost('0.000015'),'$0.000015')
 assert.equal(formatAiCost(1.2345678),'$1.234568')
})
test('missing or invalid AI costs require checking instead of displaying zero',()=>{
 for(const value of [null,undefined,'',' ',NaN,Infinity,-1,'invalid',false,[]])assert.equal(formatAiCost(value),'확인 필요')
})
test('contact extraction normalizes duplicates without inventing names',()=>{
 const rows=contactCandidates('홍길동 <Brand@example.com> brand@example.com 다른이 test@sample.kr','받은 메일','owner')
 assert.equal(rows.length,2);assert.equal(rows[0].document.email,'brand@example.com');assert.equal(rows[0].document.name,'');assert.equal(rows[0].status,'검토')
})
test('instagram extraction excludes post paths and deduplicates handles',()=>{
 const rows=contactCandidates('https://instagram.com/brand @brand https://instagram.com/p/123 @other','인스타그램','owner')
 assert.deepEqual(rows.map(r=>r.document.instagram),['brand','other'])
})
test('content edit invalidates approvals and publication identity',()=>{
 const v={...newGrowth('content','owner').document.versions![0],title:'제목',status:'발행' as const,publication_url:'https://example.com',external_id:'12'}
 const changed=changeChannel(v,{body:'새 내용'});assert.equal(changed.status,'초안');assert.equal(changed.publication_url,'');assert.equal(changed.external_id,'')
 assert.equal(changeChannel(v,{body:v.body}).status,'발행')
})
test('tender requires evidence and integer amount; content requires approval facts',()=>{
 const d=newGrowth('tender','owner');d.title='공고';Object.assign(d.document,{number:'123',agency:'발주처'});assert.equal(validateGrowth(d),null)
 d.document.qualification='충족';assert.match(validateGrowth(d)!,/근거/);d.document.evidence='공식 공고 3쪽';d.document.amount=1.1;assert.match(validateGrowth(d)!,/정수/)
 const c=newGrowth('content','owner');c.title='콘텐츠';c.document.original='출처 확인';c.document.versions![0].status='발행';assert.match(validateGrowth(c)!,/제목/)
})
test('unsafe URLs and credential-bearing links are rejected',()=>{for(const u of ['javascript:alert(1)','https://user:pass@example.com','file:///tmp/test'])assert.equal(safeWebUrl(u),false);assert.equal(safeWebUrl('https://example.com/a'),true)})
test('tender deadlines retain Korea time when stored as UTC or an explicit offset',()=>{
 assert.equal(koreaDateTimeInput('2026-11-13T01:30:00Z'),'2026-11-13T10:30')
 assert.equal(koreaDateTimeInput('2026-11-13T10:30:00+09:00'),'2026-11-13T10:30')
 assert.equal(koreaDateTimeInput(''),'')
 const d=newGrowth('tender','owner');d.title='공고';Object.assign(d.document,{number:'123',agency:'발주처',deadline:'2026-11-13T10:30'})
 assert.match(validateGrowth(d)!,/시간대/)
 d.document.deadline='2026-11-13T10:30:00+09:00';assert.equal(validateGrowth(d),null)
})
test('AI requests cap text and model selection; reserve bounds UTF-8 input',()=>{
 const r={id:crypto.randomUUID(),task:'write',model:'standard',prompt:'테스트'};assert.doesNotThrow(()=>validateRequest(r));assert.throws(()=>validateRequest({...r,prompt:'x'.repeat(6001)}));assert.throws(()=>validateRequest({...r,model:'arbitrary'}));assert.throws(()=>validateRequest({...r,max_tokens:99999}));assert.ok(reserveCost('한'.repeat(6000),2,10)>reserveCost('a'.repeat(6000),2,10));assert.throws(()=>reserveCost('a',0,10))
})
