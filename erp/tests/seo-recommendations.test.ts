import test from 'node:test'
import assert from 'node:assert/strict'
import { seoRecommendations } from '../src/lib/seoRecommendations.ts'
import type { SeoCheck } from '../src/lib/types'
const row=(patch:Partial<SeoCheck>={}):SeoCheck=>({kind:'SEO',item:'색인 페이지',checked_on:'2026-11-12',updated_at:'2026-11-12T00:00:00Z',score:20,status:'미흡',value:null,target:null,note:null,source:'https://example.com/evidence',...patch})
test('latest healthy measurement supersedes older failure',()=>assert.equal(seoRecommendations([row(),row({checked_on:'2026-11-13',status:'양호'})],'2026-11-13').length,0))
test('stale, future or missing evidence asks for measurement instead of claiming a defect',()=>{for(const patch of [{checked_on:'2026-10-01'},{checked_on:'2026-11-15'},{source:null},{source:'javascript:alert(1)'}])assert.equal(seoRecommendations([row(patch)],'2026-11-13')[0].priority,2)})
test('sourced recent defects lead and indexing advice preserves private-page restrictions',()=>{const result=seoRecommendations([row({item:'GEO 언급',kind:'GEO',source:null}),row()],'2026-11-13');assert.equal(result[0].priority,0);assert.match(result[0].action,/개인정보/);assert.equal(result[1].priority,2)})
