import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryOf, holdingStatus, parseProjectFolder } from '../supabase/functions/gdrive/folders.ts'

test('프로젝트 폴더 이름 → 연번 · 이름', () => {
  assert.deepEqual(parseProjectFolder('AR2611-15 성수 향수 팝업 - 케이월드미디어', 'AR'), { code: 'AR2611-15', division: 'AR', name: '성수 향수 팝업 - 케이월드미디어' })
  assert.deepEqual(parseProjectFolder('AR2611-01_로레알 게릴라 이벤트', 'AR')?.name, '로레알 게릴라 이벤트')
  assert.equal(parseProjectFolder('TW2610-4 광고 운영', 'TW')?.code, 'TW2610-04')
})

test('가져오지 않는 폴더', () => {
  assert.equal(parseProjectFolder('AR0000 NIC', 'AR'), null)
  assert.equal(parseProjectFolder('AR0000 샘플 폴더', 'AR'), null)
  assert.equal(parseProjectFolder('AR2611-07 AR2611-12 포켓몬 킨텍스 팝업', 'AR'), null)
  assert.equal(parseProjectFolder('TW2611-01 더위클리 일', 'AR'), null)
  assert.equal(parseProjectFolder('AR2613-01 잘못된 달', 'AR'), null)
  assert.equal(parseProjectFolder('AR2611-03', 'AR'), null)
  assert.equal(parseProjectFolder('자료정리', 'AR'), null)
})

test('보관 폴더 상태 · 분류', () => {
  assert.equal(holdingStatus('AR0000 NIC'), 'NIC')
  assert.equal(holdingStatus('AR0000 완료대기 프로젝트'), '완료')
  assert.equal(holdingStatus('AR0000 샘플 폴더'), null)
  assert.equal(holdingStatus('AR2611-11 우리카드'), null)
  assert.equal(categoryOf('롯데백화점 영등포점 팝업'), '팝업')
  assert.equal(categoryOf('LX지인 입찰'), '기타')
})
