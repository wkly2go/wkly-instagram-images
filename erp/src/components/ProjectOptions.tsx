import { DIVISIONS, DIVISION_KEYS, projectBrand, type Division, type Project } from '../lib/types'

type P = Pick<Project, 'id' | 'name'> & Partial<Pick<Project, 'code' | 'division' | 'status'>>
const DONE = new Set(['완료', '보류'])
/** 상태 순서: 진행 → 기획 → NIC(계약 전) → 완료 → 보류 · 그 밖은 맨 뒤 (대표 지시 2026-11-18 '프로젝트 구분') */
const STATUS_ORDER = ['진행', '기획', '상담협의', 'NIC', '완료', '보류']
const statusRank = (s?: string | null) => { const i = STATUS_ORDER.indexOf(s ?? ''); return i < 0 ? STATUS_ORDER.length : i }

/** 구분(아트리어 · 더위클리 · 내부 리서치)별로 묶고, 진행 중 먼저 · 연번 순으로 정렬 */
export function groupProjects<T extends P>(projects: T[]): { division: Division; list: T[] }[] {
  return DIVISION_KEYS.map(d => ({
    division: d,
    list: projects
      .filter(p => projectBrand({ code: p.code ?? null, division: p.division }) === d)
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || (b.code ?? '').localeCompare(a.code ?? '') || a.name.localeCompare(b.name)),
  })).filter(g => g.list.length > 0)
}
export const projectOptionLabel = (p: P) => `${p.code ? `${p.code} ` : ''}${p.name}${p.status && DONE.has(p.status) ? ` · ${p.status}` : ''}`

/**
 * 프로젝트를 고르는 모든 목록에 쓰는 공통 선택지 (대표 지시 2026-11-16 '프로젝트 검색하는 모든 것은 항상 구분')
 *  - <select> 안에 넣으면 구분별 묶음(optgroup) · 연번 + 이름 · 끝난 프로젝트는 뒤로
 */
export function ProjectOptions({ projects }: { projects: P[] }) {
  return (
    <>
      {groupProjects(projects).flatMap(g => {
        // 구분 안에서 상태별로 다시 묶음: '아트리어 · 진행 (4)' · '아트리어 · 계약 전 (NIC) (61)' — 긴 목록에서도 진행 중이 맨 위
        const byStatus = new Map<string, typeof g.list>()
        for (const p of g.list) {
          const k = p.status ?? '기타'
          byStatus.set(k, [...(byStatus.get(k) ?? []), p])
        }
        return [...byStatus].map(([st, list]) => (
          <optgroup key={`${g.division}-${st}`} label={`${DIVISIONS[g.division].label} · ${st === 'NIC' ? '계약 전 (NIC)' : st} (${list.length})`}>
            {list.map(p => (
              <option key={p.id} value={p.id}>
                {projectOptionLabel(p)}
              </option>
            ))}
          </optgroup>
        ))
      })}
    </>
  )
}

/** 검색형 선택 칸(SearchPick)용: 구분별 묶음 정보가 붙은 항목 */
export function projectPickItems(projects: P[]) {
  return groupProjects(projects).flatMap((g, order) =>
    g.list.map(p => ({ id: p.id, label: p.name, sub: p.code ?? undefined, section: { key: g.division, label: DIVISIONS[g.division].full, color: DIVISIONS[g.division].color, order } })),
  )
}
