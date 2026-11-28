import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitScale, mediaInText, parseMedia } from '../src/lib/mediaEmbed.ts'

test('youtube links of every shape', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'youtu.be/dQw4w9WgXcQ', 'https://m.youtube.com/shorts/dQw4w9WgXcQ']) {
    const m = parseMedia(u)!
    assert.equal(m.platform, 'youtube'); assert.equal(m.id, 'dQw4w9WgXcQ')
    assert.match(m.embed, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/)
  }
  assert.equal(parseMedia('https://www.youtube.com/@channel'), null)
})

test('instagram posts and reels', () => {
  assert.equal(parseMedia('https://www.instagram.com/p/CxYz12345ab/?igsh=1')!.embed, 'https://www.instagram.com/p/CxYz12345ab/embed/')
  assert.equal(parseMedia('https://www.instagram.com/reel/CxYz12345ab/')!.embed, 'https://www.instagram.com/reel/CxYz12345ab/embed/')
  assert.equal(parseMedia('https://www.instagram.com/theweekly_magazine/'), null)
})

test('tiktok videos', () => {
  const m = parseMedia('https://www.tiktok.com/@brand/video/7301234567890123456?lang=ko')!
  assert.equal(m.platform, 'tiktok'); assert.match(m.embed, /player\/v1\/7301234567890123456/)
  assert.equal(parseMedia('https://example.com/video/123'), null)
})

test('links in a report, deduplicated', () => {
  const got = mediaInText('| 1 | [영상](https://youtu.be/dQw4w9WgXcQ) | https://www.youtube.com/watch?v=dQw4w9WgXcQ | https://www.tiktok.com/@a/video/7301234567890123456')
  assert.deepEqual(got.map(m => m.platform), ['youtube', 'tiktok'])
})

test('device fits the space without growing', () => {
  assert.equal(fitScale('iphone', 2000, 2000), 1)
  assert.ok(Math.abs(fitScale('mac', 294, 600) - 0.2) < 0.001)
})
