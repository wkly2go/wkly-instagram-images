import test from 'node:test'
import assert from 'node:assert/strict'
import {newGrowth,patchGrowthDocument} from '../src/lib/growth.ts'
test('company, source and facts invalidate all channel approvals without changing prior history',()=>{
 const doc=newGrowth('content','owner').document
 doc.original='original';doc.source_url='https://example.com/source'
 doc.versions=doc.versions!.map(v=>({...v,body:'preserved',status:'발행',publication_url:'https://example.com/post',external_id:'post-id'}))
 for(const patch of [{division:'AR' as const},{original:'new'},{source_url:'https://example.com/new'}]){
  assert.ok(patchGrowthDocument(doc,patch).versions!.every(v=>v.status==='초안'&&v.publication_url===''&&v.external_id===''&&v.body==='preserved'))
 }
 assert.ok(doc.versions!.every(v=>v.status==='발행'&&v.external_id==='post-id'))
 for(const patch of [{source_url:doc.source_url},{division:doc.division},{original:doc.original},{note:'internal'}]) assert.deepEqual(patchGrowthDocument(doc,patch).versions,doc.versions)
 assert.equal(patchGrowthDocument(newGrowth('contact','owner').document,{source_url:'https://example.com'}).versions,undefined)
})
