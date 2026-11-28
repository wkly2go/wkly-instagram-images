import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardKey, headTitle, readOpen, setOpen } from '../src/lib/foldCards.ts'

test('제목 줄 글에서 숫자 배지 · 오른쪽 링크를 빼고 이름만 남긴다', () => {
  assert.equal(headTitle('내 할 일 5 전체 보기 ›'), '내 할 일')
  assert.equal(headTitle('  업무 흐름  할 일 보기 ›'), '업무 흐름')
  assert.equal(headTitle('팀원별 업무량 전체 ›'), '팀원별 업무량')
  assert.equal(headTitle('마감이 가까운 프로젝트'), '마감이 가까운 프로젝트')
})

test('기억 열쇠는 화면 주소와 제목으로 만든다', () => {
  assert.equal(cardKey('/my', ' 내  할 일 '), '/my|내 할 일')
  assert.equal(cardKey('/ads?tab=flow', '소재별 성과'), '/ads?tab=flow|소재별 성과')
})

test('펼친 것만 기억하고, 접으면 지운다 · 깨진 값은 빈 것으로', () => {
  let m = setOpen({}, '/|업무 흐름', true)
  assert.deepEqual(m, { '/|업무 흐름': 1 })
  m = setOpen(m, '/|업무 흐름', false)
  assert.deepEqual(m, {})
  assert.deepEqual(readOpen('not json'), {})
  assert.deepEqual(readOpen('[1,2]'), {})
  assert.deepEqual(readOpen(null), {})
})

test('기억은 400개까지 — 오래된 것부터 버린다', () => {
  let m: Record<string, 1> = {}
  for (let i = 0; i < 405; i++) m = setOpen(m, `/p|카드 ${i}`, true)
  assert.equal(Object.keys(m).length, 400)
  assert.equal(m['/p|카드 0'], undefined)
  assert.equal(m['/p|카드 404'], 1)
})
