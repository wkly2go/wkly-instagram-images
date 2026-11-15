import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parse} from 'parse5'
import {EventEmitter} from 'node:events'
import {sourceUrl,robotsAllowed,extractPage,discover,createDiscoveryHandler} from '../supabase/functions/sales-contact-discovery/handler.ts'
import {publicIPv4,readPublicPage} from '../supabase/functions/sales-contact-discovery/transport.ts'
const website='https://company.com/',job={company_id:'company',company:'시험 회사',website}
test('URL scope rejects credentials, private literals, non-HTTPS, queries and unusual ports',()=>{
 assert.equal(sourceUrl('/contact',website)?.href,'https://company.com/contact')
 for(const url of ['http://company.com','https://user:pass@company.com','https://127.1','https://[::1]','https://company.com:8443','https://company.com/?token=x','https://a.local','https://foo.internal','https://company.com\\@localhost','https://company.com/\ncontact'])assert.equal(sourceUrl(url),null,url)
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','192.168.1.2','100.64.0.1','0.0.0.0','198.18.0.1','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicIPv4(ip),false,ip)
 assert.equal(publicIPv4('93.184.216.34'),true)
})
test('robots longest rule, wildcard groups and specific bot groups are enforced',()=>{
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /private\nAllow: /private/contact','/private/contact'),true)
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /*.pdf$','/a.pdf'),false)
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /\nUser-agent: WKLYSalesBot\nAllow: /','/'),true)
 assert.equal(robotsAllowed('User-agent: WKLYSalesBot\nDisallow: /contact\nUser-agent: WKLYSalesBot\nDisallow: /about','/about'),false)
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /%63ontact','/contact'),false)
 assert.equal(robotsAllowed('User-agent: *\nCrawl-delay: 10','/'),false)
})
test('HTML parser excludes scripts and hidden nodes, records evidence and classifies non-sales contacts',()=>{
 const html='<script>secret@evil.com</script><p hidden>hidden@evil.com</p><p>제휴 문의 <a href="mailto:biz@company.com">biz@company.com</a></p><p>개인정보 privacy@company.com</p><p>일반 office@external.com</p><a href="/contact">문의</a><a href="https://elsewhere.com/contact">외부</a>'
 const r=extractPage(html,website,parse)
 assert.deepEqual(r.candidates.map(c=>c.email).sort(),['biz@company.com','office@external.com','privacy@company.com'])
 assert.equal(r.candidates.find(c=>c.email.startsWith('biz'))?.role,'partnership');assert.equal(r.candidates.find(c=>c.email.startsWith('privacy'))?.role,'non_sales');assert.equal(r.candidates.find(c=>c.email.startsWith('office'))?.domain_match,false);assert.deepEqual(r.links,['https://company.com/contact'])
})
test('crawler reads robots first and at most three same-origin pages, never submits forms',async()=>{
 const calls:string[]=[]
 const read=async(url:string)=>{calls.push(url);return url.endsWith('robots.txt')?{status:200,contentType:'text/plain',text:'User-agent: *\nDisallow: /private'}:{status:200,contentType:'text/html',text:'<p>제휴 biz@company.com</p><a href="/contact">문의</a><a href="/about">회사</a><a href="/company">소개</a><form action="/send"></form>'}}
 const r=await discover(job,read,parse);assert.equal(calls.length,4);assert.ok(calls[0].endsWith('robots.txt'));assert.equal(r.pages.length,3);assert.equal(r.candidates.length,1);assert.equal(r.limited,true);assert.equal(r.status,'partial')
})
test('robots denial, unavailable rules and redirects never become successful empty discovery',async()=>{
 for(const page of [{status:200,contentType:'text/plain',text:'User-agent: *\nDisallow: /'},{status:503,contentType:'text/plain',text:''},{status:302,contentType:'text/plain',text:''}]){let calls=0;const r=await discover(job,async()=>{calls++;return page},parse);assert.equal(r.status,page.status===503?'unavailable':'blocked');assert.equal(r.candidates.length,0);assert.equal(calls,1)}
 const r=await discover(job,async url=>url.endsWith('robots.txt')?{status:404,contentType:'text/plain',text:''}:{status:302,contentType:'text/html',text:''},parse);assert.equal(r.status,'unavailable')
})
test('transport pins a validated IP and keeps original TLS identity without redirects or credentials',async()=>{
 let options:any,lookups=0
 const fakeRequest:any=(_url:URL,o:any,cb:any)=>{options=o;const req:any=new EventEmitter();req.end=()=>{const res:any=new EventEmitter();res.headers={'content-type':'text/html'};res.statusCode=200;res.destroy=()=>{};cb(res);res.emit('data',Buffer.from('hello'));res.emit('end')};return req}
 const r=await readPublicPage(website,{resolve:async()=>{lookups++;return ['93.184.216.34']},request:fakeRequest});assert.equal(r.text,'hello');assert.equal(options.agent,false);assert.equal(options.rejectUnauthorized,true);assert.equal(options.servername,'company.com');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,undefined)
 options.lookup('company.com',{},(_err:any,ip:string)=>assert.equal(ip,'93.184.216.34'));assert.equal(lookups,1)
 for(const ips of [[],['127.0.0.1'],['93.184.216.34','10.0.0.1']])await assert.rejects(readPublicPage(website,{resolve:async()=>ips,request:()=>{throw new Error('must not connect')}} as any),/Non-public/)
})
test('one-use job authorization happens before website access and request cannot override seed',async()=>{
 const id='10000000-0000-4000-8000-000000000001',token='20000000-0000-4000-8000-000000000001';let reads=0
 const handler=createDiscoveryHandler({claim:async()=>null,read:async()=>{reads++;throw new Error()},parse,finish:async()=>{}})
 for(const [body,status] of [[{id,token},403],[{id,token,website},400]] as const)assert.equal((await handler(new Request(website,{method:'POST',body:JSON.stringify(body)}))).status,status)
 assert.equal(reads,0)
})
