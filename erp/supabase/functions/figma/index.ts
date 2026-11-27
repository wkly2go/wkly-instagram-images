// 피그잼 · 피그마 연결 서버 함수 (2026-11-20 · DB 20261120180000_project_figma)
//  - 팀원(로그인 · 활성)만: status · link(프로젝트에 보드 연결) · refresh(다시 읽기) · export(프레임을 골라 PDF 한 부)
//    · images(프레임을 PNG 로 · 화이트보드에 불러오기 · 2026-11-27 대표 '화이트보드에 피그마 불러오기')
//  - 예약(x-sync-key = 금고 GDRIVE_SYNC_KEY): tick — 30분마다 바뀐 보드만 다시 읽음
//  - 피그마는 읽기만 (금고 FIGMA_TOKEN · 개인 접근 토큰 · 읽기 권한). 보드 내용은 바꾸지 않음
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { cleanNodeIds, expandSections, framesOf, parseFigmaUrl, textOf } from './parse.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class Fail extends Error { constructor(msg: string, public status = 400) { super(msg) } }

async function token(): Promise<string> {
  const { data } = await sb.rpc('figma_secret_get')
  if (typeof data !== 'string' || !data) throw new Fail('피그마 읽기 열쇠가 아직 없습니다. 관리자가 관리 › 외부 연결 · 피그마 열쇠에서 넣어 주세요.', 409)
  return data
}
async function figma<T>(tk: string, path: string): Promise<T> {
  const r = await fetch(`https://api.figma.com/v1/${path}`, { headers: { 'X-Figma-Token': tk } })
  if (r.status === 403) throw new Fail('피그마가 거절했습니다. 열쇠가 만료됐거나 이 파일을 볼 권한이 없습니다.', 403)
  if (r.status === 404) throw new Fail('피그마 파일을 찾을 수 없습니다. 주소를 확인해 주세요.', 404)
  if (r.status === 429) throw new Fail('피그마 요청이 많아 잠시 막혔습니다. 몇 분 뒤 다시 해 주세요.', 429)
  if (!r.ok) throw new Fail(`피그마 응답 오류 (${r.status})`, 502)
  return await r.json() as T
}

type Row = { id: string; project_id: string; file_key: string; kind: string; last_modified: string | null; thumb_path: string | null }

/** 파일을 읽어 제목 · 프레임 · 글 · 미리보기 그림을 저장 (바뀐 것이 없으면 확인 시각만) */
async function readFile(tk: string, row: Row, force: boolean) {
  const meta = await figma<{ file?: { name?: string; last_touched_at?: string; thumbnail_url?: string } }>(tk, `files/${row.file_key}/meta`).catch(() => null)
  const touched = meta?.file?.last_touched_at ?? null
  if (!force && touched && row.last_modified && Date.parse(touched) <= Date.parse(row.last_modified)) {
    await sb.from('project_figma').update({ checked_at: new Date().toISOString(), sync_error: null }).eq('id', row.id)
    return { changed: false }
  }
  // 큰 파일을 통째로 받으면 서버 메모리가 넘침(2026-11-27 포켓몬 보드 · Memory limit exceeded)
  // → 구조는 얕게(depth) 받아 먼저 저장하고, 글은 프레임 몇 개씩 얕게 나눠 받는다
  const depth = row.kind === 'slides' ? 4 : 2
  const file = await figma<{ name?: string; lastModified?: string; thumbnailUrl?: string; document?: unknown }>(tk, `files/${row.file_key}?geometry=omit&depth=${depth}`)
  let thumb = row.thumb_path
  const tu = file.thumbnailUrl ?? meta?.file?.thumbnail_url
  if (tu) {
    const r = await fetch(tu).catch(() => null)
    if (r?.ok) {
      const path = `${row.id}/thumb.png`
      const up = await sb.storage.from('figma-files').upload(path, new Uint8Array(await r.arrayBuffer()), { contentType: r.headers.get('content-type')?.split(';')[0] || 'image/png', upsert: true })
      if (!up.error) thumb = path
    }
  }
  const top = framesOf(file.document as Parameters<typeof framesOf>[0])
  const frames = expandSections(top, await sectionKids(tk, row.file_key, top.filter(f => f.type === 'SECTION').map(f => f.id)))
  const lastModified = file.lastModified ?? touched
  await sb.from('project_figma').update({
    title: (file.name ?? '').slice(0, 200), frames, thumb_path: thumb, checked_at: new Date().toISOString(), sync_error: null,
  }).eq('id', row.id)
  const content = await textByFrames(tk, row.file_key, top.map(f => f.id))
  // 글까지 다 읽은 뒤에 last_modified 를 적음 → 중간에 멈추면 다음 예약이 다시 읽음
  await sb.from('project_figma').update({ content: content || null, last_modified: lastModified }).eq('id', row.id)
  return { changed: true }
}

/** 섹션 노드를 한 층만 받음 (섹션 안 슬라이드 · 프레임 목록용 · 10개씩) */
async function sectionKids(tk: string, key: string, ids: string[]) {
  const out: Record<string, Parameters<typeof expandSections>[1][string]> = {}
  for (let i = 0; i < Math.min(ids.length, 60); i += 10) {
    const part = ids.slice(i, i + 10)
    const r = await figma<{ nodes?: Record<string, { document?: unknown } | null> }>(tk, `files/${key}/nodes?ids=${encodeURIComponent(part.join(','))}&geometry=omit&depth=1`).catch(() => null)
    for (const id of part) out[id] = r?.nodes?.[id]?.document as Parameters<typeof expandSections>[1][string]
  }
  return out
}

/** 프레임 글을 몇 개씩 얕게 받아 모음 (최대 50,000자 · 25초 안) */
async function textByFrames(tk: string, key: string, ids: string[]) {
  const parts: string[] = []
  let len = 0
  const until = Date.now() + 25_000
  for (let i = 0; i < ids.length && len < 50000 && Date.now() < until; i += 4) {
    const part = ids.slice(i, i + 4)
    const r = await figma<{ nodes?: Record<string, { document?: unknown } | null> }>(tk, `files/${key}/nodes?ids=${encodeURIComponent(part.join(','))}&geometry=omit&depth=4`).catch(() => null)
    for (const id of part) {
      const t = textOf(r?.nodes?.[id]?.document as Parameters<typeof textOf>[0], 50000 - len)
      if (t) { parts.push(t); len += t.length + 1 }
    }
  }
  return parts.join('\n').slice(0, 50000)
}

/** 프레임을 고른 순서대로 PDF 한 부 */
async function exportPdf(tk: string, row: Row, ids: string[], title: string, who: string) {
  if (!ids.length) throw new Fail('PDF 에 넣을 프레임을 골라 주세요.')
  const out = await PDFDocument.create()
  // 한 번에 10개씩 그림 주소 받기
  for (let i = 0; i < ids.length; i += 10) {
    const part = ids.slice(i, i + 10)
    const r = await figma<{ err?: string | null; images?: Record<string, string | null> }>(tk, `images/${row.file_key}?ids=${encodeURIComponent(part.join(','))}&format=pdf`)
    if (r.err) throw new Fail(`피그마가 PDF 를 만들지 못했습니다: ${r.err}`, 502)
    for (const id of part) {
      const u = r.images?.[id]
      if (!u) throw new Fail('일부 프레임을 PDF 로 만들지 못했습니다. 프레임이 지워졌는지 확인해 주세요.', 502)
      const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer())
      const src = await PDFDocument.load(bytes)
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p)
    }
  }
  out.setTitle(title)
  out.setProducer('WKLY 인트라넷')
  const pdf = await out.save()
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const path = `${row.id}/exports/${stamp}-${crypto.randomUUID().slice(0, 6)}.pdf`
  const up = await sb.storage.from('figma-files').upload(path, pdf, { contentType: 'application/pdf' })
  if (up.error) throw new Fail(`PDF 를 보관하지 못했습니다: ${up.error.message}`, 500)
  const ins = await sb.from('figma_exports').insert({ figma_id: row.id, project_id: row.project_id, title, node_ids: ids, pages: out.getPageCount(), path, created_by: who }).select('id').single()
  if (ins.error) throw new Fail(ins.error.message, 500)
  const signed = await sb.storage.from('figma-files').createSignedUrl(path, 600, { download: `${title}.pdf` })
  return { id: ins.data.id, path, pages: out.getPageCount(), url: signed.data?.signedUrl ?? null }
}

/** 프레임을 PNG 로 받아 화면에 넘김 (화이트보드에 붙이기용 · 한 번에 6개 · 긴 변 2,400px 안) */
async function frameImages(tk: string, row: Row, ids: string[]) {
  if (!ids.length) throw new Fail('불러올 프레임을 골라 주세요.')
  const pick = ids.slice(0, 6)
  const { data: rec } = await sb.from('project_figma').select('frames').eq('id', row.id).maybeSingle()
  const frames = ((rec?.frames ?? []) as { id: string; name: string; w: number; h: number }[])
  const out: { id: string; name: string; w: number; h: number; mime: string; data: string }[] = []
  for (const id of pick) {
    const f = frames.find(x => x.id === id)
    const long = Math.max(f?.w ?? 0, f?.h ?? 0)
    const scale = long > 0 ? Math.max(0.1, Math.min(2, 2400 / long)) : 1
    const r = await figma<{ err?: string | null; images?: Record<string, string | null> }>(tk, `images/${row.file_key}?ids=${encodeURIComponent(id)}&format=png&scale=${scale.toFixed(2)}`)
    const u = r.images?.[id]
    if (r.err || !u) throw new Fail('피그마가 그림을 만들지 못했습니다. 프레임이 지워졌는지 확인해 주세요.', 502)
    const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer())
    if (bytes.length > 8 * 1024 * 1024) throw new Fail(`'${f?.name ?? id}' 그림이 너무 큽니다 (8MB 넘음).`, 413)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    out.push({ id, name: f?.name ?? id, w: Math.round((f?.w ?? 0) * scale), h: Math.round((f?.h ?? 0) * scale), mime: 'image/png', data: btoa(bin) })
  }
  return out
}

async function member(authorization: string | null): Promise<{ id: string; admin: boolean }> {
  if (!authorization) throw new Fail('로그인이 필요합니다.', 401)
  const c: SupabaseClient = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user } } = await c.auth.getUser()
  if (!user) throw new Fail('로그인이 필요합니다.', 401)
  const p = await sb.from('profiles').select('active,role,is_agent').eq('id', user.id).single()
  if (!p.data?.active || p.data.is_agent) throw new Fail('활성 팀원만 쓸 수 있습니다.', 403)
  return { id: user.id, admin: p.data.role === 'admin' }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? '')
    // 예약: 바뀐 보드만 (한 번에 20개 · 50초 안)
    if (action === 'tick') {
      const { data: want } = await sb.rpc('gdrive_secret_get', { p_name: 'GDRIVE_SYNC_KEY' })
      if (!want || req.headers.get('x-sync-key') !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
      const tk = await token()
      const { data: rows } = await sb.from('project_figma').select('id,project_id,file_key,kind,last_modified,thumb_path').order('checked_at', { ascending: true, nullsFirst: true }).limit(20)
      const deadline = Date.now() + 50_000
      let changed = 0, failed = 0
      for (const r of (rows ?? []) as Row[]) {
        if (Date.now() > deadline) break
        try { if ((await readFile(tk, r, false)).changed) changed++ } catch (e) {
          failed++
          await sb.from('project_figma').update({ checked_at: new Date().toISOString(), sync_error: e instanceof Error ? e.message.slice(0, 300) : '읽기 실패' }).eq('id', r.id)
          if (e instanceof Fail && e.status === 429) break
        }
      }
      return json({ ok: true, changed, failed })
    }
    const me = await member(req.headers.get('authorization'))
    if (action === 'status') {
      const { data } = await sb.rpc('figma_secret_get')
      return json({ token: typeof data === 'string' && !!data })
    }
    if (action === 'link') {
      const parsed = parseFigmaUrl(String(body.url ?? ''))
      if (!parsed) throw new Fail('피그마 · 피그잼 주소가 아닙니다. 보드에서 ‘링크 복사’한 주소를 넣어 주세요.')
      const projectId = String(body.project_id ?? '')
      const tk = await token()
      const ins = await sb.from('project_figma').upsert({ project_id: projectId, file_key: parsed.key, kind: parsed.kind, url: String(body.url).trim().slice(0, 1000), created_by: me.id }, { onConflict: 'project_id,file_key' })
        .select('id,project_id,file_key,kind,last_modified,thumb_path').single()
      if (ins.error) throw new Fail(ins.error.message)
      try { await readFile(tk, ins.data as Row, true) } catch (e) {
        await sb.from('project_figma').delete().eq('id', ins.data.id)
        throw e
      }
      return json({ ok: true, id: ins.data.id })
    }
    const id = String(body.id ?? '')
    const { data: row } = await sb.from('project_figma').select('id,project_id,file_key,kind,last_modified,thumb_path').eq('id', id).maybeSingle()
    if (!row) throw new Fail('연결된 보드를 찾을 수 없습니다.', 404)
    if (action === 'refresh') return json({ ok: true, ...(await readFile(await token(), row as Row, true)) })
    if (action === 'export') {
      const title = String(body.title ?? '').replace(/[\\/:*?"<>|\n\r]/g, ' ').trim().slice(0, 80) || '제안서'
      return json({ ok: true, ...(await exportPdf(await token(), row as Row, cleanNodeIds(body.node_ids), title, me.id)) })
    }
    if (action === 'images') return json({ ok: true, images: await frameImages(await token(), row as Row, cleanNodeIds(body.node_ids)) })
    throw new Fail('알 수 없는 요청입니다.')
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500
    return json({ error: e instanceof Error ? e.message : '처리하지 못했습니다.' }, status)
  }
})
