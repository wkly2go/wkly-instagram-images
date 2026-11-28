// 외부 협업방 › 화이트보드 — 외부인 쪽 (2026-11-27 대표 지시 '외부 협업가능하게 만들어')
// 편집기(BoardEditorCore)가 쓰는 API 모양을 협업방 화이트보드 서버 함수(collab-board)로 맞춰 줌. 외부인은 DB · 보관함에 직접 닿지 않음.
//  - 읽기: board_get (그림 + 사진 받을 서명 주소 15분) · 저장: board_save (버전이 맞을 때만 · 어긋나면 서버 그림을 받아 편집기가 합침)
//  - 사진 올리기: board_upload 가 준 주소로 이 브라우저가 바로 · 실시간 방송은 못 받으므로 버전을 6초마다 물어봄(화면이 보일 때만)
import { readScene } from './board.ts'
import { NO_CURSOR_ROOM, openCursorRoom, type CursorRoom } from './boardCursors.ts'
import type { BoardApi } from './boardApi'
import { GuestError, guestApi } from './collabGuest'

export type GuestBoardSource = Pick<BoardApi, 'getBoard' | 'saveBoard' | 'uploadBoardFile' | 'downloadBoardFile' | 'watchBoard' | 'watchCursors' | 'renameBoard'>
const POLL = 6_000
const BASE = import.meta.env?.VITE_SUPABASE_URL as string | undefined
const ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined

// 외부인용 방송 연결: 로그인 없음 · 세션을 저장하지 않음 · 커서 방송에만 씀(표 · 보관함은 권한이 없어 못 읽음)
let liveClient: Promise<import('@supabase/supabase-js').SupabaseClient | null> | null = null
const guestLiveClient = () => (liveClient ??= !BASE || !ANON ? Promise.resolve(null) : import('@supabase/supabase-js')
  .then(m => m.createClient(BASE, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'wkly-guest-live' } }))
  .catch(() => null))

export function guestBoardSource(key: string, onLost?: (e: GuestError) => void): GuestBoardSource {
  let urls: Record<string, string> = {}
  let boardId = ''
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run() } catch (e) {
      if (e instanceof GuestError && ['bad', 'revoked', 'expired', 'closed'].includes(e.code)) onLost?.(e)
      throw e
    }
  }
  const fetchBlob = async (path: string) => {
    const u = urls[path]
    if (!u) return null
    const r = await fetch(u).catch(() => null)
    return r?.ok ? await r.blob() : null
  }
  return {
    async getBoard(id) {
      const got = await guard(() => guestApi.boardGet(key, id))
      urls = got.urls ?? {}
      boardId = id
      const b = got.board
      return { board: { id: b.id, project_id: null, title: b.title, version: b.version, created_by: null, updated_by: null, created_at: b.updated_at, updated_at: b.updated_at, live_key: got.live_key }, scene: readScene(got.scene) }
    },
    async saveBoard(id, scene, version) {
      const r = await guard(() => guestApi.boardSave(key, id, scene, version))
      return r.ok ? { ok: true, version: r.version } : { ok: false, version: r.version, scene: readScene(r.scene), updated_by_name: r.updated_by_name || '담당자' }
    },
    async uploadBoardFile(path, blob) {
      const id = path.split('/')[0]
      const r = await guard(() => guestApi.boardUpload(key, id, path, blob.type || 'image/png'))
      if (r.exists || !r.url) return
      const put = await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': blob.type || 'image/png', 'x-upsert': 'false' }, body: blob }).catch(() => null)
      if (!put || (!put.ok && put.status !== 409)) throw new Error('사진을 올리지 못했습니다. 잠시 뒤 다시 저장합니다.')
    },
    async downloadBoardFile(path) {
      let b = await fetchBlob(path)
      if (!b && boardId) {
        // 서명 주소가 지났거나 다른 사람이 방금 올린 사진 → 주소를 새로 받음
        urls = (await guard(() => guestApi.boardGet(key, boardId))).urls ?? {}
        b = await fetchBlob(path)
      }
      if (!b) throw new Error('사진을 받지 못했습니다.')
      return b
    },
    watchBoard(id, who, on) {
      queueMicrotask(() => on.peers([who]))
      let last = 0
      const tick = async () => {
        if (document.visibilityState !== 'visible') return
        try {
          const v = await guestApi.boardVersion(key, id)
          if (v !== last) { last = v; on.saved({ id: 'remote', name: '', version: v }) }
        } catch (e) { if (e instanceof GuestError && ['bad', 'revoked', 'expired', 'closed', 'unshared'].includes(e.code)) onLost?.(e) }
      }
      const t = window.setInterval(() => void tick(), POLL)
      return { saved: v => { last = v }, close: () => window.clearInterval(t) }
    },
    watchCursors(liveKey, who, on) {
      // 연결을 만드는 동안 온 움직임은 마지막 것만 기억했다가 보냄
      let room: CursorRoom | null = null, closed = false
      let pending: { x: number; y: number } | null = null
      void guestLiveClient().then(sb => {
        if (closed) return
        room = sb ? openCursorRoom(sb, liveKey, who, on) : NO_CURSOR_ROOM
        if (pending) room.move(pending.x, pending.y)
      })
      return {
        move(x, y) { if (room) room.move(x, y); else pending = { x, y } },
        saved(v) { room?.saved(v) },
        close() { closed = true; room?.close() },
      }
    },
    async renameBoard() { throw new Error('이름은 담당자만 바꿀 수 있습니다.') },
  }
}
