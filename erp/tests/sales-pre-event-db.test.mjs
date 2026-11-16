import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile(new URL('../supabase/migrations/20261116120800_sales_pre_event_targeting.sql',import.meta.url),'utf8')
const base=`create schema private;
 create function private.sales_public_inquiry_email(e jsonb) returns text language sql as $$select null::text$$;
 create table public.sales_methods(name text primary key,signal text,updated_at timestamptz);
 insert into public.sales_methods values('신규 매장·플래그십 오픈 후속','x',now()),('팝업 오픈 브랜드 후속 제안','x',now()),('박람회·전시 참가사 부스 제안','x',now()),('대행사·기획사 협력 제안','x',now());
 create table public.sales_prospects(id serial primary key,source text,evidence text,event_data jsonb default '{}',source_updated_at timestamptz default now(),reviewed_assessment text,blocked boolean default false,assessment text default '확인 필요',end_date date,score integer default 0);
 create function private.sales_brand_score() returns trigger language plpgsql as $$begin return new;end $$;
 create trigger sales_brand_score before insert or update on public.sales_prospects for each row execute function private.sales_brand_score();`
test('already-reported events score below upcoming ones; past fairs below future fairs',async()=>{
 const db=new PGlite();await db.exec(base)
 await db.exec(`insert into public.sales_prospects(source,evidence,end_date) values
  ('news_brand','보도에서 확인: DDP 체험형 팝업스토어 · 지난 12일부터',null),
  ('news_brand','보도에서 확인: 성수 팝업 오픈 예정 · 다음달 5일',null),
  ('행사 참여 브랜드','확인 사실: 참가사 등재. 행사기간 2026-11-12~2026-11-15',(now()-interval '1 day')::date),
  ('행사 참여 브랜드','확인 사실: 참가사 등재. 행사기간 '||to_char(now()+interval '40 days','YYYY-MM-DD')||'~'||to_char(now()+interval '43 days','YYYY-MM-DD'),(now()+interval '43 days')::date)`)
 await db.exec(sql)
 const s=(await db.query('select score from public.sales_prospects order by id')).rows.map(r=>r.score)
 assert.ok(s[1]>s[0]+30,'upcoming news above reported');assert.ok(s[3]>s[2]+40,'future fair above past fair')
 assert.match((await db.query("select signal from public.sales_methods where name='팝업 오픈 브랜드 후속 제안'")).rows[0].signal,/대행사 미정/)
})
