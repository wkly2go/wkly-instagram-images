// 협업 화이트보드 (로드맵 3단계 · 2026-11-20) — 그림 자료를 다루는 순수 함수만 (시험: tests/board.test.ts)
//  - 그림(scene)은 Excalidraw 요소 배열 + 붙인 사진 목록. 사진 본문(dataURL)은 DB 에 넣지 않고 보관함 경로만 적는다.
//  - 동시 편집: 같은 요소를 두 사람이 고치면 version 이 큰 쪽(같으면 versionNonce 가 작은 쪽)을 남긴다(요소별 합치기).

/** 요소에서 우리가 보는 칸만 (Excalidraw 요소는 이 밖에도 칸이 많지만 그대로 실어 나름) */
export interface BoardElement { id: string; version: number; versionNonce: number; isDeleted?: boolean; type?: string; fileId?: string | null; [k: string]: unknown }
/** 보관함에 올린 사진 한 장 (dataURL 대신 경로) */
export interface BoardFileRef { id: string; mimeType: string; path: string; created: number }
export interface BoardScene { elements: BoardElement[]; files: Record<string, BoardFileRef>; background?: string }

export const EMPTY_SCENE: BoardScene = { elements: [], files: {} }

/** DB 에서 읽은 값을 안전하게 그림 자료로 (모양이 틀린 줄은 버림) */
export function readScene(raw: unknown): BoardScene {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const elements = Array.isArray(o.elements)
    ? (o.elements as unknown[]).filter((e): e is BoardElement => !!e && typeof e === 'object' && typeof (e as BoardElement).id === 'string' && typeof (e as BoardElement).version === 'number')
    : []
  const files: Record<string, BoardFileRef> = {}
  if (o.files && typeof o.files === 'object')
    for (const [k, v] of Object.entries(o.files as Record<string, unknown>)) {
      const f = v as BoardFileRef
      if (f && typeof f.path === 'string' && typeof f.mimeType === 'string') files[k] = { id: k, mimeType: f.mimeType, path: f.path, created: Number(f.created) || 0 }
    }
  return { elements, files, background: typeof o.background === 'string' ? o.background : undefined }
}

/** 요소별 합치기: 두 쪽에 다 있으면 더 새 판, 한쪽에만 있으면 그대로 */
export function mergeElements(mine: readonly BoardElement[], theirs: readonly BoardElement[]): BoardElement[] {
  const out = new Map<string, BoardElement>()
  for (const e of theirs) out.set(e.id, e)
  for (const e of mine) {
    const t = out.get(e.id)
    if (!t || e.version > t.version || (e.version === t.version && e.versionNonce < t.versionNonce)) out.set(e.id, e)
  }
  // 순서: 상대 순서를 기본으로, 내 쪽에만 있는 것은 뒤에 (Excalidraw 가 index 칸으로 다시 정렬)
  const theirIds = new Set(theirs.map(e => e.id))
  const order = [...theirs.map(e => e.id), ...mine.filter(e => !theirIds.has(e.id)).map(e => e.id)]
  return order.map(id => out.get(id)!).filter(Boolean)
}

/** 바뀌었는지 빠르게 보는 표시 (요소 id · version 합) — 같으면 저장할 것이 없음 */
export function sceneSignature(elements: readonly Pick<BoardElement, 'id' | 'version'>[]): string {
  let h = 0
  for (const e of elements) {
    const s = `${e.id}:${e.version}`
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return `${elements.length}:${h}`
}

/** 저장할 그림: 지운 요소는 30일 지난 것만 버리지 않고 그대로 두되(합치기에 필요), 쓰는 사진만 남김 */
export function sceneForSave(elements: readonly BoardElement[], files: Record<string, BoardFileRef>, background?: string, now = Date.now()): BoardScene {
  const used = new Set(elements.filter(e => !e.isDeleted && e.fileId).map(e => e.fileId as string))
  const keep: Record<string, BoardFileRef> = {}
  for (const id of used) if (files[id]) keep[id] = files[id]
  // 지운 요소는 함께 보는 사람과 합칠 때 필요해 남기되, 하루 지난 것은 버림 (2026-11-27 · 피그마를 크게 불러왔다 지워도 저장 크기가 계속 커지지 않게)
  const alive = elements.filter(e => !e.isDeleted || typeof e.updated !== 'number' || now - (e.updated as number) < TOMBSTONE_MS)
  return { elements: alive, files: keep, ...(background ? { background } : {}) }
}

/** 지운 요소를 남겨 두는 시간 */
export const TOMBSTONE_MS = 24 * 3600 * 1000

/** 자동 저장 대기: 요소가 많을수록 덜 자주 (서버 쓰기 부하 · 2026-11-27 피그마 대량 불러오기 대비) */
export function saveDelay(count: number): number {
  return count < 800 ? 2000 : count < 2500 ? 5000 : 9000
}

/** 보관함 경로: <보드 id>/<파일 id>.<확장자> */
export function boardFilePath(boardId: string, fileId: string, mimeType: string): string {
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' } as Record<string, string>)[mimeType] ?? 'bin'
  return `${boardId}/${fileId.replace(/[^A-Za-z0-9_-]/g, '')}.${ext}`
}

/** 보드 제목 정리 (1~60자) */
export function boardTitle(t: string): string {
  return t.replace(/\s+/g, ' ').trim().slice(0, 60) || '새 보드'
}

/** 여러 개를 한 번에 n개씩 나란히 처리 (사진 받기 · 올리기 · 순서는 그대로 · 하나가 실패해도 나머지는 계속 → 실패는 null) */
export async function pool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      try { out[i] = await fn(items[i]) } catch { out[i] = null }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, run))
  return out
}
