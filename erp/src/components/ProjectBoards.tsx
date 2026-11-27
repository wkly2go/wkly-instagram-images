// 프로젝트 화면 '화이트보드' 칸 (로드맵 3단계 · 2026-11-20) — 이 프로젝트의 보드 목록 · 새 보드 · 지우기
// 2026-11-27 대표 지시 '화이트보드가 바로 아래로 열리게 · 전체화면 아이콘은 별도로': 보드를 누르면 목록 바로 아래에 열림,
// 목록의 넓은 화면 아이콘은 /board 화면(넓게) · 편집기 안 아이콘은 브라우저 전체 화면. 편집기(Excalidraw)는 열 때만 불러옴
import { lazy, Suspense, useState } from 'react'
import { Maximize2, PenLine, Plus, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { relativeLabel } from '../lib/date'
import { Link } from '../lib/router'
import type { ProjectBoard } from '../lib/boardApi'
import type { Project } from '../lib/types'
import { ask } from './Ask'
import { ErrorBoundary } from './ErrorBoundary'
import { SectionHead } from './ui'
import '../pages/Board.css'

const BoardEditor = lazy(() => import('./BoardEditor'))

export function ProjectBoards({ project }: { project: Project }) {
  const { api, me, version, bump, toast, profileName } = useApp()
  const { data, loading } = useAsync(() => api.listBoards(project.id), [api, project.id, version], [] as ProjectBoard[])
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const create = async () => {
    setBusy(true)
    try {
      const b = await api.createBoard(project.id, `${project.name} 보드 ${data.length + 1}`)
      bump()
      setOpenId(b.id)
    } catch (e) { toast(e instanceof Error ? e.message : '보드를 만들지 못했습니다.') } finally { setBusy(false) }
  }
  const remove = async (b: ProjectBoard) => {
    if (!(await ask(`'${b.title}' 보드를 지울까요? 그림과 메모가 모두 지워지고 되돌릴 수 없습니다.`))) return
    try { await api.deleteBoard(b.id); if (openId === b.id) setOpenId(null); bump(); toast('보드를 지웠습니다.') } catch (e) { toast(e instanceof Error ? e.message : '지우지 못했습니다.') }
  }
  const close = () => { setOpenId(null); bump() }
  return (
    <section className="section" aria-label="화이트보드">
      <SectionHead title="화이트보드" count={data.length ? String(data.length) : undefined}
        right={<button type="button" className="btn btn-outline btn-sm" onClick={() => void create()} disabled={busy}><Plus size={13} /> 새 보드</button>} />
      {!loading && data.length === 0 && <p className="pboards-note">아이디어 · 동선 · 도면 위 메모를 팀원과 함께 그리는 판입니다. 사진을 붙이고 화살표 · 메모를 남기면 자동으로 저장됩니다.</p>}
      {data.length > 0 && (
        <ul className="pboards-list">
          {data.map(b => (
            <li key={b.id} className={`pboards-row${openId === b.id ? ' open' : ''}`}>
              <button type="button" className="pboards-item" onClick={() => (openId === b.id ? close() : setOpenId(b.id))} aria-expanded={openId === b.id}>
                <b><PenLine size={13} /> {b.title}</b>
                <span className="pboards-meta">그림 {b.count ?? 0}개 · {profileName(b.updated_by ?? b.created_by)} · {relativeLabel(b.updated_at)}</span>
              </button>
              <Link to={`/board?id=${b.id}`} className="icon-btn pboards-full" title="넓은 화면으로 열기" aria-label={`${b.title} 넓은 화면으로 열기`}><Maximize2 size={13} /></Link>
              {(b.created_by === me.id || me.role === 'admin') && (
                <button type="button" className="icon-btn pboards-del" title="보드 지우기" aria-label={`${b.title} 지우기`} onClick={() => void remove(b)}><Trash2 size={13} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {openId && (
        <ErrorBoundary area="화이트보드">
          <Suspense fallback={<p className="pboards-note">보드를 여는 중입니다.</p>}>
            <BoardEditor key={openId} id={openId} embedded onClose={close} />
          </Suspense>
        </ErrorBoundary>
      )}
    </section>
  )
}
