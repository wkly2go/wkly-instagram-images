import {test} from 'node:test'
import assert from 'node:assert/strict'
import {recommendSalesMethod,salesMethodDraft,salesEvidenceLinks} from '../src/lib/salesMethods.ts'

test('supplier outreach stays a partnership hypothesis even when it mentions popup work',()=>{
 const p={name:'담다패키지',source:'민간 영업 후보',evidence:'팝업 패키지 제작 크루 참여 협업 제안'}
 const m=recommendSalesMethod(p);assert.equal(m.id,'partner');assert.match(m.intent,/직접 발주 수요는 아직 확인되지 않음/)
 assert.match(salesMethodDraft(p,m),/발주할 과업인가요/)
})
test('public event records are research; a direct request uses the inquiry workflow',()=>{
 assert.equal(recommendSalesMethod({name:'브랜드 팝업 전시',source:'서울시 문화행사',evidence:'협업 문의 가능'}).id,'event')
 assert.equal(recommendSalesMethod({name:'브랜드 담당자',source:'민간 영업 후보',evidence:'팝업스토어 시공·운영 견적 요청'}).id,'inquiry')
 assert.equal(recommendSalesMethod({name:'일반 담당자',evidence:''}).id,'research')
})
test('verified role wins over inferred buyer signals but does not override contact exclusion',()=>{
 const p={name:'브랜드',evidence:'팝업 견적 요청',verifiedRole:'협력사'}
 assert.equal(recommendSalesMethod(p).id,'partner')
 const stopped={...p,blocked:true};assert.equal(recommendSalesMethod(stopped).id,'hold');assert.match(salesMethodDraft(stopped,recommendSalesMethod(stopped)),/새 연락 문안을 만들지 않습니다/)
})
test('email evidence and a company homepage have distinct destinations; malformed links are not rendered',()=>{
 const links=salesEvidenceLinks({source:'거래처',source_url:'https://example.test',evidence:'협력사 · Gmail thread 1a13eba1b07addca · 크루 제안 회신'})
 assert.deepEqual(links,[{label:'관련 메일 열기',url:'https://mail.google.com/mail/u/0/#all/1a13eba1b07addca'},{label:'등록 홈페이지 열기',url:'https://example.test'}])
 assert.deepEqual(salesEvidenceLinks({source:'리서치',source_url:'javascript:alert(1)',evidence:'Gmail thread invalid-value'}),[])
})
