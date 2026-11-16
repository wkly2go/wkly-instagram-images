import {test} from 'node:test'
import assert from 'node:assert/strict'
import {inspectSender,createReadinessHandler,type ReadinessDeps} from '../supabase/functions/sales-readiness/handler.ts'
const config={clientId:'test-client',clientSecret:'secret-test',refreshToken:'refresh-test'}
const scope=(name:string)=>`https://www.googleapis.com/auth/gmail.${name}`
const token=(scopes:string|undefined)=>({access_token:'access-test',expires_in:3600,scope:scopes,token_type:'Bearer'})
function provider(scopes:string|undefined,email='sender@example.com'){
 const requests:{url:string;init:RequestInit|undefined}[]=[]
 const fetcher:typeof fetch=async(input,init)=>{const url=String(input);requests.push({url,init});return Response.json(url.endsWith('/token')?token(scopes):{emailAddress:email})}
 return {fetcher,requests}
}
test('diagnostic reads profile and exact scopes without sending or expanding consent',async()=>{
 const p=provider(`${scope('readonly')} ${scope('send')}`),result=await inspectSender(config,p.fetcher)
 assert.deepEqual(result,{code:'ready',email:'sender@example.com',can_send:true,can_read:true,valid_for:900})
 assert.deepEqual(p.requests.map(r=>[r.url,r.init?.method]),[['https://oauth2.googleapis.com/token','POST'],['https://gmail.googleapis.com/gmail/v1/users/me/profile','GET']])
 assert.equal(new URLSearchParams(p.requests[0].init?.body as URLSearchParams).has('scope'),false)
 assert.equal(JSON.stringify(result).includes('access-test'),false)
})
test('read-only access cannot become send permission via substring matching',async()=>{
 const p=provider(`${scope('readonly')} ${scope('send')}.fake`)
 assert.equal((await inspectSender(config,p.fetcher)).code,'read_only')
})
test('missing scopes and send-only identity gaps fail closed',async()=>{
 const unknown=provider(undefined);assert.equal((await inspectSender(config,unknown.fetcher)).code,'scope_unknown');assert.equal(unknown.requests.length,1)
 const sendOnly=provider(scope('send'));assert.equal((await inspectSender(config,sendOnly.fetcher)).code,'identity_unverified');assert.equal(sendOnly.requests.length,1)
})
test('missing credentials, wrong account and malformed profiles never report a ready sender',async()=>{
 assert.equal((await inspectSender(null,async()=>{throw new Error('must not fetch')})).code,'not_connected')
 assert.equal((await inspectSender({...config,expectedEmail:'other@example.com'},provider(scope('modify')).fetcher)).code,'account_mismatch')
 assert.equal((await inspectSender(config,provider(scope('modify'),'bad\r\naddress').fetcher)).code,'identity_unverified')
})
test('provider errors and oversized payloads produce controlled messages without credentials',async()=>{
 const error=await inspectSender(config,async()=>{throw new Error('refresh-test token access-test')})
 assert.equal(error.code,'provider_error');assert.equal(JSON.stringify(error).includes('test'),false)
 const huge=await inspectSender(config,async()=>new Response(JSON.stringify({access_token:'x'.repeat(40000),scope:scope('modify'),expires_in:3600})))
 assert.equal(huge.code,'provider_error')
})
test('profile-only scope and expired tokens are distinguished',async()=>{
 const metadata=await inspectSender(config,provider(scope('metadata')).fetcher);assert.equal(metadata.code,'read_only');assert.equal(metadata.can_read,false)
 const expired=await inspectSender(config,async()=>Response.json({...token(scope('modify')),expires_in:0}));assert.equal(expired.code,'provider_error')
})
test('authentication and single-flight check happen before credentials are loaded',async()=>{
 let loaded=0
 const d:ReadinessDeps={authorize:async()=>false,begin:async()=>null,config:async()=>{loaded++;return config},finish:async()=>{},fetcher:provider(scope('modify')).fetcher}
 const request=()=>new Request('https://worker.test',{method:'POST',headers:{authorization:'Bearer user-test'}})
 assert.equal((await createReadinessHandler(d)(request())).status,403)
 d.authorize=async()=>true;assert.equal((await createReadinessHandler(d)(request())).status,202);assert.equal(loaded,0)
 assert.equal((await createReadinessHandler(d)(new Request('https://worker.test',{method:'POST'}))).status,401)
})
test('successful checks persist sanitized capabilities and report save failure separately',async()=>{
 const writes:unknown[]=[]
 const d:ReadinessDeps={authorize:async()=>true,begin:async()=>'run',config:async()=>config,finish:async(...args)=>{writes.push(args)},fetcher:provider(scope('modify')).fetcher}
 const request=()=>new Request('https://worker.test',{method:'POST',headers:{authorization:'Bearer user-test'},body:JSON.stringify({send:true,scope:'forged'})})
 assert.deepEqual(await (await createReadinessHandler(d)(request())).json(),{checked:true,code:'ready'})
 assert.equal(JSON.stringify(writes).includes('secret-test'),false)
 d.finish=async()=>{throw new Error('secret database error')};const response=await createReadinessHandler(d)(request());assert.equal(response.status,503);assert.equal((await response.text()).includes('secret'),false)
})
