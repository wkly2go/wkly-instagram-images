import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),sql=await readFile(new URL('../supabase/migrations/20261115090125_sales_need_scope.sql',import.meta.url),'utf8')
before(async()=>{
 await db.exec(`create schema private;
 create table sales_prospects(id serial primary key,source text,name text,evidence text default '',assessment text default '확인 필요',reviewed_assessment text,blocked boolean default false);
 insert into sales_prospects(source,name,evidence) values('news_brand','폴뉴아','플래그십 오픈'),('행사 참여 브랜드','모노커피',''),('홈페이지 문의','문의 A',''),('나라장터 공식 공고','지역 축제 행사 대행 용역',''),('나라장터 공식 공고','청사 청소 용역',''),
  ('거래처','팝업 고객사','지난 팝업 진행'),('거래처','세무 법인','기장'),('민간 영업 후보','브랜드 론칭 준비','론칭 행사 검토'),('리서치','2026 팝업 트렌드','팝업 행사'),('서울시 문화행사','시립 교향악단 정기 공연 행사',''),('담당자','홍길동','팝업 담당'),('네이버 뉴스','팝업 기사','팝업'),('코엑스 행사','서울 카페 박람회','');
 create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns jsonb language sql as $$
  select jsonb_agg(name order by id) from public.sales_prospects p where not p.blocked and coalesce(p.reviewed_assessment,p.assessment) not in ('보류','제외') $$;`)
 await db.exec(sql);await db.exec(sql)
})
test('planning draws only on records that show a need for pop-up or event work',async()=>{
 const names=(await db.query('select private.sales_strategy_queue(gen_random_uuid(),null,null) r')).rows[0].r
 assert.deepEqual(names,['폴뉴아','모노커피','문의 A','지역 축제 행사 대행 용역','팝업 고객사','브랜드 론칭 준비','서울 카페 박람회'])
})
test('an unexpected planner query stops the change',async()=>{
 const other=new PGlite();await other.exec("create schema private;create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns integer language sql as $$select 1$$;")
 await assert.rejects(other.exec(sql),/Unexpected planner source query/)
})
