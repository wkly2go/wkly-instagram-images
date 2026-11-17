// 스펙북 → 평면 · 보드 연동 (2026-11-17 대표 지시 '견적 도면 스펙을 모두 연동시켜서 하나만 수정해도 모두 연동')
// 평면(벽 · 문 · 부품 · 실별 마감 · 조명 수량)과 제안 보드의 마감 견본은 스펙 항목을 재료 번호(PT-01) 글로 가리킨다.
// 스펙북에서 번호 · 품명 · 규격을 고치면 그 글을 새 번호 · 이름으로 바꿔 도면 · 3D · 수량(→ 견적)이 따라오게 한다.
// 사람이 번호 뒤에 따로 적은 말(예: 'PT-01 2회 도장')은 남기고 번호만 바꾼다. 번호로 시작하지 않는 글은 건드리지 않는다.
import type { PlanGeometry, RoomPart } from './designPlan.ts'
import type { ProposalBoard } from './designBoard.ts'

export interface SpecRef { code?: string | null; name?: string | null; spec?: string | null }

/** 번호 비교용: 대소문자 · 띄어쓰기 · 하이픈을 무시한다 (PT-01 = PT 01 = pt01) */
export const normCode = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s-]+/g, '')
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 글 맨 앞의 옛 번호(띄어쓰기 · 하이픈 차이 허용)를 찾는 식. 번호 뒤에 영문 · 숫자가 바로 붙으면 다른 번호다 (PT-01 ≠ PT-011) */
function codeHead(code: string): RegExp | null {
  const n = normCode(code)
  if (!n) return null
  return new RegExp(`^${[...n].map(esc).join('[\\s-]?')}(?![0-9A-Za-z])`, 'i')
}
/** a 가 b 로 시작하고 그 뒤가 끝이거나 띄어쓰기면 남은 부분 (아니면 null) */
function after(a: string, b: string): string | null {
  if (!b) return null
  if (a === b) return ''
  return a.startsWith(`${b} `) ? a.slice(b.length + 1) : null
}

/** 마감 글 하나를 새 번호 · 이름으로. 바꿀 것이 없으면 받은 값을 그대로 돌려준다 */
export function renameFinishText(value: string | undefined, oldItem: SpecRef, newItem: SpecRef): string | undefined {
  if (!value) return value
  const head = codeHead(oldItem.code ?? '')
  const newCode = squash(newItem.code)
  if (!head || !newCode) return value
  const t = squash(value)
  const m = t.match(head)
  if (!m) return value
  const rest = t.slice(m[0].length).trim()
  let out: string
  if (!rest) out = normCode(t) === normCode(newCode) ? value : newCode
  else {
    const on = squash(oldItem.name), os = squash(oldItem.spec), nn = squash(newItem.name) || on, ns = squash(newItem.spec)
    // 옛 품명 · 규격을 그대로 옮겨 적은 글이면 새 품명 · 규격으로 (그 뒤에 덧붙인 말은 남긴다)
    const both = on && os ? after(rest, `${on} ${os}`) : null
    const name = both === null ? after(rest, on) : null
    const spec = both === null && name === null ? after(rest, os) : null
    if (both !== null) out = [newCode, nn, ns, both].filter(Boolean).join(' ')
    else if (name !== null) out = [newCode, nn, name].filter(Boolean).join(' ')
    else if (spec !== null) out = [newCode, ns || nn, spec].filter(Boolean).join(' ')
    else out = `${newCode} ${rest}`
  }
  return squash(out) === squash(value) ? value : out
}

/** 평면 안의 마감 참조를 모두 바꾼다. changed = 바뀐 곳 수 (0 이면 plan 은 받은 것 그대로) */
export function renameFinishRefs(plan: PlanGeometry, oldItem: SpecRef, newItem: SpecRef): { plan: PlanGeometry; changed: number } {
  if (!normCode(oldItem.code) || !squash(newItem.code)) return { plan, changed: 0 }
  let changed = 0
  const fix = (v: string | undefined) => { const n = renameFinishText(v, oldItem, newItem); if (n !== v) changed++; return n }
  const part = (p: RoomPart): RoomPart => { const mat = fix(p?.mat); return mat === p?.mat ? p : { ...p, mat } }
  const oldKey = normCode(oldItem.code), newKey = squash(newItem.code)
  const walls = plan.walls.map(w => { const finish = fix(w.finish); return finish === w.finish ? w : { ...w, finish } })
  const openings = plan.openings.map(o => { const finish = fix(o.finish), frame = fix(o.frame); return finish === o.finish && frame === o.frame ? o : { ...o, finish, frame } })
  const items = plan.items.map(it => { const finish = fix(it.finish); return finish === it.finish ? it : { ...it, finish } })
  const rooms = plan.rooms?.map(r => {
    const floor = part(r.floor), base = part(r.base), wall = part(r.wall), ceiling = part(r.ceiling)
    // 조명 수량표는 조명 기호(DL-01)를 열쇠로 쓴다 — 번호가 바뀌면 열쇠도 옮긴다 (새 번호가 이미 있으면 더한다)
    let lights = r.lights
    const hit = Object.keys(r.lights ?? {}).find(k => normCode(k) === oldKey && k !== newKey)
    if (hit && r.lights) {
      const { [hit]: n, ...restLights } = r.lights
      lights = { ...restLights, [newKey]: (restLights[newKey] ?? 0) + (n ?? 0) }
      changed++
    }
    return floor === r.floor && base === r.base && wall === r.wall && ceiling === r.ceiling && lights === r.lights ? r : { ...r, floor, base, wall, ceiling, lights }
  })
  if (!changed) return { plan, changed: 0 }
  return { plan: { ...plan, walls, openings, items, ...(rooms ? { rooms } : {}) }, changed }
}

/** 제안 보드의 마감 견본(swatch) 글도 같은 규칙으로 바꾼다. 스펙 카드 · 일람표는 항목 id 로 이어져 있어 저절로 따라온다 */
export function renameBoardFinishRefs(board: ProposalBoard, oldItem: SpecRef, newItem: SpecRef): { board: ProposalBoard; changed: number } {
  if (!normCode(oldItem.code) || !squash(newItem.code)) return { board, changed: 0 }
  let changed = 0
  const pages = board.pages.map(p => {
    let hit = false
    const els = p.els.map(e => {
      if (e.type !== 'swatch' || !e.finish) return e
      const finish = renameFinishText(e.finish, oldItem, newItem)
      if (finish === e.finish) return e
      hit = true; changed++
      return { ...e, finish }
    })
    return hit ? { ...p, els } : p
  })
  return changed ? { board: { ...board, pages }, changed } : { board, changed: 0 }
}
