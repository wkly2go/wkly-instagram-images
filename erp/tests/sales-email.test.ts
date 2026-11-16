import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseProposal,renderSalesEmailHtml,salesEmailText} from '../src/lib/salesEmail.ts'
export const sample=`제목: 폴뉴아 서울숲 플래그십 연말 고객 초대 행사·팝업 수행 계획
요약: 12월 연말 시즌에 서울숲 플래그십에서 고객 초대 행사와 선물 코너 팝업을 기획부터 운영까지 맡겠습니다.
## 왜 지금
11월 15일 보도에서 폴뉴아 서울숲 플래그십 스토어 오픈이 소개되었습니다. 오픈 직후 연말 시즌은 첫 방문 고객을 단골로 만드는 시기입니다.
## 수행 방식
컨셉 '서울숲의 겨울 산책'. 매장 안 선물 코너, 백팩 체험존, 초대 고객 저녁 행사 세 가지로 구성합니다. 기획·디자인·제작·운영·홍보를 한 팀이 맡습니다.
## 진행 계획
- 1단계 | 1주 | 요구사항 확인, 현장 실측 | 행사 개요서
- 2단계 | 1~2주 | 행사 기획안과 공간 디자인 시안 | 기획안, 디자인 시안
- 3단계 | 2주 | 제작·설치 도면 확정, 운영 매뉴얼 | 도면, 매뉴얼
- 4단계 | 행사 기간 | 설치·운영·콘텐츠 제작 | 현장 운영, 결과 보고
## 역할 분담
- 더위클리: 초대 행사 기획과 현장 운영, 매거진 취재와 홍보 콘텐츠
- 아트리어디자인스튜디오: 선물 코너·체험존 공간 디자인과 제작·설치
## 견적 기준
면적, 운영 기간, 제작 범위(구조물·그래픽·영상), 운영 인력 수를 알려 주시면 견적을 드립니다.
## 다음 단계
이번 주 20~30분 온라인 미팅이 가능하신지, 또는 담당 부서를 안내해 주시면 감사하겠습니다.`
test('the execution plan is read into its parts',()=>{
 const p=parseProposal(sample)
 assert.equal(p.structured,true);assert.match(p.title,/폴뉴아/);assert.match(p.summary,/12월/)
 assert.equal(p.steps.length,4);assert.deepEqual(p.steps[0],{step:'1단계',period:'1주',work:'요구사항 확인, 현장 실측',output:'행사 개요서'})
 assert.deepEqual(p.roles.map(r=>r.who),['더위클리','아트리어디자인스튜디오']);assert.match(p.budget,/견적/);assert.match(p.next,/미팅/);assert.equal(p.rest,'')
})
test('an older free-form proposal is still shown in full',()=>{
 const p=parseProposal('폴뉴아 제안\n\n1. 왜 지금인가\n오픈 직후입니다.')
 assert.equal(p.structured,false);assert.equal(p.title,'폴뉴아 제안');assert.match(p.rest,/오픈 직후/)
 assert.match(renderSalesEmailHtml({subject:'s',body:'b',proposal:'폴뉴아 제안\n\n본문',sender:'a@b.co'}),/본문/)
})
test('the mail escapes text, offers a reply link and carries both companies',()=>{
 const html=renderSalesEmailHtml({subject:'제안 <b>',body:'담당자님께\n<script>x</script>',proposal:sample,sender:'info@thewklyn.com'})
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/mailto:info%40thewklyn.com\?subject=Re%3A/)
 assert.match(html,/더위클리컴퍼니/);assert.match(html,/아트리어디자인스튜디오/);assert.match(html,/산출물 · 행사 개요서/)
 assert.doesNotMatch(html,/#000000|#000\b|background:\s*black/i)
 assert.match(salesEmailText({body:'인사',proposal:sample}),/■ 진행 계획/)
})
