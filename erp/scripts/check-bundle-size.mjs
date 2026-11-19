// 첫 화면 묶음 크기 점검 (2026-11-19 성능) — `npm run build` 뒤에 `node scripts/check-bundle-size.mjs`
// 첫 화면에 꼭 받아야 하는 파일(시작 스크립트 + 미리 받는 라이브러리 + 스타일)의 압축 크기를 재고, 한도를 넘으면 실패한다.
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const dist = new URL('../dist/', import.meta.url)
const html = readFileSync(new URL('index.html', dist), 'utf8')
const files = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map(m => m[1])
const gz = f => gzipSync(readFileSync(new URL(f, dist))).length
const rows = files.map(f => ({ file: f, kb: Math.round(gz(f) / 102.4) / 10 }))
const total = Math.round(rows.reduce((a, r) => a + r.kb, 0) * 10) / 10
const app = rows.filter(r => /assets\/index-.*\.js$/.test(r.file)).reduce((a, r) => a + r.kb, 0)
const css = rows.filter(r => r.file.endsWith('.css')).reduce((a, r) => a + r.kb, 0)
const LIMIT_TOTAL = Number(process.env.FIRST_LOAD_KB ?? 340), LIMIT_APP = Number(process.env.APP_CHUNK_KB ?? 170)
console.log(JSON.stringify({ first_load_gzip_kb: total, app_chunk_gzip_kb: app, css_gzip_kb: css, update_gzip_kb: Math.round((app + css) * 10) / 10, files: rows, chunks: readdirSync(new URL('assets/', dist)).length }, null, 1))
if (total > LIMIT_TOTAL || app > LIMIT_APP) { console.error(`첫 화면 묶음이 한도를 넘었습니다 (전체 ${total}KB / ${LIMIT_TOTAL}KB · 앱 ${app}KB / ${LIMIT_APP}KB)`); process.exit(1) }
