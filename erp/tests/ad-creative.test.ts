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
