#!/usr/bin/env node
// 더위클리 영상 편집 작업 처리기 (맥에서 늘 돌림 · 2026-11-27)
//  인트라넷의 '영상 편집 요청'을 1분마다 확인 → 드라이브에 동기화된 촬영 원본을 읽어
//  장면 사진을 만들고 → 맥의 Claude 가 쓸 장면 · 순서 · 자막을 정하고 → ffmpeg 로 9:16 영상을 만든다.
//  · 원본은 읽기만 한다. 완성본은 같은 폴더의 '편집본' 폴더에 새 파일로 둔다 (기존 파일을 고치거나 지우지 않음)
//  · 음악은 넣지 않는다 (게시할 때 앱에서 붙임)
//  · 설정: ~/.wkly-video-worker/config.json · 열쇠: ~/.wkly-video-worker/token (저장소에 넣지 않음)
//  실행: node worker.mjs            (계속 돌기)
//        node worker.mjs --once     (한 번만 확인)
//        node worker.mjs --scan     (폴더 목록만 올리기)
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const run = promisify(execFile)
const HOME = os.homedir()
const DIR = path.join(HOME, '.wkly-video-worker')
const cfg = JSON.parse(await fs.readFile(path.join(DIR, 'config.json'), 'utf8'))
const TOKEN = (await fs.readFile(path.join(DIR, 'token'), 'utf8')).trim()
const WORKER = cfg.worker || os.hostname()
const FFMPEG = cfg.ffmpeg || 'ffmpeg'
const FFPROBE = cfg.ffprobe || 'ffprobe'
const CLAUDE = cfg.claude || 'claude'
const FONT = cfg.font || '/System/Library/Fonts/AppleSDGothicNeo.ttc'
const VIDEO_RE = /\.(mp4|mov|m4v)$/i
const OUT_DIR = '편집본'
const W = 1080, H = 1920

const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a)

async function rpc(name, args) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: cfg.anon, Authorization: `Bearer ${cfg.anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: TOKEN, ...args }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${name} ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

// ── 폴더 목록 (영상이 든 폴더만 · 파일을 열지 않고 이름 · 크기만 봄) ──
async function scanFolders() {
  const found = []
  async function walk(abs, rel, depth) {
    if (depth > 8 || found.length >= 1500) return
    let entries
    try { entries = await fs.readdir(abs, { withFileTypes: true }) } catch { return }
    let files = 0, bytes = 0, newest = 0
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(abs, e.name)
      if (e.isDirectory()) { if (e.name !== OUT_DIR) await walk(p, rel ? `${rel}/${e.name}` : e.name, depth + 1) }
      else if (VIDEO_RE.test(e.name)) {
        try { const s = await fs.stat(p); files++; bytes += s.size; newest = Math.max(newest, s.mtimeMs) } catch { /* 건너뜀 */ }
      }
    }
    if (files > 0 && rel) found.push({ path: rel.normalize('NFC'), files, bytes, newest_at: new Date(newest).toISOString() })
  }
  for (const root of cfg.scan_roots) await walk(path.join(cfg.drive_root, root), root, 0)
  const n = await rpc('agent_video_folders_save', { p_worker: WORKER, p_folders: found })
  log(`폴더 ${found.length}곳 확인 · 저장 ${n}`)
}

// ── 편집 ──
async function probe(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file])
  const j = JSON.parse(stdout)
  return { duration: Number(j.format?.duration) || 0, width: j.streams?.[0]?.width || 0, height: j.streams?.[0]?.height || 0 }
}

async function listVideos(folderAbs) {
  const out = []
  async function walk(abs, depth) {
    const entries = await fs.readdir(abs, { withFileTypes: true })
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
      if (e.name.startsWith('.') || e.name === OUT_DIR) continue
      const p = path.join(abs, e.name)
      if (e.isDirectory()) { if (depth < 2) await walk(p, depth + 1) }
      else if (VIDEO_RE.test(e.name)) out.push(p)
    }
  }
  await walk(folderAbs, 0)
  return out
}

/** 클립마다 장면 사진 8칸(4×2)을 한 장으로 */
async function contactSheet(clip, index, tmp) {
  const cells = 8
  const step = Math.max(clip.duration / cells, 0.5)
  const times = Array.from({ length: cells }, (_, i) => Math.min(clip.duration - 0.1, step * i + step / 2)).map(t => Math.max(0, Number(t.toFixed(1))))
  const file = path.join(tmp, `clip${String(index + 1).padStart(2, '0')}.jpg`)
  await run(FFMPEG, ['-v', 'error', '-y', '-i', clip.file, '-vf', `fps=1/${step.toFixed(3)},scale=270:-2,tile=4x2`, '-frames:v', '1', '-q:v', '5', file], { timeout: 180000 })
  return { file, times }
}

function fallbackPlan(clips, target) {
  const per = Math.max(1.5, Math.min(4, target / Math.max(clips.length, 1)))
  const n = Math.max(1, Math.min(clips.length, Math.round(target / per)))
  const pick = Array.from({ length: n }, (_, i) => Math.floor(i * clips.length / n))
  return {
    by: 'rule',
    title_caption: '',
    segments: pick.map(i => ({ clip: i + 1, start: Math.max(0, clips[i].duration / 2 - per / 2), duration: Math.min(per, clips[i].duration), caption: '' })),
  }
}

function cleanPlan(raw, clips, target) {
  const segs = []
  for (const s of Array.isArray(raw?.segments) ? raw.segments : []) {
    const clip = clips[Number(s.clip) - 1]
    if (!clip) continue
    let duration = Math.max(0.8, Math.min(8, Number(s.duration) || 2.5))
    let start = Math.max(0, Number(s.start) || 0)
    if (start + duration > clip.duration) start = Math.max(0, clip.duration - duration)
    duration = Math.min(duration, clip.duration)
    segs.push({ clip: Number(s.clip), start: Number(start.toFixed(2)), duration: Number(duration.toFixed(2)), caption: String(s.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 28) })
    if (segs.length >= 24) break
  }
  if (!segs.length) return null
  // 목표 길이를 30% 넘게 넘으면 뒤에서 자름
  let total = 0
  const kept = segs.filter(s => (total += s.duration) <= target * 1.3 || total === s.duration)
  return { by: 'claude', title_caption: String(raw.title_caption ?? '').trim().slice(0, 28), note: String(raw.note ?? '').slice(0, 300), segments: kept }
}

const TEMPLATES = {
  cuts: '빠른 컷 몽타주: 한 장면 1.5~3초, 처음 2초에 가장 눈에 띄는 장면.',
  walkthrough: '공간 걸어 보기: 입구 → 안쪽 순서, 한 장면 3~5초, 흐름이 이어지게.',
  detail: '디테일 클로즈업: 소품 · 마감 · 굿즈 가까이 찍은 장면 위주, 한 장면 2~3초.',
}

async function askClaude(job, clips, sheets, tmp) {
  const list = clips.map((c, i) => `클립 ${i + 1}: ${path.basename(c.file)} · ${c.duration.toFixed(1)}초 · 장면 사진 ${path.basename(sheets[i].file)} (왼쪽 위부터 오른쪽으로, 윗줄 다음 아랫줄 · 각 칸 시각(초): ${sheets[i].times.join(', ')})`).join('\n')
  const prompt = `너는 더위클리(팝업스토어 매거진) 릴스 편집자다. 이 폴더의 장면 사진 파일(clipNN.jpg)을 Read 도구로 모두 보고 편집 지시서를 만든다.

제목: ${job.title}
틀: ${TEMPLATES[job.template] ?? TEMPLATES.cuts}
목표 길이: 약 ${job.target_seconds}초 (세로 9:16 · 음악 없음)
대표 지시: ${job.instructions || '없음'}
${job.parent ? `이전 편집 지시서(고쳐 달라는 요청임): ${JSON.stringify(job.parent.plan?.segments ?? []).slice(0, 1500)}` : ''}

${list}

규칙:
- 흔들리거나 어둡거나 바닥 · 손만 찍힌 장면은 쓰지 않는다. 비슷한 장면은 하나만.
- 자막은 한국어 14자 이내, 화면에 보이는 사실만. 과장 · 이모지 · 느낌표 연속 금지. 자막이 필요 없으면 빈 글.
- 사진에서 확인 못 한 브랜드 이름 · 숫자는 쓰지 않는다.
- start 는 그 클립 안의 시작 초, duration 은 0.8~6초.

다른 말 없이 JSON 하나만 출력:
{"title_caption":"첫 장면 제목 (16자 이내)","segments":[{"clip":1,"start":0.0,"duration":2.5,"caption":""}],"note":"고른 이유 한 줄"}`
  const { stdout } = await run(CLAUDE, ['-p', prompt, '--allowedTools', 'Read', '--output-format', 'text'], { cwd: tmp, timeout: 600000, maxBuffer: 8 * 1024 * 1024 })
  const a = stdout.indexOf('{'), b = stdout.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('지시서 형식이 아님')
  return JSON.parse(stdout.slice(a, b + 1))
}

function drawtext(textFile, size, yExpr) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
  return `drawtext=fontfile='${esc(FONT)}':textfile='${esc(textFile)}':fontsize=${size}:fontcolor=white:box=1:boxcolor=0x155338@0.86:boxborderw=22:x=(w-text_w)/2:y=${yExpr}`
}

async function render(job, clips, plan, tmp) {
  const parts = []
  for (const [i, s] of plan.segments.entries()) {
    const clip = clips[s.clip - 1]
    const out = path.join(tmp, `seg${String(i).padStart(2, '0')}.mp4`)
    const filters = [`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, 'fps=30', 'format=yuv420p']
    const caption = i === 0 && plan.title_caption ? plan.title_caption : s.caption
    if (caption && cfg.captions !== false) {
      const tf = path.join(tmp, `cap${i}.txt`)
      await fs.writeFile(tf, caption)
      // 글은 화면 가운데보다 조금 아래
      filters.push(drawtext(tf, i === 0 && plan.title_caption ? 78 : 62, 'h*0.60'))
    }
    await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(s.start), '-t', String(s.duration), '-i', clip.file, '-an', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', out], { timeout: 600000 })
    parts.push(out)
  }
  const listFile = path.join(tmp, 'list.txt')
  await fs.writeFile(listFile, parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
  const final = path.join(tmp, 'final.mp4')
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', final], { timeout: 600000 })
  const preview = path.join(tmp, 'preview.mp4')
  await run(FFMPEG, ['-v', 'error', '-y', '-i', final, '-an', '-vf', 'scale=540:960', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '29', '-movflags', '+faststart', preview], { timeout: 600000 })
  return { final, preview }
}

async function uploadPreview(jobId, file) {
  const res = await fetch(`${cfg.url}/functions/v1/video-worker`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anon }, body: JSON.stringify({ token: TOKEN, job_id: jobId }) })
  const j = await res.json()
  if (!res.ok) throw new Error(j.error || `미리보기 주소 ${res.status}`)
  const size = (await fs.stat(file)).size
  const put = await fetch(j.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'x-upsert': 'true' }, body: createReadStream(file), duplex: 'half' })
  if (!put.ok) throw new Error(`미리보기 올리기 ${put.status}: ${(await put.text()).slice(0, 200)}`)
  return j.path
}

async function processJob(job) {
  log(`편집 시작: ${job.title} (${job.source_folder})`)
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wkly-video-'))
  try {
    const rel = job.source_folder.normalize('NFC')
    if (rel.includes('..') || !cfg.scan_roots.some(r => rel === r || rel.startsWith(r + '/'))) throw new Error('허용된 촬영 폴더가 아닙니다.')
    let folderAbs = path.join(cfg.drive_root, rel)
    if (!existsSync(folderAbs)) folderAbs = path.join(cfg.drive_root, rel.normalize('NFD'))
    if (!existsSync(folderAbs)) throw new Error('드라이브에서 폴더를 찾지 못했습니다 (동기화 확인).')
    const files = await listVideos(folderAbs)
    if (!files.length) throw new Error('폴더에 영상 파일이 없습니다.')
    // 클립이 많으면 고르게 16개만 본다
    const picked = files.length <= 16 ? files : Array.from({ length: 16 }, (_, i) => files[Math.floor(i * files.length / 16)])
    const clips = []
    for (const file of picked) {
      try { const p = await probe(file); if (p.duration >= 1) clips.push({ file, ...p }) } catch (e) { log('읽지 못한 파일', path.basename(file), String(e.message).slice(0, 80)) }
    }
    if (!clips.length) throw new Error('읽을 수 있는 영상이 없습니다.')
    const sheets = []
    for (const [i, c] of clips.entries()) sheets.push(await contactSheet(c, i, tmp))

    let plan = null
    try { plan = cleanPlan(await askClaude(job, clips, sheets, tmp), clips, job.target_seconds) } catch (e) { log('Claude 지시서 실패 → 규칙으로 대신:', String(e.message).slice(0, 160)) }
    if (!plan) plan = fallbackPlan(clips, job.target_seconds)
    plan.clips = clips.map(c => path.basename(c.file))

    const { final, preview } = await render(job, clips, plan, tmp)
    const outDir = path.join(folderAbs, OUT_DIR)
    await fs.mkdir(outDir, { recursive: true })
    const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(2, 16).replace(/[-:]/g, '').replace('T', '-')
    const safe = job.title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60)
    const outFile = path.join(outDir, `${safe}_${stamp}.mp4`)
    await fs.copyFile(final, outFile, fs.constants.COPYFILE_EXCL)
    const previewPath = await uploadPreview(job.id, preview)
    const duration = plan.segments.reduce((a, s) => a + s.duration, 0)
    await rpc('agent_video_job_finish', { p_id: job.id, p: { ok: true, plan, result_path: `${rel}/${OUT_DIR}/${path.basename(outFile)}`, preview_path: previewPath, duration_seconds: Number(duration.toFixed(1)) } })
    log(`완료: ${path.basename(outFile)} · ${duration.toFixed(1)}초 · 장면 ${plan.segments.length} · ${plan.by}`)
  } catch (e) {
    log('실패:', e.message)
    await rpc('agent_video_job_finish', { p_id: job.id, p: { ok: false, error: String(e.message).slice(0, 900) } }).catch(err => log('실패 기록도 못 함', err.message))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

async function tick() {
  for (let i = 0; i < 3; i++) {
    const job = await rpc('agent_video_job_claim', { p_worker: WORKER })
    if (!job) return
    await processJob(job)
  }
}

const arg = process.argv[2]
if (arg === '--scan') { await scanFolders(); process.exit(0) }
if (arg === '--once') { await tick(); process.exit(0) }
log(`작업 처리기 시작 (${WORKER})`)
let lastScan = 0
for (;;) {
  try {
    if (Date.now() - lastScan > 30 * 60e3) { await scanFolders(); lastScan = Date.now() }
    await tick()
  } catch (e) { log('오류:', e.message) }
  await new Promise(r => setTimeout(r, 60e3))
}
