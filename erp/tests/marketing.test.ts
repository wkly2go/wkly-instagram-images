import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultMarketingCampaign, validateMarketingCampaign, marketingTodayKST, marketingDays,
  patchMarketingCampaign, buildMarketingUTM, buildMarketingHandoff, buildMarketingHandoffText,
  parseMarketingBackup, MARKETING_ASSET_MAX_BYTES, marketingImageSignatureMatches,
  type MarketingCampaign, type MarketingAsset,
} from '../src/lib/marketing.ts'

const TODAY = '2030-01-10'
function readyCampaign(): MarketingCampaign {
  return {
    ...defaultMarketingCampaign(), startDate: TODAY, endDate: '2030-01-12',
    dailyBudget: 10000, totalBudget: 30000,
    reviews: { content: true, rights: true, budget: true }, status: 'ready',
  }
}
function assetFor(c: MarketingCampaign): MarketingAsset {
  return { id: crypto.randomUUID(), campaignId: c.id, name: '공간.png', mime: 'image/png', size: 1200, createdAt: new Date().toISOString() }
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6coYAAAAASUVORK5CYII='
function backup(c: MarketingCampaign, assetIds: string[] = []) {
  return {
    app: 'wkly-marketing-desk', version: 1,
    stores: {
      campaigns: [{ ...c, assetIds }],
      assets: assetIds.map(id => ({ id, name: '공간.png', type: 'image/png', size: atob(png).length, base64: png })),
      metrics: [],
    },
  }
}

test('한국 자정의 날짜 변경과 윤년 운영일수를 계산한다', () => {
  assert.equal(marketingTodayKST(new Date('2029-12-31T15:00:00Z')), '2030-01-01')
  assert.equal(marketingTodayKST(new Date('2029-12-31T14:59:59Z')), '2029-12-31')
  assert.equal(marketingDays({ startDate: '2028-02-28', endDate: '2028-03-01' }), 3)
  assert.equal(marketingDays({ startDate: '2029-02-29', endDate: '2029-03-01' }), null)
})

test('미정 예산과 빈 기획 필드는 초안으로 저장할 수 있지만 준비 완료는 아니다', () => {
  const c = { ...defaultMarketingCampaign(), landingUrl: '', startDate: '', endDate: '', headline: '', primaryText: '', cta: '' }
  const draft = validateMarketingCampaign(c, [], { today: TODAY })
  assert.deepEqual(draft.errors, [])
  assert.equal(draft.ready, false)
  assert.ok(draft.warnings.length >= 6)
  assert.ok(validateMarketingCampaign(c, [], { forHandoff: true, today: TODAY }).errors.length >= 6)
})

test('금액은 실제로 입력한 양의 정수만 허용한다', () => {
  const c = readyCampaign(), assets = [assetFor(c)]
  for (const value of [NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, '10000']) {
    const invalid = { ...c, dailyBudget: value as number }
    assert.ok(validateMarketingCampaign(invalid, assets, { today: TODAY }).errors.some(e => e.includes('정수')))
  }
  assert.equal(defaultMarketingCampaign().dailyBudget, null)
  assert.equal(defaultMarketingCampaign().totalBudget, null)
})

test('일 예산과 기간이 총예산을 넘으면 전달을 막는다', () => {
  const c = readyCampaign(), assets = [assetFor(c)]
  assert.equal(validateMarketingCampaign(c, assets, { forHandoff: true, today: TODAY }).ready, true)
  assert.ok(validateMarketingCampaign({ ...c, totalBudget: 29999 }, assets, { today: TODAY }).errors.some(e => e.includes('총예산을 초과')))
  assert.ok(validateMarketingCampaign({ ...c, totalBudget: 9999 }, assets, { today: TODAY }).errors.some(e => e.includes('일 예산이 총예산보다')))
})

test('과거 일정은 보관 가능한 초안이나 광고 전달 자료로 사용할 수 없다', () => {
  const c = { ...readyCampaign(), startDate: '2030-01-09', endDate: '2030-01-11' }, assets = [assetFor(c)]
  assert.deepEqual(validateMarketingCampaign(c, assets, { today: TODAY }).errors, [])
  assert.equal(validateMarketingCampaign(c, assets, { today: TODAY }).ready, false)
  assert.ok(validateMarketingCampaign(c, assets, { forHandoff: true, today: TODAY }).errors.some(e => e.includes('시작일이 지났')))
})

test('잘못된 날짜와 비공식 상태·채널을 초안에서도 거부한다', () => {
  const c = readyCampaign()
  assert.ok(validateMarketingCampaign({ ...c, startDate: '2030-02-30' }).errors.length)
  assert.ok(validateMarketingCampaign({ ...c, endDate: '2030-01-01' }).errors.some(e => e.includes('종료일')))
  assert.ok(validateMarketingCampaign({ ...c, status: 'active' as 'ready' }).errors.some(e => e.includes('준비 상태')))
  assert.ok(validateMarketingCampaign({ ...c, platform: 'other' as 'meta' }).errors.some(e => e.includes('채널')))
})

test('스크립트와 로그인 정보가 포함된 URL은 저장·전달·UTM 생성에서 거부한다', () => {
  for (const landingUrl of ['javascript:alert(1)', 'data:text/html,hello', 'https://user:secret@example.com', 'https://example.com/\npath']) {
    const c = { ...readyCampaign(), landingUrl }
    assert.ok(validateMarketingCampaign(c).errors.some(e => e.includes('주소')))
    assert.equal(buildMarketingUTM(c), '')
  }
})

test('UTM은 기존 문의 파라미터와 앵커를 보존하고 채널·캠페인 식별값을 적용한다', () => {
  const c = { ...readyCampaign(), landingUrl: 'https://example.com/space?location=seoul&utm_source=old#contact' }
  const url = new URL(buildMarketingUTM(c))
  assert.equal(url.searchParams.get('location'), 'seoul')
  assert.equal(url.searchParams.get('utm_source'), 'meta')
  assert.equal(url.searchParams.get('utm_campaign'), c.id)
  assert.equal(url.hash, '#contact')
})

test('내용·기간·소재 방식 변경으로 관련 검토와 준비 상태가 해제된다', () => {
  const c = readyCampaign()
  const copy = patchMarketingCampaign(c, { headline: '새 제목' })
  assert.deepEqual(copy.reviews, { content: false, rights: true, budget: true })
  assert.equal(copy.status, 'draft')
  const budget = patchMarketingCampaign(c, { dailyBudget: 9000 })
  assert.deepEqual(budget.reviews, { content: true, rights: true, budget: false })
  const platform = patchMarketingCampaign(c, { platform: 'naver' })
  assert.deepEqual(platform.reviews, { content: false, rights: false, budget: false })
  assert.deepEqual(c.reviews, { content: true, rights: true, budget: true })
  assert.equal(patchMarketingCampaign(c, { headline: c.headline }).status, 'ready')
})

test('다른 캠페인의 소재·중복·초과 크기는 준비 완료에 사용할 수 없다', () => {
  const c = readyCampaign(), asset = assetFor(c)
  for (const assets of [[{ ...asset, campaignId: crypto.randomUUID() }], [asset, asset], [{ ...asset, size: MARKETING_ASSET_MAX_BYTES + 1 }], [{ ...asset, mime: 'image/svg+xml' }]]) {
    const result = validateMarketingCampaign(c, assets, { forHandoff: true, today: TODAY })
    assert.equal(result.ready, false)
    assert.ok(result.errors.some(e => e.includes('소재 정보')))
  }
})

test('네이버에서 확인한 텍스트 광고만 이미지 없이 준비 완료할 수 있다', () => {
  const c = { ...readyCampaign(), platform: 'naver' as const, textAdConfirmed: true }
  assert.equal(validateMarketingCampaign(c, [], { forHandoff: true, today: TODAY }).ready, true)
  assert.equal(validateMarketingCampaign({ ...c, platform: 'meta' }, [], { forHandoff: true, today: TODAY }).ready, false)
  assert.equal(validateMarketingCampaign({ ...c, reviews: { ...c.reviews, rights: false } }, [], { forHandoff: true, today: TODAY }).ready, false)
})

test('전달 자료에는 미집행 상태와 필요한 내용만 담고 서명 주소는 내보내지 않는다', () => {
  const c = { ...readyCampaign(), startDate: '2099-01-01', endDate: '2099-01-03' }
  const assets = [{ ...assetFor(c), url: 'https://private.example.com/signed?token=secret', path: 'private/path' }]
  const pack = buildMarketingHandoff(c, assets)
  assert.equal(pack.execution.submitted, false)
  assert.equal(pack.execution.spent, false)
  assert.equal(JSON.stringify(pack).includes('token=secret'), false)
  assert.equal(JSON.stringify(pack.assets).includes('private/path'), false)
  assert.ok(buildMarketingHandoffText(c, assets).includes('계획 총예산: 30,000원'))
  assert.throws(() => buildMarketingHandoff({ ...c, totalBudget: null }, assets), /총예산/)
  pack.campaign.title = 'export changed'
  assert.notEqual(c.title, 'export changed')
})

test('기기 백업은 새 ID의 초안과 검토 해제 상태로 읽고 이미지 바이트를 보존한다', () => {
  const c = readyCampaign(), payload = backup(c, ['legacy-photo'])
  payload.stores.campaigns[0].status = 'active' as 'ready'
  const parsed = parseMarketingBackup(JSON.stringify(payload))
  const row = parsed.campaigns[0]
  assert.notEqual(row.campaign.id, c.id)
  assert.equal(row.sourceId, c.id)
  assert.equal(row.campaign.revision, 0)
  assert.equal(row.campaign.status, 'draft')
  assert.deepEqual(row.campaign.reviews, { content: false, rights: false, budget: false })
  assert.equal(row.assets[0].bytes.length, atob(png).length)
  assert.equal(row.assets[0].mime, 'image/png')
  assert.ok(parsed.warnings.some(w => w.includes('성과')))
})

test('중복 ID·사라진 이미지·필드 누락 백업은 저장 전에 전체를 거부한다', () => {
  const c = readyCampaign()
  const duplicate = backup(c)
  duplicate.stores.campaigns.push(duplicate.stores.campaigns[0])
  assert.throws(() => parseMarketingBackup(JSON.stringify(duplicate)), /중복/)
  const missing = backup(c, ['missing'])
  missing.stores.assets = []
  assert.throws(() => parseMarketingBackup(JSON.stringify(missing)), /원본/)
  const malformed = backup(c)
  delete (malformed.stores.campaigns[0] as Partial<MarketingCampaign>).headline
  assert.throws(() => parseMarketingBackup(JSON.stringify(malformed)), /빠져/)
})

test('백업 MIME·파일 크기 위장과 스크립트 내용은 거부한다', () => {
  const c = readyCampaign()
  const payload = backup(c, ['photo'])
  payload.stores.assets[0].type = 'image/jpeg'
  assert.throws(() => parseMarketingBackup(JSON.stringify(payload)), /맞지/)
  payload.stores.assets[0].type = 'image/png'
  payload.stores.assets[0].size += 1
  assert.throws(() => parseMarketingBackup(JSON.stringify(payload)), /맞지/)
  assert.equal(marketingImageSignatureMatches(new TextEncoder().encode('<svg onload="x"/>'), 'image/png'), false)
})
