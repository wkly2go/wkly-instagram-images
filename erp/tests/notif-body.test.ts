import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNotifBody } from '../src/lib/notifBody.ts'

const report = [
  'AI 비서 자동 작성 · 사람 검수 전 · 근거: 할 일 목록, 11/27 18:00 조회',
  '오늘(11/27) 마감 미완료 전원 4건: 이보아 3 · 박기호 1',
  '· 대표님 건: 백링크 목록 리스트업 (할 일)',
  '이보아님에게 알림 보냄.',
  '■ 중요 프로젝트 업무 3건',
  '· [포켓몬 킨텍스] 견적 검토 · 김동은 · 마감 11/22(5일 지남)',
  '2) 하이브 연말 파티 · 이채원',
].join('\n')

test('근거 줄은 meta 로 빼고 묶음 제목 · 항목 · 글 줄로 나눈다', () => {
  const { lines, meta } = parseNotifBody(report)
  assert.match(meta ?? '', /^AI 비서 자동 작성/)
  assert.deepEqual(lines.map(l => l.kind), ['head', 'item', 'text', 'head', 'item', 'item'])
  assert.equal(lines[3].text, '중요 프로젝트 업무 3건')
})

test('항목은 첫 조각과 부가 정보로 나누고 지난 기한은 late', () => {
  const item = parseNotifBody(report).lines[4]
  assert.equal(item.kind, 'item')
  if (item.kind !== 'item') return
  assert.equal(item.text, '[포켓몬 킨텍스] 견적 검토')
  assert.deepEqual(item.detail, ['김동은', '마감 11/22(5일 지남)'])
  assert.equal(item.late, true)
})

test('한 줄짜리 · 빈 글은 그대로', () => {
  assert.deepEqual(parseNotifBody('[시험] 두낫팅 팝업 2차').lines, [{ kind: 'text', text: '[시험] 두낫팅 팝업 2차' }])
  assert.deepEqual(parseNotifBody(null), { lines: [], meta: null })
})

test('[프로젝트] 로 시작하지 않는 항목은 나누지 않는다', () => {
  const l = parseNotifBody('· 담당별: 이보아 3 · 박기호 1').lines[0]
  assert.equal(l.kind === 'item' && l.text, '담당별: 이보아 3 · 박기호 1')
})
