import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wrapText, adFileName, AD_SIZES } from '../src/lib/adCreative.ts'
import { parseAdCopyVariants } from '../src/lib/adCopy.ts'

const m = (s: string) => s.length * 10

test('wrapText breaks at spaces first, then by character', () => {
  assert.deepEqual(wrapText(m, '브랜드에 맞는 팝업 공간', 80), ['브랜드에 맞는', '팝업 공간'])
  assert.deepEqual(wrapText(m, '아주아주아주긴낱말입니다', 50), ['아주아주아', '주긴낱말입', '니다'])
  assert.deepEqual(wrapText(m, '첫 줄\n둘째 줄', 200), ['첫 줄', '둘째 줄'])
})

test('adFileName strips unsafe characters and names the size', () => {
  assert.equal(adFileName('성수/팝업: 11월', AD_SIZES[0], 'band', 'image/jpeg'), '성수_팝업_ 11월_1080x1080_band.jpg')
  assert.equal(adFileName('', AD_SIZES[3], 'color', 'image/png'), '광고_1200x628_color.png')
})

test('parseAdCopyVariants reads three variants in the requested format', () => {
  const out = parseAdCopyVariants(`[1안]\n제목: 공간이 브랜드가 됩니다\n본문: 첫 줄\n둘째 줄\n보조: 포트폴리오 보기\n행동: 문의하기\n\n[2안]\n**제목:** 두 번째\n본문: 내용\n행동: "더 알아보기"\n\n[3안]\n제목: 세 번째\n본문: 셋\n검토할 사실: 수치 확인`)
  assert.equal(out.length, 3)
  assert.equal(out[0].primaryText, '첫 줄\n둘째 줄')
  assert.equal(out[0].description, '포트폴리오 보기')
  assert.equal(out[1].headline, '두 번째')
  assert.equal(out[1].cta, '더 알아보기')
  assert.equal(out[2].primaryText, '셋')
})

test('parseAdCopyVariants returns nothing for free text', () => {
  assert.deepEqual(parseAdCopyVariants('그냥 설명입니다.'), [])
})

import { lintAdCopy, parseAdPlan, adCopyRequest } from '../src/lib/adCopy.ts'

test('parseAdCopyVariants keeps angle and proof', () => {
  const [v] = parseAdCopyVariants('[1안]\n앵글: 공감 · 문제\n근거: 매거진이 직접 알림\n제목: 장소 찾다 11월 다 갑니다\n본문: 한 줄\n행동: 문의하기')
  assert.equal(v.angle, '공감 · 문제')
  assert.equal(v.proof, '매거진이 직접 알림')
  assert.equal(v.headline, '장소 찾다 11월 다 갑니다')
})

test('lintAdCopy flags limits, translationese, generic one-stop and unproven numbers', () => {
  const base = { platform: 'google' as const, headline: '기획부터 철거까지 원스톱으로 한 번에', primaryText: '고객을 위한 팝업, 매출 30% 상승', description: '', cta: '문의하기', seasonNote: '' }
  const msgs = lintAdCopy(base).map(i => i.message).join('\n')
  assert.match(msgs, /15자 이내/)
  assert.match(msgs, /번역투/)
  assert.match(msgs, /원스톱/)
  assert.match(msgs, /숫자 근거/)
  assert.deepEqual(lintAdCopy({ platform: 'meta', headline: '견적서 한 장으로 결재 끝', primaryText: '팝업 매거진이 직접 고른 성수 공간', description: '', cta: '문의하기' }), [])
})

test('lintAdCopy asks for the season keyword in every copy', () => {
  const issues = lintAdCopy({ platform: 'meta', headline: '연말 팝업 준비', primaryText: '', description: '', cta: '', seasonNote: '크리스마스' })
  assert.ok(issues.some(i => i.message.includes('크리스마스')))
})

test('parseAdPlan reads the planning fields', () => {
  const d = parseAdPlan('타깃: 성수 팝업을 준비하는 브랜드 마케터\n인사이트: 공간 찾기가 가장 오래 걸림\n약속: 매거진이 고른 공간\n매체 · 예산: 메타 70% 구글 30%\n시험: 앵글 A/B, 7일 CTR')
  assert.ok(d)
  assert.equal(d!.channel, '메타 70% 구글 30%')
  assert.equal(d!.audience, '성수 팝업을 준비하는 브랜드 마케터')
})

test('adCopyRequest carries company rules and stays within the request limit', () => {
  const r = adCopyRequest({ platform: 'google', seasonNote: '크리스마스 팝업' }, 'x'.repeat(2000))
  assert.ok(r.includes('스왑 테스트') && r.includes('크리스마스') && r.length <= 6000)
})
