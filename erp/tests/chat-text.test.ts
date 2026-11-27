import test from 'node:test'
import assert from 'node:assert/strict'
import { chatBlocks } from '../src/lib/chatText.ts'

test('항목 표시가 없으면 null', () => {
  assert.equal(chatBlocks('안녕하세요\n오늘 회의 몇 시?'), null)
})

test('결론 · 묶음 제목 · 항목 · 빈 줄로 나눈다', () => {
  const b = chatBlocks('할 일을 만들었습니다.\n\n■ 만든 할 일\n· 계약서 작성 · 11/30(월)\n· 알람 11/30 08:30\n\n확인해 주세요\n1) 광주 건이 맞나요?')!
  assert.deepEqual(b.map(x => x.kind), ['text', 'gap', 'head', 'item', 'item', 'gap', 'head', 'item'])
  assert.equal(b[7].kind === 'item' && b[7].mark, '1.')
})

test('문장으로 끝나는 줄은 제목으로 보지 않는다', () => {
  const b = chatBlocks('앞서 두 건도 확인했습니다.\n· 첫째')!
  assert.equal(b[0].kind, 'text')
})
