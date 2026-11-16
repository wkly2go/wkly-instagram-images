import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import { buildDashboardSource, dashboardFile } from '../scripts/build-instagram-dashboard.mjs'

test('Instagram contacts dashboard artifact matches the canonical authenticated handler and fixed SDK import', async () => {
  const source = await readFile(dashboardFile, 'utf8')
  assert.equal(source, await buildDashboardSource())
  const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  assert.equal(parsed.parseDiagnostics.length, 0)
  assert.deepEqual(parsed.statements.filter(ts.isImportDeclaration).map(s => s.moduleSpecifier.text), ['npm:@supabase/supabase-js@2.117.3'])
  execFileSync(process.execPath, ['scripts/build-instagram-dashboard.mjs', '--check'], { cwd: new URL('../', import.meta.url) })
})

async function fixture(active=true,admin=true,profileError=null){
 const source=ts.transpileModule(await readFile(dashboardFile,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 const env={SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',WKLY_META_PAGE_ID:'101',WKLY_INSTAGRAM_DIVISION:'TW',WKLY_INSTAGRAM_ACCOUNT_ID:'100',WKLY_META_PAGE_TOKEN:'private-page-token',WKLY_META_API_VERSION:'v27.0',WKLY_INSTAGRAM_CONTACT_OWNER_ID:'00000000-0000-4000-8000-000000000001'}
 const calls={auth:0,profile:0,state:0,commit:0,provider:0};let handler
 const createClient=(url,key,options)=>{
  assert.equal(url,env.SUPABASE_URL)
  assert.equal(options.auth.persistSession,false)
  if(key==='service')return {from(table){assert.equal(table,'growth_ig_sync');const q={select(){return q},eq(column,value){assert.equal(column,'account_id');assert.equal(value,'100');return q},async maybeSingle(){calls.state++;return {data:null,error:null}}};return q},async rpc(name,args){assert.equal(name,'growth_ig_commit');assert.equal(args.p_account,'100');assert.equal(args.p_division,'TW');assert.equal(args.p_owner,env.WKLY_INSTAGRAM_CONTACT_OWNER_ID);calls.commit++;return {data:{inserted:0,kept:0,hasMore:false,revision:1},error:null}}}
  assert.equal(key,'anon');assert.equal(options.global.headers.Authorization,'Bearer user-token')
  return {auth:{async getUser(){calls.auth++;return {data:{user:{id:'user-id'}},error:null}}},from(table){assert.equal(table,'profiles');const q={select(){return q},eq(column,value){assert.equal(column,'id');assert.equal(value,'user-id');return q},async single(){calls.profile++;return {data:{active,role:admin?'admin':'member'},error:profileError}}};return q}}
 }
 vm.runInNewContext(source,{exports:{},require(specifier){assert.equal(specifier,'npm:@supabase/supabase-js@2.117.3');return {createClient}},Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn}},Request,Response,URL,URLSearchParams,TextDecoder,TextEncoder,AbortSignal,crypto,fetch:async input=>{calls.provider++;return Response.json(String(input).includes('/conversations')?{data:[]}:{instagram_business_account:{id:'100'}})}})
 return {calls,handler}
}
const request=action=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer user-token'},body:JSON.stringify({action})})
test('dashboard entrypoint binds admin validation to the real user and writes with the server client',async()=>{
 const t=await fixture();assert.equal((await t.handler(request('sync'))).status,200)
 assert.deepEqual(t.calls,{auth:1,profile:1,state:1,commit:1,provider:2})
})
test('dashboard entrypoint rejects inactive/non-admin users before reading synchronization state',async()=>{
 for(const [active,admin] of [[false,true],[true,false]]){const t=await fixture(active,admin);assert.equal((await t.handler(request('sync'))).status,403);assert.equal(t.calls.state,0);assert.equal(t.calls.commit,0);assert.equal(t.calls.provider,0)}
})
test('dashboard entrypoint fails closed on profile lookup errors without exposing details',async()=>{
 const t=await fixture(true,true,{message:'private db details'}),r=await t.handler(request('sync'));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private db details/);assert.equal(t.calls.state,0)
})
