import test from 'node:test'
import assert from 'node:assert/strict'
import { dropSelectLists } from '../src/lib/screenText.ts'

test('고르기 목록은 고른 항목만 남긴다', () => {
  const all = '프로젝트 없음\nAR2611-12 포켓몬\nAR2611-04 솔트케이크'
  const text = `견적 보내기\n${all}\n박기호\n도면 확인\n${all}\n이채원`
  const out = dropSelectLists(text, [{ all, picked: 'AR2611-12 포켓몬' }, { all, picked: '프로젝트 없음' }])
  assert.equal(out, '견적 보내기\nAR2611-12 포켓몬\n박기호\n도면 확인\n프로젝트 없음\n이채원')
})

test('목록이 글에 없거나 항목이 하나면 그대로 둔다', () => {
  assert.equal(dropSelectLists('가\n나', [{ all: '다\n라', picked: '다' }]), '가\n나')
  assert.equal(dropSelectLists('가\n나', [{ all: '가', picked: '가' }]), '가\n나')
  assert.equal(dropSelectLists('가', [{ all: '', picked: '' }]), '가')
})
