// 협업 화이트보드 API (로드맵 3단계 · 2026-11-20 · DB 20261120170000_project_boards)
//  - 보드 목록 · 만들기 · 이름 · 지우기는 DB 권한(RLS · 활성 팀원 · 지우기는 만든 사람 · 관리자)으로 바로
//  - 저장은 board_save(버전이 맞을 때만) · 어긋나면 서버 그림을 받아 화면이 요소별로 합쳐 다시 저장
//  - 사진은 비공개 보관함 project-boards · 같은 보드를 연 사람끼리 '저장함' · 접속 표시 (방송 주제 board:<id>)
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import { boardTitle, readScene, type BoardScene } from './board'

export interface ProjectBoard {
  id: string
  project_id: string
  title: string
  version: number
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  /** 요소 수 (목록에서만 · 지운 것 제외) */
  count?: number
}
export type BoardSaveResult = { ok: true; version: number } | { ok: false; version: number; scene: BoardScene; updated_by_name: string }
export interface BoardPeer { id: string; name: string }
export interface BoardLive { saved(version: number): void; close(): void }

export interface BoardApi {
  listBoards(projectId: string): Promise<ProjectBoard[]>
  getBoard(id: string): Promise<{ board: ProjectBoard; scene: BoardScene } | null>
  createBoard(projectId: string, title: string): Promise<ProjectBoard>
  renameBoard(id: string, title: string): Promise<void>
  deleteBoard(id: string): Promise<void>
  saveBoard(id: string, scene: BoardScene, version: number): Promise<BoardSaveResult>
  /** 사진 올리기 → 보관함 경로 */
  uploadBoardFile(path: string, blob: Blob): Promise<void>
  /** 사진 받기 (서명 주소 → blob) */
  downloadBoardFile(path: string): Promise<Blob>
  watchBoard(id: string, who: BoardPeer, on: { peers(list: BoardPeer[]): void; saved(p: { id: string; name: string; version: number }): void }): BoardLive
}

const fail = (e: { message: string; code?: string } | null) => {
  if (!e) return
  if (['PGRST202', 'PGRST205', '42P01'].includes(e.code ?? '')) throw new ApiError('화이트보드 서버를 준비 중입니다. 잠시 뒤 다시 열어 주세요.')
  if (e.code === '42501') throw new ApiError('이 보드를 고칠 권한이 없습니다.')
  throw new ApiError(e.message)
}
const COLS = 'id,project_id,title,version,created_by,updated_by,created_at,updated_at'

export function createSupabaseBoardApi(sb: SupabaseClient): BoardApi {
  return {
    async listBoards(projectId) {
      const r = await sb.from('project_boards').select(`${COLS},scene->elements`).eq('project_id', projectId).order('updated_at', { ascending: false })
      fail(r.error)
      return ((r.data ?? []) as (ProjectBoard & { elements?: { isDeleted?: boolean }[] | null })[]).map(({ elements, ...b }) => ({
        ...b, count: Array.isArray(elements) ? elements.filter(e => !e?.isDeleted).length : 0,
      }))
    },
    async getBoard(id) {
      const r = await sb.from('project_boards').select(`${COLS},scene`).eq('id', id).maybeSingle()
      fail(r.error)
      if (!r.data) return null
      const { scene, ...board } = r.data as ProjectBoard & { scene: unknown }
      return { board, scene: readScene(scene) }
    },
    async createBoard(projectId, title) {
      const { data: u } = await sb.auth.getUser()
      const r = await sb.from('project_boards').insert({ project_id: projectId, title: boardTitle(title), created_by: u.user?.id, updated_by: u.user?.id }).select(COLS).single()
      fail(r.error)
      return r.data as ProjectBoard
    },
    async renameBoard(id, title) {
      fail((await sb.from('project_boards').update({ title: boardTitle(title) }).eq('id', id)).error)
    },
    async deleteBoard(id) {
      const r = await sb.from('project_boards').delete().eq('id', id).select('id')
      fail(r.error)
      if (!r.data?.length) throw new ApiError('보드는 만든 사람이나 관리자만 지울 수 있습니다.')
    },
    async saveBoard(id, scene, version) {
      const r = await sb.rpc('board_save', { p_id: id, p_scene: scene, p_version: version })
      fail(r.error)
      const d = r.data as { ok: boolean; version: number; scene?: unknown; updated_by_name?: string }
      return d.ok ? { ok: true, version: d.version } : { ok: false, version: d.version, scene: readScene(d.scene), updated_by_name: d.updated_by_name || '팀원' }
    },
    async uploadBoardFile(path, blob) {
      const r = await sb.storage.from('project-boards').upload(path, blob, { contentType: blob.type || 'image/png', upsert: false })
      if (r.error && !/exists/i.test(r.error.message)) throw new ApiError(`사진을 올리지 못했습니다: ${r.error.message}`)
    },
    async downloadBoardFile(path) {
      const r = await sb.storage.from('project-boards').download(path)
      if (r.error || !r.data) throw new ApiError('사진을 받지 못했습니다.')
      return r.data
    },
    watchBoard(id, who, on) {
      // 비공개 방송 · 접속 표시: 팀원만 (realtime.messages 정책 board_live_*). 실패하면 조용히 '혼자 보기'로.
      try {
        const ch = sb.channel(`board:${id}`, { config: { private: true, presence: { key: who.id } } })
        const peers = () => {
          const seen = new Map<string, BoardPeer>()
          for (const list of Object.values(ch.presenceState() as Record<string, { id?: string; name?: string }[]>)) for (const p of list) if (p.id && p.name) seen.set(p.id, { id: p.id, name: p.name })
          on.peers([...seen.values()])
        }
        ch.on('presence', { event: 'sync' }, peers)
          .on('broadcast', { event: 'saved' }, ({ payload }) => {
            const p = payload as { id?: string; name?: string; version?: number }
            if (p?.id && typeof p.version === 'number') on.saved({ id: p.id, name: p.name ?? '팀원', version: p.version })
          })
          .subscribe(status => { if (status === 'SUBSCRIBED') void ch.track({ id: who.id, name: who.name }).catch(() => undefined) })
        return {
          saved: version => { void ch.send({ type: 'broadcast', event: 'saved', payload: { id: who.id, name: who.name, version } }).catch(() => undefined) },
          close: () => { void sb.removeChannel(ch) },
        }
      } catch {
        on.peers([who])
        return { saved() {}, close() {} }
      }
    },
  }
}

/** 체험 모드: 자료를 두지 않음 (대표 지시 '목업은 올리지 마') */
export function createDemoBoardApi(): BoardApi {
  // 화면 확인용: 개발 서버에서 VITE_BOARD_HARNESS=1 일 때만 메모리에 보드를 둠 (배포 묶음에는 늘 꺼짐)
  if (import.meta.env?.DEV && import.meta.env?.VITE_BOARD_HARNESS === '1') return memoryBoardApi()
  const none = async (): Promise<never> => { throw new ApiError('화이트보드는 운영 계정에서만 쓸 수 있습니다.') }
  return {
    async listBoards() { return [] },
    async getBoard() { return null },
    createBoard: none, renameBoard: none, deleteBoard: none, saveBoard: none, uploadBoardFile: none, downloadBoardFile: none,
    watchBoard(_id, who, on) { queueMicrotask(() => on.peers([who])); return { saved() {}, close() {} } },
  }
}

function memoryBoardApi(): BoardApi {
  const boards = new Map<string, { board: ProjectBoard; scene: BoardScene }>()
  const now = () => new Date().toISOString()
  return {
    async listBoards(projectId) { return [...boards.values()].filter(b => b.board.project_id === projectId).map(b => ({ ...b.board, count: b.scene.elements.length })) },
    async getBoard(id) { return boards.get(id) ?? null },
    async createBoard(projectId, title) {
      const board: ProjectBoard = { id: `harness-${boards.size + 1}`, project_id: projectId, title: boardTitle(title), version: 1, created_by: null, updated_by: null, created_at: now(), updated_at: now() }
      boards.set(board.id, { board, scene: { elements: [], files: {} } })
      return board
    },
    async renameBoard(id, title) { const b = boards.get(id); if (b) b.board.title = boardTitle(title) },
    async deleteBoard(id) { boards.delete(id) },
    async saveBoard(id, scene, version) {
      const b = boards.get(id)
      if (!b) throw new ApiError('없음')
      if (b.board.version !== version) return { ok: false, version: b.board.version, scene: b.scene, updated_by_name: '팀원' }
      b.scene = scene; b.board.version++; b.board.updated_at = now()
      return { ok: true, version: b.board.version }
    },
    async uploadBoardFile() {},
    async downloadBoardFile() { return new Blob() },
    watchBoard(_id, who, on) { queueMicrotask(() => on.peers([who])); return { saved() {}, close() {} } },
  }
}
