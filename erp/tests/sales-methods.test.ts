import {test} from 'node:test'
import assert from 'node:assert/strict'
import {recommendSalesMethod,salesMethodDraft} from '../src/lib/salesMethods.ts'

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
