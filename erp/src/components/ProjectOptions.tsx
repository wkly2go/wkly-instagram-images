import { DIVISIONS, DIVISION_KEYS, projectBrand, type Division, type Project } from '../lib/types'

type P = Pick<Project, 'id' | 'name'> & Partial<Pick<Project, 'code' | 'division' | 'status'>>
const DONE = new Set(['완료', '보류'])

/** 구분(아트리어 · 더위클리 · 내부 리서치)별로 묶고, 진행 중 먼저 · 연번 순으로 정렬 */
export function groupProjects<T extends P>(projects: T[]): { division: Division; list: T[] }[] {
  return DIVISION_KEYS.map(d => ({
    division: d,
    list: projects
      .filter(p => projectBrand({ code: p.code ?? null, division: p.division }) === d)
      .sort((a, b) => Number(DONE.has(a.status ?? '')) - Number(DONE.has(b.status ?? '')) || (a.code ?? '~').localeCompare(b.code ?? '~') || a.name.localeCompare(b.name)),
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
      {groupProjects(projects).map(g => (
        <optgroup key={g.division} label={`${DIVISIONS[g.division].label} (${g.list.length})`}>
          {g.list.map(p => (
            <option key={p.id} value={p.id}>
              {projectOptionLabel(p)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

/** 검색형 선택 칸(SearchPick)용: 구분별 묶음 정보가 붙은 항목 */
export function projectPickItems(projects: P[]) {
  return groupProjects(projects).flatMap((g, order) =>
    g.list.map(p => ({ id: p.id, label: p.name, sub: p.code ?? undefined, section: { key: g.division, label: DIVISIONS[g.division].full, color: DIVISIONS[g.division].color, order } })),
  )
}
