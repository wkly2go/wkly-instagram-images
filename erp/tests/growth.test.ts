import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newGrowth, validateGrowth, contactCandidates, changeChannel, safeWebUrl, koreaDateTimeInput, formatAiCost, appendGrowthNote } from '../src/lib/growth.ts'
import { reserveCost, validateRequest } from '../supabase/functions/growth-ai/policy.ts'
test('AI note application preserves the entire result or rejects overflow without silent truncation',()=>{
 assert.equal(appendGrowthNote('', '결과'), '결과')
 assert.equal(appendGrowthNote('기존', '결과'), '기존\n\n결과')
 assert.equal(appendGrowthNote('a'.repeat(9997), 'b').length, 10000)
 assert.throws(()=>appendGrowthNote('a'.repeat(10000), '새 결과'), /10,000자/)
 assert.throws(()=>appendGrowthNote('a'.repeat(9998), 'b'), /10,000자/)
})
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
test('instagram extraction accepts complete official profile URLs and standalone mentions in source order',()=>{
 const rows=contactCandidates('(HTTPS://WWW.INSTAGRAM.COM/Brand_One/?igsh=abc) @BRAND_One, instagram.com/brand.two/ 문의: @Brand3 https://instagram.com/brand4#profile "@brand5",@brand6 https://instagram.com/brand7/?email=hello@example.com','인스타그램','owner')
 assert.deepEqual(rows.map(r=>r.document.instagram),['brand_one','brand.two','brand3','brand4','brand5','brand6','brand7'])
 assert.equal(rows[0].document.source_url,'https://www.instagram.com/brand_one/')
 assert.ok(rows.every(r=>r.status==='검토'&&r.owner_id==='owner'&&r.document.name===''))
})
test('instagram extraction rejects email addresses, lookalike hosts, credentials and nested links',()=>{
 const text=['hello@brand.com','"support team"@brand.com','\'team\'@brand.com','한국어@brand.kr','first+last@brand.com','https://notinstagram.com/fake','notinstagram.com/fake','https://instagram.com.example.com/fake','https://evil.instagram.com/fake','https://user:pass@instagram.com/fake','ftp://instagram.com/fake','https://example.com/?next=https://instagram.com/fake&user=@fake','https://example.com/?email=foo@brand.com,@fake','https://example.com/instagram.com/fake','@valid'].join(' ')
 assert.deepEqual(contactCandidates(text,'인스타그램','owner').map(r=>r.document.instagram),['valid'])
})
test('instagram extraction rejects whole invalid or overlong names and non-profile routes',()=>{
 const tooLong='a'.repeat(31),maximum='b'.repeat(30)
 const text=[`@${tooLong}`,`https://instagram.com/${tooLong}/`,'@invalid-name','@invalid/name','https://instagram.com/brand/reels/','https://instagram.com/p/123','https://instagram.com/reel/123','https://instagram.com/stories/brand/123','https://instagram.com/accounts/','https://instagram.com/direct/','@explore',`@${maximum}`].join(' ')
 assert.deepEqual(contactCandidates(text,'인스타그램','owner').map(r=>r.document.instagram),[maximum])
 assert.deepEqual(contactCandidates('a'.repeat(99990)+' @valid','인스타그램','owner').map(r=>r.document.instagram),['valid'])
})
test('instagram extraction deduplicates before applying the fifty-candidate limit',()=>{
 const text=Array.from({length:55},(_,i)=>`@Brand_${i} https://www.instagram.com/brand_${i}/`).join('\n')
 const rows=contactCandidates(text,'인스타그램','owner')
 assert.equal(rows.length,50)
 assert.deepEqual(rows.map(r=>r.document.instagram),Array.from({length:50},(_,i)=>`brand_${i}`))
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
