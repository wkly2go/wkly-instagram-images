import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchSeoulEvents, handleSeoulEvents, normalizeSeoulSheet, normalizeSeoulPortal, parseSeoulSheet, SEOUL_SHEET_URL, SEOUL_PORTAL_URL } from '../src/lib/seoulEventsTransport.ts'
const stamp = '2026-11-14T00:00:00.000Z'
const event = (id = 1, start = '2026-11-14', end = '2026-11-20') => ({ TITLE: `테스트 전용 행사 ${id}`, GUNAME: '성동구', CODENAME: '전시', ORG_NAME: '가상 테스트 기관', PLACE: '테스트 공간', STRTDATE: start, END_DATE: end, HMPG_ADDR: `https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=${id}` })
const sheet = (rows = [event()], total = rows.length) => JSON.stringify({ result: 'ok', page: { totalCount: total }, list: rows })
const fetcher = (body: string): typeof fetch => async () => new Response(body)
const portal = (id = 1) => JSON.stringify({ resultList: [{ cultcode: id, title: `테스트 전용 행사 ${id}`, strtdate: '2026-11-14', endDate: '2026-11-20', subjcodeNm: '전시', facName: '테스트 장소', orgcodeCdNm: '' }] })
const request = () => new Request('https://wkly-erp.pages.dev/api/seoul-events')

test('strict parser accepts official unquoted keys and trailing commas without changing quoted strings', () => {
 const text = '{result:"ok",page:{totalCount:1,},list:[{TITLE:"x,{a:1,} and \\"quote\\"",DATE:"2026-11-14~2026-11-20",},]}'
 const result = parseSeoulSheet(text)
 assert.equal(result.total, 1); assert.equal(result.list[0].TITLE, 'x,{a:1,} and "quote"')
})
test('script expressions, prototype tricks and malformed envelopes are not evaluated', () => {
 for(const raw of ['{result:(globalThis.test=true),page:{totalCount:0},list:[]}', '{result:"ok",page:{totalCount:0},list:[1]}', '{result:"ok",page:{totalCount:"1"},list:[]}', '<html>maintenance</html>', '{result:"error",page:{totalCount:0},list:[]}', '{result:"ok",page:{totalCount:0},list:[{}]}']) assert.throws(()=>parseSeoulSheet(raw))
 assert.equal((globalThis as { test?:unknown }).test, undefined)
})
test('normalization limits to ongoing/upcoming KST dates without treating public event publication as sales intent', () => {
 const result = normalizeSeoulSheet(sheet([event(1,'2026-11-01','2026-11-13'),event(2),event(3,'2026-12-01','2026-12-02'),event(4,'bad','bad')],100),stamp)
 assert.deepEqual(result.events.map(x=>x.id),['2','3']);assert.equal(result.total,100);assert.equal(result.scanned,4);assert.equal(result.limited,true)
 assert.equal(result.fetchedAt,stamp);assert.ok(result.events.every(x=>!('email' in x)&&!('INQUIRY' in x)))
})
test('response is bounded to 200 events and 100KB while retaining honest scan counts', () => {
 const result=normalizeSeoulSheet(sheet(Array.from({length:1000},(_,i)=>({...event(i+1),TITLE:'가'.repeat(240),ORG_NAME:'나'.repeat(160),PLACE:'다'.repeat(160)})),1001),stamp)
 assert.ok(result.events.length>0&&result.events.length<=200);assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength<=100000)
 assert.equal(result.scanned,1000);assert.equal(result.total,1001);assert.equal(result.limited,true)
 assert.throws(()=>normalizeSeoulSheet(sheet(Array.from({length:1001},(_,i)=>event(i))),stamp))
})
test('official detail links only, empty dataset and invalid calendar dates are handled safely', () => {
 const malicious={...event(),HMPG_ADDR:'https://evil.example/cultureEvent/view.do?cultcode=1'}
 assert.equal(normalizeSeoulSheet(sheet([malicious]),stamp).events[0].url,'')
 const alternate={...malicious,ORG_LINK:'https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=2'}
 assert.equal(normalizeSeoulSheet(sheet([alternate]),stamp).events[0].id,'2')
 assert.deepEqual(normalizeSeoulSheet(sheet([]),stamp).events,[])
 assert.deepEqual(normalizeSeoulSheet(sheet([event(1,'2026-02-30','2026-12-20')]),stamp).events,[])
})
test('upstream request is fixed HTTPS, read-only, credential-free and redirects are rejected', async()=>{
 let calls=0
 const data=await fetchSeoulEvents(async(input,init)=>{calls++;assert.equal(new URL(String(input)).origin+new URL(String(input)).pathname,SEOUL_PORTAL_URL);assert.equal(new URL(String(input)).searchParams.get('sdate'),'2026.11.14');assert.equal(new URL(String(input)).searchParams.get('edate'),'2027.02.12');assert.equal(init?.method,'GET');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).has('Authorization'),false);return new Response(portal())},()=>new Date(stamp))
 assert.equal(calls,3);assert.equal(data.events.length,1)
})
test('source byte limit applies to streamed bodies and declared length', async()=>{
 for(const response of [()=>new Response('x',{headers:{'Content-Length':String(3*1024*1024+1)}}),()=>new Response('x'.repeat(3*1024*1024+1))]) await assert.rejects(fetchSeoulEvents(async()=>response()),/크기/)
})
test('bounded timeout aborts the upstream read without retries', async()=>{
 let calls=0
 await assert.rejects(fetchSeoulEvents(async(_input,init)=>{calls++;return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))},()=>new Date(stamp),2),e=>e instanceof Error&&e.name==='AbortError')
 assert.equal(calls,3)
})
test('endpoint rejects non-GET and client-controlled queries without touching the source', async()=>{
 let calls=0
 const fetch:typeof globalThis.fetch=async()=>{calls++;return new Response(sheet())}
 assert.equal((await handleSeoulEvents(new Request(request().url,{method:'POST'}),{fetcher:fetch})).status,405)
 assert.equal((await handleSeoulEvents(new Request(request().url+'?url=https://evil.example'),{fetcher:fetch})).status,400)
 assert.equal(calls,0)
})
test('successful public response is cached for thirty minutes and cache hit performs no source fetch', async()=>{
 let stored:Response|undefined,calls=0
 const cache={async match(){return stored?.clone()},async put(_key:RequestInfo|URL,response:Response){stored=response.clone()}}
 const deps={cache,now:()=>new Date(stamp),fetcher:async()=>{calls++;return new Response(portal())}}
 const first=await handleSeoulEvents(request(),deps),second=await handleSeoulEvents(request(),deps)
 assert.equal(first.status,200);assert.match(first.headers.get('Cache-Control')??'',/s-maxage=1800/)
 assert.deepEqual(await first.json(),await second.json());assert.equal(calls,3)
})
test('provider errors are not cached and the client receives a controlled CSV fallback message', async()=>{
 let puts=0
 const result=await handleSeoulEvents(request(),{fetcher:fetcher('<html>maintenance</html>'),cache:{async match(){return undefined},async put(){puts++}}})
 assert.equal(result.status,502);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.match((await result.json()).error,/CSV/);assert.equal(puts,0)
})

test('portal uses genuine ids/category, no inferred host, known partial coverage and date filtering',()=>{
 const result=normalizeSeoulPortal([portal(1),portal(1),JSON.stringify({resultList:[{cultcode:2,title:'테스트 종료 행사',strtdate:'2026-11-01',endDate:'2026-11-13'}]})],stamp)
 assert.equal(result.events.length,1);assert.equal(result.events[0].id,'1');assert.equal(result.events[0].category,'전시');assert.equal(result.events[0].organization,'')
 assert.equal(result.scanned,3);assert.equal(result.total,3);assert.equal(result.sourceKind,'portal');assert.equal(result.limited,true)
 assert.throws(()=>normalizeSeoulPortal(['null',portal(),portal()],stamp))
 assert.throws(()=>normalizeSeoulPortal([JSON.stringify({resultList:[{cultcode:'javascript:x',title:'invalid'}]}),portal(),portal()],stamp))
})
test('portal rejection falls back exactly once to official Sheet without retrying the portal',async()=>{
 const calls:string[]=[]
 const result=await fetchSeoulEvents(async(input)=>{const url=String(input);calls.push(url);return url===SEOUL_SHEET_URL?new Response(sheet()):new Response('upstream unavailable',{status:503})},()=>new Date(stamp))
 assert.equal(result.sourceKind,'sheet');assert.equal(calls.length,4);assert.equal(calls.filter(url=>url===SEOUL_SHEET_URL).length,1)
})
