// 공통 화이트보드 화면 /boards (2026-11-27 대표 지시 '모든 프로젝트에서 공통으로 사용가능하게')
//  - 공통 보드(프로젝트 없음) · 템플릿 · 모든 프로젝트 보드(프로젝트별로 묶음 · 누르면 그 프로젝트 화면)
import { PenLine } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { relativeLabel } from '../lib/date'
import { Link } from '../lib/router'
import type { ProjectBoard } from '../lib/boardApi'
import type { Project } from '../lib/types'
import { BoardsSection } from '../components/ProjectBoards'
import { projectOptionLabel } from '../components/ProjectOptions'
import { SectionHead } from '../components/ui'
import './Board.css'

export default function BoardsPage() {
  const { api, version } = useApp()
  const all = useAsync(async () => {
    const [boards, projects] = await Promise.all([api.listAllBoards(), api.listProjects().catch(() => [] as Project[])])
    return { boards, projects }
  }, [api, version], { boards: [] as ProjectBoard[], projects: [] as Project[] })
  const templates = all.data.boards.filter(b => b.is_template)
  const byProject = new Map<string, ProjectBoard[]>()
  for (const b of all.data.boards) if (b.project_id && !b.is_template) byProject.set(b.project_id, [...(byProject.get(b.project_id) ?? []), b])
  const projectsWithBoards = all.data.projects.filter(p => byProject.has(p.id))
  return (
    <div className="col gap-16 boards-page">
      <BoardsSection projectId={null} title="공통 화이트보드" newTitle="공통 보드" />
      <section className="section" aria-label="템플릿">
        <SectionHead title="템플릿" count={templates.length ? String(templates.length) : undefined} />
        {templates.length ? (
          <ul className="pboards-list">
            {templates.map(t => (
              <li key={t.id} className="pboards-row">
                <Link to={`/board?id=${t.id}`} className="pboards-item"><b><PenLine size={13} /> {t.title}</b><span className="pboards-meta">그림 {t.count ?? 0}개 · {relativeLabel(t.updated_at)} · 누르면 템플릿 고치기</span></Link>
              </li>
            ))}
          </ul>
        ) : <p className="pboards-note">아직 템플릿이 없습니다. 아무 보드나 오른쪽 위 틀 아이콘으로 ‘템플릿으로 저장’하면 모든 프로젝트에서 새 보드의 틀로 고를 수 있습니다.</p>}
      </section>
      <section className="section" aria-label="프로젝트 보드">
        <SectionHead title="프로젝트 보드" count={String(all.data.boards.filter(b => b.project_id).length)} />
        {!projectsWithBoards.length && !all.loading && <p className="pboards-note">아직 프로젝트에서 만든 보드가 없습니다.</p>}
        {projectsWithBoards.map(p => (
          <div key={p.id} className="boards-proj">
            <Link to={`/projects?id=${p.id}`} className="boards-proj-name">{projectOptionLabel(p)}</Link>
            <ul className="pboards-list">
              {(byProject.get(p.id) ?? []).map(b => (
                <li key={b.id} className="pboards-row">
                  <Link to={`/board?id=${b.id}`} className="pboards-item"><b><PenLine size={13} /> {b.title}</b><span className="pboards-meta">그림 {b.count ?? 0}개 · {relativeLabel(b.updated_at)}</span></Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}
