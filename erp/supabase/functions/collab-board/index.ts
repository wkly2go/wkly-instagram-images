// 외부 협업방 › 화이트보드 서버 함수 (2026-11-27 대표 지시 '외부 협업가능하게 만들어' · 로드맵 3-4)
//  - 외부인만 부름: 기기 열쇠(헤더 x-collab-key · 함수 collab 이 초대 링크를 바꿔 준 것) → 외부인 → 그 방 → 그 방에 공유한 보드(collab_room_boards)만
//  - boards(목록) · board_get(그림 + 사진 받을 15분 서명 주소) · board_ver(버전) · board_save(버전이 맞을 때만) · board_upload(사진 올릴 주소)
//  - 외부인이 보낸 그림은 board.ts 규칙으로 걸러 저장 · 저장하면 같은 보드를 연 팀원 화면에 방송(board:<id>)
//  - 팀원 쪽 공유 설정은 표 collab_room_boards 를 DB 권한(RLS)으로 바로. 외부로 아무것도 보내지 않음
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { cleanGuestScene, guestFilePathOk, scenePaths, GUEST_FILE_EXT } from './board.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-collab-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

class Fail extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message)
  }
}
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('')

interface Guest { id: string; room_id: string; name: string; can_upload: boolean; expires_at: string; revoked_at: string | null }
/** 기기 열쇠 → 외부인 · 방 · 프로젝트 (함수 collab 의 guestOf 와 같은 검사) */
async function guestOf(key: string) {
  if (!TOKEN_RE.test(key)) throw new Fail(401, '접속 정보가 없습니다. 받은 초대 링크로 다시 들어와 주세요.', 'bad')
  const { data: link } = await sb.from('collab_links').select('id,guest_id,revoked_at').eq('session_hash', await sha(key)).maybeSingle()
  if (!link) throw new Fail(401, '이 기기의 접속 정보가 없습니다. 담당자에게 새 링크를 요청해 주세요.', 'bad')
  if (link.revoked_at) throw new Fail(403, '이 기기는 접속이 해제됐습니다. 담당자에게 문의해 주세요.', 'revoked')
  const { data: g } = await sb.from('collab_guests').select('id,room_id,name,can_upload,expires_at,revoked_at').eq('id', link.guest_id).maybeSingle()
  const guest = g as Guest | null
  if (!guest || guest.revoked_at) throw new Fail(403, '접속이 해제됐습니다. 담당자에게 문의해 주세요.', 'revoked')
  if (Date.parse(guest.expires_at) < Date.now()) throw new Fail(403, '초대 기간이 끝났습니다. 담당자에게 문의해 주세요.', 'expired')
  const { data: room } = await sb.from('collab_rooms').select('id,project_id,closed_at').eq('id', guest.room_id).maybeSingle()
  if (!room) throw new Fail(404, '방을 찾을 수 없습니다.', 'bad')
  if (room.closed_at) throw new Fail(403, '이 협업방은 닫혔습니다.', 'closed')
  return { guest, roomId: room.id as string, projectId: room.project_id as string }
}

interface Shared { id: string; title: string; version: number; updated_at: string; can_edit: boolean }
/** 이 방에 공유된 보드 (그 프로젝트의 보드 · 템플릿 아님) */
async function sharedBoards(roomId: string, projectId: string): Promise<Shared[]> {
  const { data: links } = await sb.from('collab_room_boards').select('board_id,can_edit').eq('room_id', roomId)
  if (!links?.length) return []
  const { data: bs } = await sb.from('project_boards').select('id,title,version,updated_at').in('id', links.map(l => l.board_id as string)).eq('project_id', projectId).eq('is_template', false).order('updated_at', { ascending: false })
  return (bs ?? []).map(b => ({ id: b.id as string, title: b.title as string, version: b.version as number, updated_at: b.updated_at as string, can_edit: !!links.find(l => l.board_id === b.id)?.can_edit }))
}
/** 같은 보드를 연 팀원 화면에 '저장함' 알리기 (실패해도 저장은 그대로) */
async function boardSaved(boardId: string, who: Guest, version: number) {
  await fetch(`${URL_}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ messages: [{ topic: `board:${boardId}`, event: 'saved', private: true, payload: { id: `guest:${who.id}`, name: who.name, version } }] }),
  }).catch(() => undefined)
}
type Cur = { scene: unknown; version: number; guest_editor: string | null; updated_by: string | null }
async function conflict(c: Cur) {
  const name = c.guest_editor ?? (c.updated_by ? ((await sb.from('profiles').select('name').eq('id', c.updated_by).maybeSingle()).data?.name as string | undefined) : undefined) ?? '담당자'
  return { ok: false, version: c.version, scene: c.scene, updated_by_name: name }
}

async function run(action: string, b: Record<string, unknown>, key: string) {
  const { guest, roomId, projectId } = await guestOf(key)
  const boards = await sharedBoards(roomId, projectId)
  if (action === 'boards') return { boards }
  const id = String(b.board_id ?? '')
  const board = UUID_RE.test(id) ? boards.find(x => x.id === id) : undefined
  if (!board) throw new Fail(404, '이 방에 공유되지 않은 보드입니다.', 'unshared')
  if (action === 'board_ver') return { version: board.version }
  if (action === 'board_get') {
    const { data: row } = await sb.from('project_boards').select('scene').eq('id', board.id).single()
    const paths = [...scenePaths(row?.scene)].slice(0, 600)
    const urls: Record<string, string> = {}
    for (let i = 0; i < paths.length; i += 100) {
      const { data: signed } = await sb.storage.from('project-boards').createSignedUrls(paths.slice(i, i + 100), 900)
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl
    }
    return { board, scene: row?.scene ?? {}, urls }
  }
  if (!board.can_edit) throw new Fail(403, '이 보드는 보기만 할 수 있습니다.', 'readonly')
  if (action === 'board_upload') {
    if (!guest.can_upload) throw new Fail(403, '이 방에서는 사진을 올릴 수 없습니다. 담당자에게 문의해 주세요.')
    const path = String(b.path ?? ''), mime = String(b.mime ?? '')
    if (!guestFilePathOk(board.id, path) || !GUEST_FILE_EXT[mime] || !path.endsWith(`.${GUEST_FILE_EXT[mime]}`)) throw new Fail(400, '사진(PNG · JPG · WebP · GIF)만 올릴 수 있습니다.')
    const { data: have } = await sb.storage.from('project-boards').list(board.id, { limit: 1000 })
    if ((have ?? []).some(f => f.name === path.slice(board.id.length + 1))) return { exists: true }
    if ((have ?? []).length >= 600) throw new Fail(400, '이 보드에는 사진을 더 올릴 수 없습니다. 담당자에게 문의해 주세요.')
    const { data: up, error } = await sb.storage.from('project-boards').createSignedUploadUrl(path)
    if (error || !up) throw new Fail(500, '사진 올릴 주소를 만들지 못했습니다.')
    return { url: up.signedUrl }
  }
  if (action === 'board_save') {
    const version = Math.floor(Number(b.version) || 0)
    const { data: cur } = await sb.from('project_boards').select('scene,version,guest_editor,updated_by').eq('id', board.id).single()
    if (!cur) throw new Fail(404, '보드를 찾을 수 없습니다.')
    if (cur.version !== version) return await conflict(cur as Cur)
    let scene
    try { scene = cleanGuestScene(b.scene, board.id, scenePaths(cur.scene)) } catch (e) { throw new Fail(400, e instanceof Error ? e.message : '저장하지 못했습니다.') }
    const { data: won } = await sb.from('project_boards').update({ scene, version: version + 1, updated_by: null, guest_editor: guest.name.slice(0, 80), updated_at: new Date().toISOString() }).eq('id', board.id).eq('version', version).select('version')
    if (!won?.length) {
      const { data: now } = await sb.from('project_boards').select('scene,version,guest_editor,updated_by').eq('id', board.id).single()
      return await conflict(now as Cur)
    }
    await boardSaved(board.id, guest, version + 1)
    return { ok: true, version: version + 1 }
  }
  throw new Fail(400, '알 수 없는 작업입니다.')
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    return json(await run(String(b.action ?? ''), b, req.headers.get('x-collab-key') ?? ''))
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message, code: e.code }, e.status)
    console.error(e)
    return json({ error: '잠시 뒤에 다시 시도해 주세요.' }, 500)
  }
})
