import { test } from 'node:test'
import assert from 'node:assert/strict'
import { campaignSlug, isOwnHost, tagContentVersions, tagLinksInText, tagUrl } from '../src/lib/utmLinks.ts'

const tag = { source: 'instagram', medium: 'social', campaign: 'c1' }

test('우리 홈페이지 주소에만 붙이고 남의 주소 · 이미 붙은 주소는 그대로', () => {
  assert.equal(tagUrl('https://thewklyn.com/report', tag), 'https://thewklyn.com/report?utm_source=instagram&utm_medium=social&utm_campaign=c1')
  assert.equal(tagUrl('https://www.arteriors.co.kr/a?x=1', tag), 'https://www.arteriors.co.kr/a?x=1&utm_source=instagram&utm_medium=social&utm_campaign=c1')
  assert.equal(tagUrl('https://example.com/a', tag), 'https://example.com/a')
  assert.equal(tagUrl('https://thewklyn.com/?utm_source=meta', tag), 'https://thewklyn.com/?utm_source=meta')
  assert.equal(tagUrl('주소 아님', tag), '주소 아님')
  assert.equal(isOwnHost('evil-thewklyn.com'), false)
  assert.equal(isOwnHost('thewklyn.com.evil.kr'), false)
})

test('글 안의 주소: 끝의 마침표는 주소가 아니고 여러 번 해도 같은 결과', () => {
  const once = tagLinksInText('신청은 https://thewklyn.com/report. 참고 https://naver.com', tag)
  assert.equal(once, '신청은 https://thewklyn.com/report?utm_source=instagram&utm_medium=social&utm_campaign=c1. 참고 https://naver.com')
  assert.equal(tagLinksInText(once, tag), once)
})

test('꼬리표 이름: 제목에서 만들고 [시험] 같은 머리말은 뺀다', () => {
  assert.equal(campaignSlug('[시험] 성수 팝업 상권 리포트 · 11월'), '성수-팝업-상권-리포트-11월')
  assert.equal(campaignSlug('   '), 'content')
  assert.ok(campaignSlug('가'.repeat(80)).length <= 40)
})

test('채널별 출처 · 홈페이지 채널은 붙이지 않음 · 바뀐 게 없으면 같은 배열', () => {
  const versions = [
    { channel: '네이버 블로그', body: 'https://thewklyn.com/a' },
    { channel: '인스타그램', body: '프로필 링크 https://thewklyn.com/a' },
    { channel: '홈페이지', body: 'https://thewklyn.com/a' },
    { channel: '유튜브', body: '' },
  ]
  const out = tagContentVersions('연말 팝업', versions)
  assert.match(out[0].body, /utm_source=naver_blog&utm_medium=blog&utm_campaign=%EC%97%B0%EB%A7%90-%ED%8C%9D%EC%97%85/)
  assert.match(out[1].body, /utm_source=instagram&utm_medium=social/)
  assert.equal(out[2].body, 'https://thewklyn.com/a')
  assert.equal(tagContentVersions('연말 팝업', out), out)
})
