import test from 'node:test'
import assert from 'node:assert/strict'
import { COEX_SCHEDULE_URL, fetchCoexProspectEvents, parseCoexProspectEvents } from '../src/lib/prospectPublicSources.ts'
const stamp = '2026-11-14T00:00:00.000Z'
// Synthetic fixtures use the verified official card classes; no fictitious lead is shipped.
const card = (slug = 'test-event', start = '2026.11.14', end = '2026.11.20', href = `https://www.coex.co.kr/exhibitions/${slug}/?var_page=1`) => `<a href='${href}' class='BlogEventItem-link'><h4 class='BlogEventItemCont-tit'>테스트 전용 &amp; &lt;행사&gt;</h4><p class='BlogEventItemCont-cate yellow'>Pop-up/Event</p><div class='BlogEventItemCont-date'>${start} - ${end}</div><div class='BlogEventItemCont-hall'>테스트 전용 공간</div></a>`
const page = (...cards: string[]) => `<div id="EXHIBITIONS_LIST_TYPE_SECTION">${cards.join('')}</div>`
test('official card fields become bounded plain data and stable official links without claiming a sales lead', () => {
 const data = parseCoexProspectEvents(page(card(), card()), stamp)
 assert.equal(data.scanned, 2); assert.equal(data.rows.length, 1); assert.equal(data.rows[0].title, '테스트 전용 & <행사>')
 assert.equal(data.rows[0].url, 'https://www.coex.co.kr/exhibitions/test-event/'); assert.equal(data.rows[0].category, 'Pop-up/Event')
 assert.equal(data.limited, true); assert.match(data.note, /구매 의사의 근거가 아닙니다/); assert.ok(!('html' in data))
})
test('expired, invalid dates, unsafe source links and changed page structure never become current events', () => {
 assert.equal(parseCoexProspectEvents(page(card('old', '2026.11.01', '2026.11.13')), stamp).rows.length, 0)
 for(const bad of [page(card('invalid','2026.02.30')),page(card('bad','2026.11.14','2026.11.20','https://evil.example/exhibitions/bad/')), '<html>blocked</html>',page()]) assert.throws(()=>parseCoexProspectEvents(bad, stamp))
 assert.throws(()=>parseCoexProspectEvents(page(...Array.from({length:13},(_,i)=>card(String(i)))),stamp))
})
test('KST date boundary and ninety-day window filter the real event period', () => {
 const data=parseCoexProspectEvents(page(card('expired','2026.11.01','2026.11.13'),card('current'),card('future','2027.02.13','2027.02.14')),'2026-11-13T15:00:00.000Z')
 assert.deepEqual(data.rows.map(row=>row.id),['https://www.coex.co.kr/exhibitions/current/'])
})
test('fetch uses fixed official GET, explicit ninety-day range, no credentials and no redirect',async()=>{
 let calls=0
 const data=await fetchCoexProspectEvents({now:()=>new Date(stamp),fetcher:async(input,init)=>{calls++; const url=new URL(String(input));assert.equal(url.origin+url.pathname,COEX_SCHEDULE_URL);assert.equal(url.searchParams.get('search_end_date'),'2027.02.12');assert.equal(url.searchParams.get('var_page'),'1');assert.equal(init?.method,'GET');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');return new Response(page(card()))}})
 assert.equal(calls,1);assert.equal(data.rows.length,1)
})
test('upstream errors, oversize bodies and cancelled requests fail without retry',async()=>{
 await assert.rejects(fetchCoexProspectEvents({fetcher:async()=>new Response('blocked',{status:403})}))
 await assert.rejects(fetchCoexProspectEvents({fetcher:async()=>new Response('x'.repeat(1024*1024+1))}),/크기 제한/)
 const controller=new AbortController();controller.abort();let calls=0
 await assert.rejects(fetchCoexProspectEvents({signal:controller.signal,fetcher:async()=>{calls++;return new Response(page(card()))}}));assert.equal(calls,0)
})
