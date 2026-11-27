// 외부 협업방 › 화이트보드 — 순수 규칙만 (시험: tests/collab-board.test.ts)
// 외부인이 보낸 그림은 그대로 믿지 않는다: 크기 · 요소 수 · 사진 경로를 검사하고, 아는 칸만 남긴다.

export const GUEST_BOARD_MAX_BYTES = 3_800_000
export const GUEST_BOARD_MAX_ELEMENTS = 12_000
export const GUEST_FILE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

export interface FileRef { id: string; mimeType: string; path: string; created: number }
export interface Scene { elements: Record<string, unknown>[]; files: Record<string, FileRef>; background?: string }

/** 외부인이 올릴 수 있는 사진 경로인지: <보드 id>/<글자 · 숫자 · _ · ->.<png|jpg|webp|gif> (SVG 는 받지 않음) */
export function guestFilePathOk(boardId: string, path: string): boolean {
  if (typeof path !== 'string' || !path.startsWith(`${boardId}/`)) return false
  return /^[A-Za-z0-9_-]{1,80}\.(png|jpg|webp|gif)$/.test(path.slice(boardId.length + 1))
}

/** 서버에 있는 그림의 사진 목록 (경로 모음) */
export function scenePaths(scene: unknown): Set<string> {
  const out = new Set<string>()
  const files = (scene && typeof scene === 'object' ? (scene as { files?: unknown }).files : null) as Record<string, { path?: unknown }> | null
  if (files && typeof files === 'object') for (const f of Object.values(files)) if (f && typeof f.path === 'string') out.add(f.path)
  return out
}

/** 외부인이 보낸 그림을 저장할 모양으로. 문제가 있으면 한국어 이유를 던짐
 *  - 사진 경로는 이미 서버 그림에 있던 것이거나, 이 보드 폴더에 외부인이 올릴 수 있는 꼴만
 *  - 요소는 id(글) · version(수)이 있는 것만 · 요소의 link 는 http(s) 만 남김 */
export function cleanGuestScene(raw: unknown, boardId: string, known: Set<string>): Scene {
  if (!raw || typeof raw !== 'object') throw new Error('그림 자료가 올바르지 않습니다.')
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.elements)) throw new Error('그림 자료가 올바르지 않습니다.')
  if (o.elements.length > GUEST_BOARD_MAX_ELEMENTS) throw new Error('요소가 너무 많습니다. 일부를 지운 뒤 다시 저장해 주세요.')
  const elements: Record<string, unknown>[] = []
  for (const e of o.elements) {
    if (!e || typeof e !== 'object') continue
    const el = e as Record<string, unknown>
    if (typeof el.id !== 'string' || !el.id || el.id.length > 80 || typeof el.version !== 'number') continue
    if (el.link != null && !(typeof el.link === 'string' && /^https?:\/\//i.test(el.link) && el.link.length <= 2000)) el.link = null
    elements.push(el)
  }
  const files: Record<string, FileRef> = {}
  if (o.files && typeof o.files === 'object') {
    for (const [k, v] of Object.entries(o.files as Record<string, unknown>)) {
      const f = v as Partial<FileRef> | null
      if (!f || typeof f.path !== 'string' || typeof f.mimeType !== 'string' || k.length > 120) continue
      if (!known.has(f.path) && !(guestFilePathOk(boardId, f.path) && GUEST_FILE_EXT[f.mimeType])) throw new Error('이 보드에 올린 사진만 넣을 수 있습니다.')
      files[k] = { id: k, mimeType: f.mimeType.slice(0, 40), path: f.path, created: Number(f.created) || 0 }
    }
  }
  const scene: Scene = { elements, files, ...(typeof o.background === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.background) ? { background: o.background } : {}) }
  if (new TextEncoder().encode(JSON.stringify(scene)).length > GUEST_BOARD_MAX_BYTES) throw new Error('보드가 너무 큽니다. 요소를 줄인 뒤 다시 저장해 주세요.')
  return scene
}
