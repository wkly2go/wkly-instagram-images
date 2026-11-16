import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),one=async q=>(await db.query(q)).rows[0]
const rows=[['Supabase','invoice+statements@supabase.com','미분류 · New invoice from Supabase'],['Figma','comments-abc@email.figma.com','미분류 · 새로운 댓글 13개'],['GitHub','notifications@github.com','미분류 · Re: [repo] 수정 (PR #1)'],
 ['Adobe','message@adobe.com','미분류 · 인증 코드'],['피어나리','piernari@gmail.com','미분류 · (광고) 연말 트리 협업 제안'],
 ['김현지','hyeonji.kim@saltcake.com','미분류 · 팝업 부스 제작 문의'],['케이브하우스','hello@cavehouse.co.kr','미분류 · Re: [더위클리] 팝업 공간 제휴 제안의 건'],['샥즈 전달','ilovearteriors@naver.com','미분류 · FW: [샥즈] 진열대 제작 견적 문의'],['주소 없음','','미분류 · 문의']]
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;
 create table sales_prospects(id serial primary key,source text,name text,contact text default '',evidence text default '',assessment text default '확인 필요',score integer default 60,reasons text default '',next_action text default '검토',reviewed_assessment text,revision integer default 1);`)
 for(const [name,contact,evidence] of rows)await db.query("insert into sales_prospects(source,name,contact,evidence) values('민간 영업 후보',$1,$2,$3)",[name,contact,evidence])
 await db.exec(`insert into sales_prospects(source,name,contact,evidence,reviewed_assessment,assessment) values('민간 영업 후보','대표가 살린 알림','no-reply@x.com','미분류 · receipt','우선 검토','우선 검토');
 insert into sales_prospects(source,name,contact,evidence) values('거래처','다른 출처','no-reply@x.com','invoice');`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090131_sales_mail_noise.sql',import.meta.url),'utf8'))
})
test('service notices are excluded, inbound adverts are held, real enquiries stay',async()=>{
 const got=Object.fromEntries((await db.query('select name,assessment from sales_prospects')).rows.map(r=>[r.name,r.assessment]))
 assert.deepEqual(got,{Supabase:'제외',Figma:'제외',GitHub:'제외',Adobe:'제외','피어나리':'보류','김현지':'확인 필요','케이브하우스':'확인 필요','샥즈 전달':'확인 필요','주소 없음':'확인 필요','대표가 살린 알림':'우선 검토','다른 출처':'확인 필요'})
 assert.deepEqual(await one("select score,reasons,next_action from sales_prospects where name='Supabase'"),{score:0,reasons:'영업 대상 아님: 서비스 자동 알림 메일',next_action:'조치 없음'})
})
test('a notice saved again stays out',async()=>{
 await db.exec("update sales_prospects set assessment='우선 검토',score=90 where name='GitHub';insert into sales_prospects(source,name,contact,evidence) values('민간 영업 후보','Notion','notify@updates.notion.so','미분류 · 새 기기로 계정에 로그인했습니다.')")
 assert.equal((await one("select count(*)::int n from sales_prospects where assessment='제외'")).n,5)
})
