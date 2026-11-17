// 카카오톡 '대화 내용 내보내기' 읽기 — 1단계 점검(2026-11-18) 전에 PC · 안드로이드 · 아이폰 · CSV 모양을 시험
// 이름 · 내용은 모두 지어낸 것. 실제 내보내기 파일 시험은 대표님 파일로 따로 함.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseKakao } from '../src/lib/kakao.ts'

test('PC 내보내기: 날짜 줄 + [보낸이] [오후 3:24] · 여러 줄 · 첨부', () => {
  const raw = [
    '﻿시험 현장 단톡방 님과 카카오톡 대화',
    '저장한 날짜 : 2026-11-18 10:12:33',
    '',
    '--------------- 2026년 11월 10일 화요일 ---------------',
    '[김민지] [오후 3:24] 안녕하세요, 도면 확인 부탁드립니다.',
    '[박서연] [오후 3:25] 네 확인했습니다.',
    '수정본은 내일 드릴게요.',
    '[김민지] [오후 3:26] 사진',
    '[박서연] [오전 12:05] 늦은 시간 죄송합니다',
    '--------------- 2026년 11월 11일 수요일 ---------------',
    '[김민지] [오전 9:01] 파일: 평면도_수정.pdf',
  ].join('\r\n')
  const r = parseKakao(raw)
  assert.equal(r.title, '시험 현장 단톡방 님과 카카오톡 대화')
  assert.equal(r.messages.length, 5)
  assert.equal(r.messages[0].sent_at, '2026-11-10T15:24:00+09:00')
  assert.equal(r.messages[1].content, '네 확인했습니다.\n수정본은 내일 드릴게요.')
  assert.equal(r.messages[2].attachment, '사진')
  assert.equal(r.messages[3].sent_at, '2026-11-10T00:05:00+09:00', '오전 12시는 0시')
  assert.equal(r.messages[4].sent_at, '2026-11-11T09:01:00+09:00')
  assert.equal(r.messages[4].attachment, '파일: 평면도_수정.pdf')
})

test('안드로이드 내보내기: "2026년 11월 10일 오후 3:24, 보낸이 : 내용" · 들어옴 줄은 건너뜀', () => {
  const raw = [
    '시험 현장 단톡방 님과 카카오톡 대화',
    '저장한 날짜 : 2026년 11월 18일 오전 10:12',
    '',
    '2026년 11월 10일 화요일',
    '2026년 11월 10일 오후 3:24, 김민지 : 안녕하세요',
    '2026년 11월 10일 오후 3:25, 김민지님이 박서연님을 초대했습니다.',
    '2026년 11월 10일 오후 12:30, 박서연 : 점심 뒤에 통화 가능합니다',
    '그때 뵐게요',
    '2026년 11월 10일 오후 12:31, 박서연 : 현장사진_01.jpg',
  ].join('\n')
  const r = parseKakao(raw)
  assert.equal(r.messages.length, 3)
  assert.deepEqual(r.messages.map(m => m.sender), ['김민지', '박서연', '박서연'])
  assert.equal(r.messages[1].sent_at, '2026-11-10T12:30:00+09:00', '오후 12시는 12시')
  assert.equal(r.messages[1].content, '점심 뒤에 통화 가능합니다\n그때 뵐게요')
  assert.equal(r.messages[2].attachment, '파일: 현장사진_01.jpg')
})

test('아이폰 내보내기: "2026. 11. 10. 오후 3:24, 보낸이 : 내용" · 내용 안의 " : " 는 그대로', () => {
  const raw = [
    '시험 현장 단톡방 카카오톡 대화',
    '저장한 날짜 : 2026. 11. 18. 오전 10:12',
    '',
    '2026년 11월 10일 화요일',
    '2026. 11. 10. 오후 3:24, 김민지 : 일정 : 목요일 오후 2시 현장',
    '2026. 11. 10. 오후 3:30, 박서연 : 사진 3장',
    '2026. 11. 10. 오후 3:31: 박서연님이 나갔습니다.',
  ].join('\n')
  const r = parseKakao(raw)
  assert.equal(r.messages.length, 2)
  assert.equal(r.messages[0].sender, '김민지')
  assert.equal(r.messages[0].content, '일정 : 목요일 오후 2시 현장')
  assert.equal(r.messages[1].attachment, '사진 3장')
})

test('CSV 내보내기: 따옴표 안 쉼표 · 줄바꿈', () => {
  const raw = 'Date,User,Message\n2026-11-10 15:24:00,"김민지","안녕하세요, 견적 확인 부탁드립니다"\n2026-11-10 15:25:10,"박서연","네\n확인했습니다"\n'
  const r = parseKakao(raw)
  assert.equal(r.title, '카카오톡 대화 (CSV)')
  assert.equal(r.messages.length, 2)
  assert.equal(r.messages[0].content, '안녕하세요, 견적 확인 부탁드립니다')
  assert.equal(r.messages[0].sent_at, '2026-11-10T06:24:00.000Z')
  assert.equal(r.messages[1].content, '네\n확인했습니다')
})

test('대화가 없는 파일은 빈 목록 (화면이 "대화를 찾지 못했습니다" 안내)', () => {
  assert.equal(parseKakao('그냥 메모 파일입니다\n두 번째 줄').messages.length, 0)
})
