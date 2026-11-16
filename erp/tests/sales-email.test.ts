import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseProposal,renderSalesEmailHtml,salesEmailText} from '../src/lib/salesEmail.ts'
export const sample=`제목: 폴뉴아 서울숲 플래그십 연말 고객 초대 행사·팝업 수행 계획
요약: 12월 연말 시즌에 서울숲 플래그십에서 고객 초대 행사와 선물 코너 팝업을 기획부터 운영까지 맡겠습니다.
## 왜 지금
11월 15일 보도에서 폴뉴아 서울숲 플래그십 스토어 오픈이 소개되었습니다. 오픈 직후 연말 시즌은 첫 방문 고객을 단골로 만드는 시기입니다.
## 수행 방식
컨셉 '서울숲의 겨울 산책'. 매장 안 선물 코너, 백팩 체험존, 초대 고객 저녁 행사 세 가지로 구성합니다. 기획·디자인·제작·운영·홍보를 더위클리와 크루가 한 팀으로 맡습니다.
## 진행 계획
- 1단계 | 1주 | 요구사항 확인, 현장 실측 | 행사 개요서
- 2단계 | 1~2주 | 행사 기획안과 공간 디자인 시안 | 기획안, 디자인 시안
- 3단계 | 2주 | 제작·설치 도면 확정, 운영 매뉴얼 | 도면, 매뉴얼
- 4단계 | 행사 기간 | 설치·운영·콘텐츠 제작 | 현장 운영, 결과 보고
## 역할 분담
- 더위클리 기획·운영: 초대 행사 기획과 현장 운영, 매거진 취재와 홍보 콘텐츠
- 더위클리 크루 · 공간 디자인·제작: 선물 코너·체험존 공간 디자인과 제작·설치
## 견적 기준
면적, 운영 기간, 제작 범위(구조물·그래픽·영상), 운영 인력 수를 알려 주시면 견적을 드립니다.
## 다음 단계
이번 주 20~30분 온라인 미팅이 가능하신지, 또는 담당 부서를 안내해 주시면 감사하겠습니다.`
test('the execution plan is read into its parts',()=>{
 const p=parseProposal(sample)
 assert.equal(p.structured,true);assert.match(p.title,/폴뉴아/);assert.match(p.summary,/12월/)
 assert.equal(p.steps.length,4);assert.deepEqual(p.steps[0],{step:'1단계',period:'1주',work:'요구사항 확인, 현장 실측',output:'행사 개요서'})
 assert.deepEqual(p.roles.map(r=>r.who),['더위클리 기획·운영','더위클리 크루 · 공간 디자인·제작']);assert.match(p.budget,/견적/);assert.match(p.next,/미팅/);assert.equal(p.rest,'')
})
test('an older free-form proposal is still shown in full',()=>{
 const p=parseProposal('폴뉴아 제안\n\n1. 왜 지금인가\n오픈 직후입니다.')
 assert.equal(p.structured,false);assert.equal(p.title,'폴뉴아 제안');assert.match(p.rest,/오픈 직후/)
 assert.match(renderSalesEmailHtml({subject:'s',body:'b',proposal:'폴뉴아 제안\n\n본문',sender:'a@b.co'}),/본문/)
})
test('the mail escapes text, offers a reply link and carries both companies',()=>{
 const html=renderSalesEmailHtml({subject:'제안 <b>',body:'담당자님께\n<script>x</script>',proposal:sample,sender:'info@thewklyn.com'})
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/mailto:info%40thewklyn.com\?subject=Re%3A/)
 assert.match(html,/더위클리컴퍼니/);assert.match(html,/더위클리 크루/);assert.doesNotMatch(html,/아트리어/);assert.match(html,/산출물 · 행사 개요서/)
 assert.doesNotMatch(html,/#000000|#000\b|background:\s*black/i)
 assert.match(salesEmailText({body:'인사',proposal:sample}),/■ 진행 계획/)
})
export const friendly=`제목: 폴뉴아 서울숲 연말, 이런 팝업 어떠세요?
요약: 새로 문을 연 서울숲 플래그십에서 연말을 함께 즐길 작은 아이디어 세 가지를 들고 왔어요.
## 이런 아이디어는 어떠세요
- 겨울 산책 선물 코너: 서울숲을 걷다 들른 손님이 백팩에 작은 겨울 키트를 담아 가는 코너예요.
- 백팩 짐 싸기 체험존: 여행 가방을 직접 꾸려 보며 수납을 체험하고, 사진을 남기는 공간이에요.
- 단골 초대의 밤: 오픈 고객을 다시 초대해 음악과 함께 신제품을 먼저 보여 드리는 저녁 행사예요.
## 함께하면 이렇게 진행해요
- 1단계 | 1주 | 매장 둘러보고 원하시는 방향 듣기 | 아이디어 한 장
- 2단계 | 2주 | 컨셉 시안과 공간 그림 | 시안
- 3단계 | 행사 기간 | 제작·설치·운영·사진 콘텐츠 | 현장 운영과 결과 정리
## 다음 단계
이번 주나 다음 주에 20분 정도 편하게 통화하실 수 있을까요?`
test('a first mail shows friendly idea cards and a light three-step path',()=>{
 const p=parseProposal(friendly)
 assert.equal(p.ideas.length,3);assert.equal(p.ideas[0].name,'겨울 산책 선물 코너');assert.equal(p.stepsTitle,'함께하면 이렇게 진행해요');assert.equal(p.steps.length,3)
 const html=renderSalesEmailHtml({subject:'s',body:'담당자님, 안녕하세요!\n원치 않으시면 편하게 답장으로 알려 주세요.\n더위클리 드림',proposal:friendly,sender:'info@thewklyn.com'})
 assert.match(html,/이런 아이디어는 어떠세요/);assert.match(html,/결과물 · 아이디어 한 장/);assert.match(html,/편하게 답장하기/)
 assert.ok(html.indexOf('편하게 답장으로 알려')>html.indexOf('편하게 답장하기'))
})
