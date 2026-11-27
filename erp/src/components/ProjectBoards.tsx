// 화이트보드 목록 (로드맵 3단계 · 2026-11-20) — 프로젝트 화면 · 공통 화이트보드 화면(/boards)이 같이 씀
// 2026-11-27 대표 지시: '바로 아래로 열리게 · 전체화면 아이콘은 별도로' → 보드를 누르면 목록 바로 아래에 열림(편집기는 열 때만 불러옴)
//   '모든 프로젝트에서 공통으로' → 공통 보드(프로젝트 없음) · 템플릿에서 새 보드 · 다른 프로젝트 · 공통으로 복사 · 템플릿으로 저장
import { lazy, Suspense, useState } from 'react'
import { Copy, LayoutTemplate, Maximize2, PenLine, Plus, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { relativeLabel } from '../lib/date'
import { Link } from '../lib/router'
import type { ProjectBoard } from '../lib/boardApi'
import type { Project } from '../lib/types'
import { ask } from './Ask'
import { ErrorBoundary } from './ErrorBoundary'
import { ProjectOptions } from './ProjectOptions'
import { Modal, SectionHead } from './ui'
import '../pages/Board.css'

const BoardEditor = lazy(() => import('./BoardEditor'))

/** 프로젝트 화면: 이 프로젝트 보드 + 공통 보드(접어 둠) */
export function ProjectBoards({ project }: { project: Project }) {
  const [common, setCommon] = useState(false)
  return (
    <>
      <BoardsSection projectId={project.id} title="화이트보드" newTitle={`${project.name} 보드`} />
      <div className="pboards-common">
        <button type="button" className="link-btn" onClick={() => setCommon(c => !c)} aria-expanded={common}>{common ? '▾' : '▸'} 공통 화이트보드 (모든 프로젝트에서 함께 씀)</button>
        {common && <BoardsSection projectId={null} title="공통 화이트보드" newTitle="공통 보드" compact />}
      </div>
    </>
  )
}

type Target = { board: ProjectBoard; mode: 'copy' | 'template' }

/** 보드 목록 한 묶음 (projectId 가 null 이면 공통 보드) */
export function BoardsSection({ projectId, title, newTitle, compact = false }: { projectId: string | null; title: string; newTitle: string; compact?: boolean }) {
  const { api, me, version, bump, toast, profileName } = useApp()
  const { data, loading } = useAsync(() => api.listBoards(projectId), [api, projectId, version], [] as ProjectBoard[])
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [target, setTarget] = useState<Target | null>(null)
  const create = async (templateId?: string, templateTitle?: string) => {
    setBusy(true); setPicking(false)
    try {
      const name = `${newTitle} ${data.length + 1}${templateTitle ? ` (${templateTitle})` : ''}`
      const id = templateId ? await api.copyBoard(templateId, { projectId, title: name }) : (await api.createBoard(projectId, name)).id
      bump()
      setOpenId(id)
    } catch (e) { toast(e instanceof Error ? e.message : '보드를 만들지 못했습니다.') } finally { setBusy(false) }
  }
  const remove = async (b: ProjectBoard) => {
    if (!(await ask(`'${b.title}' 보드를 지울까요? 그림과 메모가 모두 지워지고 되돌릴 수 없습니다.`))) return
    try { await api.deleteBoard(b.id); if (openId === b.id) setOpenId(null); bump(); toast('보드를 지웠습니다.') } catch (e) { toast(e instanceof Error ? e.message : '지우지 못했습니다.') }
  }
  const close = () => { setOpenId(null); bump() }
  return (
    <section className={`section${compact ? ' pboards-compact' : ''}`} aria-label={title}>
      <SectionHead title={title} count={data.length ? String(data.length) : undefined}
        right={
          <span className="pboards-new">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicking(p => !p)} disabled={busy} aria-expanded={picking}><Plus size={13} /> 새 보드</button>
            {picking && <TemplatePick onPick={(id, t) => void create(id, t)} onClose={() => setPicking(false)} />}
          </span>
        } />
      {!loading && data.length === 0 && <p className="pboards-note">{projectId ? '아이디어 · 동선 · 도면 위 메모를 팀원과 함께 그리는 판입니다. 사진을 붙이고 화살표 · 메모를 남기면 자동으로 저장됩니다.' : '어느 프로젝트에도 묶이지 않은 회사 공통 보드입니다. 모든 프로젝트 화면 · 화이트보드 메뉴에서 함께 열어 씁니다.'}</p>}
      {data.length > 0 && (
        <ul className="pboards-list">
          {data.map(b => (
            <li key={b.id} className={`pboards-row${openId === b.id ? ' open' : ''}`}>
              <button type="button" className="pboards-item" onClick={() => (openId === b.id ? close() : setOpenId(b.id))} aria-expanded={openId === b.id}>
                <b><PenLine size={13} /> {b.title}</b>
                <span className="pboards-meta">그림 {b.count ?? 0}개 · {profileName(b.updated_by ?? b.created_by)} · {relativeLabel(b.updated_at)}</span>
              </button>
              <span className="pboards-tools">
                <button type="button" className="icon-btn" title="다른 프로젝트 · 공통으로 복사" aria-label={`${b.title} 복사`} onClick={() => setTarget({ board: b, mode: 'copy' })}><Copy size={13} /></button>
                <button type="button" className="icon-btn" title="템플릿으로 저장" aria-label={`${b.title} 템플릿으로 저장`} onClick={() => setTarget({ board: b, mode: 'template' })}><LayoutTemplate size={13} /></button>
                <Link to={`/board?id=${b.id}`} className="icon-btn" title="넓은 화면으로 열기" aria-label={`${b.title} 넓은 화면으로 열기`}><Maximize2 size={13} /></Link>
                {(b.created_by === me.id || me.role === 'admin') && (
                  <button type="button" className="icon-btn" title="보드 지우기" aria-label={`${b.title} 지우기`} onClick={() => void remove(b)}><Trash2 size={13} /></button>
                )}
              </span>
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
      {target && <CopyDialog target={target} fromProject={projectId} onClose={() => setTarget(null)} />}
    </section>
  )
}

/** 새 보드: 빈 보드 또는 템플릿에서 */
function TemplatePick({ onPick, onClose }: { onPick: (templateId?: string, title?: string) => void; onClose: () => void }) {
  const { api, version } = useApp()
  const { data, loading } = useAsync(() => api.listBoardTemplates(), [api, version], [] as ProjectBoard[])
  return (
    <div className="pboards-pick" role="menu" onMouseLeave={onClose}>
      <button type="button" role="menuitem" onClick={() => onPick()}><b>빈 보드</b></button>
      {loading ? <span className="pboards-meta">템플릿 불러오는 중…</span> : data.map(t => (
        <button key={t.id} type="button" role="menuitem" onClick={() => onPick(t.id, t.title)}><LayoutTemplate size={13} /> {t.title}<span className="pboards-meta"> · 그림 {t.count ?? 0}개</span></button>
      ))}
      {!loading && !data.length && <span className="pboards-meta">템플릿이 없습니다. 보드 오른쪽 위 틀 아이콘으로 저장할 수 있습니다.</span>}
    </div>
  )
}

/** 복사 · 템플릿으로 저장 */
function CopyDialog({ target, fromProject, onClose }: { target: Target; fromProject: string | null; onClose: () => void }) {
  const { api, bump, toast } = useApp()
  const projects = useAsync(() => api.listProjects(), [api], [] as Project[])
  const [to, setTo] = useState<string>(fromProject ?? '')
  const [name, setName] = useState(target.mode === 'template' ? target.board.title : `${target.board.title} 사본`)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      await api.copyBoard(target.board.id, { projectId: to || null, title: name, template: target.mode === 'template' })
      bump()
      const where = target.mode === 'template' ? '템플릿' : to ? projects.data.find(p => p.id === to)?.name ?? '프로젝트' : '공통 화이트보드'
      toast(`'${name}' 을(를) ${where}${target.mode === 'template' ? '으로 저장했습니다.' : '에 복사했습니다.'}`)
      onClose()
    } catch (e) { toast(e instanceof Error ? e.message : '복사하지 못했습니다.') } finally { setBusy(false) }
  }
  return (
    <Modal title={target.mode === 'template' ? '템플릿으로 저장' : '보드 복사'} onClose={onClose}
      actions={<><button type="button" className="btn btn-ghost" onClick={onClose}>취소</button><button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy || !name.trim()}>{target.mode === 'template' ? '템플릿으로 저장' : '복사'}</button></>}>
      <div className="col gap-10">
        <p className="pboards-note">{target.mode === 'template' ? '이 보드의 그림을 틀로 저장합니다. 어느 프로젝트에서나 ‘새 보드 › 템플릿’으로 같은 그림에서 시작할 수 있습니다. 원래 보드는 그대로입니다.' : '이 보드의 그림을 그대로 복사해 새 보드를 만듭니다. 원래 보드는 그대로입니다.'}</p>
        <label className="vf-field wide"><span>{target.mode === 'template' ? '템플릿 이름' : '새 보드 이름'}</span><input className="input" value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>
        {target.mode === 'copy' && (
          <label className="vf-field wide"><span>어디로</span>
            <select className="input" value={to} onChange={e => setTo(e.target.value)}>
              <option value="">공통 화이트보드 (프로젝트 없음)</option>
              <ProjectOptions projects={projects.data} />
            </select>
          </label>
        )}
      </div>
    </Modal>
  )
}
