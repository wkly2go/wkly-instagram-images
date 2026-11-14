import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import { newGrowth } from '../src/lib/growth.ts'
const temp = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '.candidate-api-'))
await build({ entryPoints: [fileURLToPath(new URL('../src/lib/growthApi.ts', import.meta.url))], outdir: temp, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, logLevel: 'silent' })
const { createSupabaseGrowthApi, createDemoGrowthApi } = await import(pathToFileURL(join(temp, 'growthApi.mjs')).href)
after(async () => { await rm(temp, { recursive: true, force: true }) })
function remote(kind: 'contact' | 'tender' | 'content') {
 const calls: URL[] = []
 const rows = Array.from({length:31}, (_, i) => ({id:String(i),kind,title:'테스트 팝업 행사',owner_id:'test',status:'검토',linked_sales_id:null,revision:1,created_at:'',updated_at:'',created_by:'test',campaign_id:null,...(kind==='contact'?{review_source:'받은 메일',review_segment:'미분류'}:kind==='tender'?{review_deadline:'2099-11-15T18:00:00+09:00',review_qualification:'추가 확인'}:{})}))
 const sb = createClient('https://candidate.example.test','mock-public-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async input=>{calls.push(new URL(String(input)));return Response.json(rows)}}})
 return {api:createSupabaseGrowthApi(sb),calls}
}
test('candidate list stays one bounded request with existing kind/search/status/order/paging',async()=>{
 for(const kind of ['contact','tender'] as const){
  const {api,calls}=remote(kind), result=await api.listGrowth({kind,page:1,search:'팝업',status:'검토'})
  assert.equal(calls.length,1);assert.equal(result.items.length,30);assert.equal(result.hasMore,true)
  const q=calls[0].searchParams,select=q.get('select')!
  assert.equal(q.get('kind'),'eq.'+kind);assert.equal(q.get('status'),'eq.검토');assert.ok(q.get('or')?.includes('title.imatch'))
  assert.equal(q.get('offset'),'30');assert.equal(q.get('limit'),'31');assert.equal(q.get('order'),'updated_at.desc,id.asc')
  assert.ok(!select.includes('document->>email'));assert.ok(!select.includes('document->>note'));assert.ok(!select.includes('document->>evidence'));assert.ok(!select.includes('*'))
  assert.ok(select.includes(kind==='contact'?'review_source:document->>source':'review_deadline:document->>deadline'))
  assert.ok(result.items.every((r:{sales_review?:unknown})=>r.sales_review))
  assert.ok(result.items.every((r:object)=>!Object.keys(r).some(k=>k.startsWith('review_'))))
 }
})
test('content list select and summary stay free of candidate fields',async()=>{
 const {api,calls}=remote('content'),result=await api.listGrowth({kind:'content',page:0,search:'',status:''})
 assert.ok(!calls[0].searchParams.get('select')?.includes('document'))
 assert.ok(result.items.every((r:object)=>!('sales_review' in r)))
})
test('demo keeps source document untouched and exposes only compact derived review',async()=>{
 const draft=newGrowth('contact','test');draft.title='테스트 팝업';draft.document.email='private@example.test';draft.document.note='private memo';draft.document.source='받은 메일'
 const row={...draft,id:'test',linked_sales_id:null,revision:1,created_at:'',updated_at:'',created_by:'test'},stored=JSON.stringify([row])
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>stored}})
 const api=createDemoGrowthApi(()=>({id:'test',active:true,role:'member'}),{})
 const result=await api.listGrowth({kind:'contact',page:0,search:'',status:''})
 assert.equal(result.items[0].sales_review.source,'mail');assert.equal(result.items[0].sales_review.bucket,'verify')
 assert.ok(!JSON.stringify(result).includes('private'));assert.equal(JSON.stringify([row]),stored)
 assert.deepEqual(await api.getGrowth('test'),row)
})
