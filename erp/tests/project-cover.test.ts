import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverRank, pickCover, type CoverFile } from '../supabase/functions/project-covers/cover.ts'

const f = (id: string, path: string, name: string, extra: Partial<CoverFile> = {}): CoverFile => ({ id, name, path, mime_type: 'image/jpeg', size: 500_000, modified_at: '2026-11-10T00:00:00Z', ...extra })

test('render and completion photos outrank site photos and concepts', () => {
  assert.equal(coverRank('02.성과물/02.투시도', 'view01.jpg'), 1)
  assert.equal(coverRank('04.준공/촬영', 'A.jpg'), 0)
  assert.equal(coverRank('03.현장일보/01.현장사진/261112_실측사진/원본', 'IMG.jpg'), 2)
  assert.equal(coverRank('03.현장일보/00.상권조사/20261030', 'IMG.jpg'), 4)
  assert.equal(coverRank('01.협의자료/01.수신/컨셉', 'p1.png'), 3)
})

test('documents, screenshots and small files are never picked', () => {
  const pick = pickCover([
    f('a', '01.협의자료/04.계약서/견적서 참고', '통장사본.jpg'),
    f('b', '01.협의자료/02.슬랙/261113', 'image.png', { mime_type: 'image/png' }),
    f('c', '02.성과물/01.도면/02.도면 작성법', 'x.dwg', { mime_type: 'image/vnd.dwg' }),
    f('d', '03.현장일보/01.현장사진', 'tiny.jpg', { size: 10_000 }),
    f('e', '01.협의자료/01.수신/스타일가이드', 'a.gif', { mime_type: 'image/gif' }),
  ])
  assert.equal(pick, null)
})

test('best tier wins, newest first inside a tier', () => {
  const pick = pickCover([
    f('site', '03.현장일보/01.현장사진', 'IMG_1.jpg', { modified_at: '2026-11-15T00:00:00Z' }),
    f('old-render', '02.성과물/02.투시도', 'v1.jpg', { modified_at: '2026-11-01T00:00:00Z' }),
    f('new-render', '02.성과물/02.투시도', 'v2.jpg', { modified_at: '2026-11-12T00:00:00Z' }),
  ])
  assert.equal(pick?.id, 'new-render')
})
