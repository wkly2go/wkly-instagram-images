import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverFile, rankCoverPhotos, topicWords } from '../src/lib/coverPicks.ts'

const proj = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, code: null, client_id: null, category: '팝업', status: '완료', owner_id: null, start_date: null, end_date: '2026-10-01', location: null, description: null, division: 'TW', created_by: null, created_at: '2026-01-01', updated_at: '2026-10-01', ...extra }) as any

test('낱말: 조사 · 흔한 낱말 · 숫자 · [표시] 뺌', () => {
  assert.deepEqual(topicWords('[시험] 성수 팝업 공간 12월 대관 오픈 — 연말 팝업을 준비하는 브랜드 담당자에게'), ['성수', '12월', '연말', '준비하'])
  assert.deepEqual(topicWords('더현대에서 우쑤한국사와 함께'), ['더현대', '우쑤한국사', '함께'])
})

test('알릴 내용과 맞는 사진이 먼저 · 회사가 같으면 앞 · 문의 · NIC · 회사 운영 · 사진 없음은 뺌', () => {
  const projects = [
    proj('a', '한남 브랜드 팝업', { end_date: '2026-11-20' }),
    proj('b', '성수 연말 팝업스토어', { end_date: '2026-03-01' }),
    proj('c', '마곡 오피스 인테리어', { division: 'AR', end_date: '2026-11-25' }),
    proj('d', '성수 문의 건', { status: '문의' }),
    proj('e', '성수 회사 운영', { division: 'RS' }),
    proj('f', '성수 사진 없음'),
  ]
  const covers = { a: 'u-a', b: 'u-b', c: 'u-c', d: 'u-d', e: 'u-e' }
  const r = rankCoverPhotos('성수 팝업 공간 12월 대관 — 연말 팝업', 'wkly', projects, covers)
  assert.deepEqual(r.map(x => x.projectId), ['b', 'a', 'c'])
  assert.match(r[0].reasons.join(), /성수 · 연말/)
  assert.deepEqual(rankCoverPhotos('인테리어', 'arterior', projects, covers).map(x => x.projectId)[0], 'c')
  // 맞는 낱말이 없으면 최근 순
  assert.deepEqual(rankCoverPhotos('', 'wkly', projects.slice(0, 2), covers).map(x => x.projectId), ['a', 'b'])
  assert.equal(rankCoverPhotos('성수', 'wkly', projects, covers, 1).length, 1)
})

test('사진 파일: 이름 · 형식 · 실패', async () => {
  const ok = (async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))) as unknown as typeof fetch
  const f = await coverFile({ projectId: 'a', name: '성수/팝업', place: '', url: 'x', score: 0, reasons: [] }, ok)
  assert.equal(f.name, '성수_팝업.png'); assert.equal(f.type, 'image/png'); assert.equal(f.size, 3)
  const bad = (async () => new Response('x', { status: 403 })) as unknown as typeof fetch
  await assert.rejects(coverFile({ projectId: 'a', name: 'a', place: '', url: 'x', score: 0, reasons: [] }, bad), /받지 못했습니다/)
})
