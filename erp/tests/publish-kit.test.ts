import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blocksToHtml, blocksToPlain, hashTags, parseBlocks, publishChecks } from '../src/lib/publishKit.ts'

const body = `성수 팝업 대관, 12월 예약을 받습니다.
연말 팝업을 준비하는 담당자라면 일정부터 확인하세요.

어떤 공간인가

[사진: 1층 전경]

1층 60평, 층고 4.2m 공간입니다. **전면 유리** 로 안이 보입니다.

## 이용 방법
- 홈페이지에서 날짜 확인
- 상담 신청

1. 문의
2. 답사

자세한 내용은 https://thewklyn.com/space?x=1. 에서 볼 수 있습니다.`

test('글을 소제목 · 문단 · 목록 · 사진 자리로 나눈다', () => {
  const b = parseBlocks(body)
  assert.deepEqual(b.map(x => x.type), ['p', 'h', 'photo', 'p', 'h', 'ul', 'ol', 'p'])
  assert.equal((b[1] as { text: string }).text, '어떤 공간인가')
  assert.equal((b[2] as { text: string }).text, '1층 전경')
  assert.equal((b[4] as { text: string }).text, '이용 방법')
  assert.deepEqual((b[5] as { items: string[] }).items, ['홈페이지에서 날짜 확인', '상담 신청'])
})

test('문장으로 끝나는 짧은 한 줄 · 맨 끝 한 줄 · 주소 한 줄은 소제목이 아니다', () => {
  assert.deepEqual(parseBlocks('예약을 받습니다.\n\n본문입니다.').map(x => x.type), ['p', 'p'])
  assert.deepEqual(parseBlocks('본문입니다.\n\n마지막 한 줄').map(x => x.type), ['p', 'p'])
  assert.deepEqual(parseBlocks('https://thewklyn.com/a\n\n본문입니다.').map(x => x.type), ['p', 'p'])
})

test('HTML: 글자는 안전하게 바꾸고 주소는 링크 · 끝 마침표는 링크 밖 · 굵게', () => {
  const html = blocksToHtml(parseBlocks(body))
  assert.match(html, /<h3><b>어떤 공간인가<\/b><\/h3>/)
  assert.match(html, /<a href="https:\/\/thewklyn\.com\/space\?x=1">https:\/\/thewklyn\.com\/space\?x=1<\/a>\. 에서/)
  assert.match(html, /<b>전면 유리<\/b>/)
  assert.match(html, /〔사진 자리: 1층 전경〕/)
  assert.match(html, /<ul><li>홈페이지에서 날짜 확인<\/li><li>상담 신청<\/li><\/ul>/)
  assert.match(html, /성수 팝업 대관, 12월 예약을 받습니다\.<br>연말 팝업을/)
  const evil = blocksToHtml(parseBlocks('<script>alert(1)</script> & "따옴표"'))
  assert.doesNotMatch(evil, /<script>/)
  assert.match(evil, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;따옴표&quot;/)
})

test('서식 없는 글 · 태그', () => {
  const plain = blocksToPlain(parseBlocks(body))
  assert.match(plain, /^성수 팝업 대관/)
  assert.match(plain, /\n\n이용 방법\n\n- 홈페이지에서 날짜 확인\n- 상담 신청\n\n1\. 문의\n2\. 답사/)
  assert.equal(hashTags('성수팝업, #대관  성수팝업,연말'), '#성수팝업 #대관 #연말')
  assert.equal(hashTags('  '), '')
})

test('게시 전 점검: 제목 · 본문 길이 · [확인 필요] · 소제목 · 사진 · 태그 · 꼬리표', () => {
  const c = publishChecks('네이버 블로그', '성수 팝업 대관 12월 예약 안내와 공간 소개', body, '성수팝업')
  assert.equal(c.length, 7)
  assert.equal(c[0].ok, true)
  assert.equal(c[1].ok, false) // 1,500자에 못 미침
  assert.equal(c[2].ok, true)
  assert.equal(c[3].ok, true)
  assert.equal(c[4].ok, true)
  assert.equal(c[5].ok, true)
  assert.equal(c[6].ok, false) // 꼬리표 없는 우리 주소 1개
  assert.equal(publishChecks('네이버 블로그', '제목', '[확인 필요: 날짜]', '')[2].ok, false)
  assert.equal(publishChecks('네이버 블로그', '제목', 'https://thewklyn.com/a?utm_source=naver_blog', '')[6].ok, true)
  assert.equal(publishChecks('홈페이지', '공지 제목입니다', '가'.repeat(400), '').length, 3)
  assert.deepEqual(publishChecks('인스타그램', 't', 'b', ''), [])
})
