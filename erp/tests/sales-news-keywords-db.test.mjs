import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile(new URL('../supabase/migrations/20261115090133_sales_news_keywords.sql',import.meta.url),'utf8')
test('the three unproductive searches are replaced and the productive ones stay',async()=>{
 const db=new PGlite();await db.exec(`create schema private;create function private.sales_news_queue() returns text[] language plpgsql as $$declare word text;out text[]:='{}';begin
  foreach word in array array['팝업스토어 오픈','팝업스토어 예정','브랜드 팝업','플래그십스토어 오픈','브랜드 체험존','페스티벌 개최','박람회 참가기업 모집','전시회 참가업체 모집'] loop out:=out||word;end loop;return out;end $$;`)
 await db.exec(sql);await db.exec(sql)
 assert.deepEqual((await db.query('select private.sales_news_queue() w')).rows[0].w,['팝업스토어 오픈','팝업스토어 예정','브랜드 팝업','플래그십스토어 오픈','브랜드 체험존','체험형 팝업','팝업 부스 운영','브랜드 쇼룸 오픈'])
})
test('an unexpected list stops the change',async()=>{
 const db=new PGlite();await db.exec("create schema private;create function private.sales_news_queue() returns integer language sql as $$select 1$$;")
 await assert.rejects(db.exec(sql),/Unexpected news keyword list/)
})
