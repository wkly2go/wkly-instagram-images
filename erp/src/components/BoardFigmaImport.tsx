// 화이트보드 › 피그마 불러오기 (2026-11-27 대표 '화이트보드에 피그마 불러오기 가능하도록')
// 모든 프로젝트에 연결한 피그마 · 피그잼(프로젝트 화면 '피그잼 · 피그마' 칸)의 프레임을 골라 PNG 그림으로 보드에 붙임.
// 2026-11-27 '모든 프로젝트에서 공통으로': 이 보드의 프로젝트 것이 먼저, 다른 프로젝트 · 공통 보드에서도 모두 고를 수 있음.
// 피그마는 읽기만 · 한 번에 6개 · 그림은 보드 사진처럼 비공개 보관함에 저장됨(보드 자동 저장이 올림).
import { useState } from 'react'
import { X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import type { ProjectFigma } from '../lib/figmaApi'
import type { Project } from '../lib/types'

export interface FigmaPicked { fileId: string; name: string; w: number; h: number; mime: string; dataURL: string }

const MAX = 6

export function BoardFigmaImport({ projectId, onClose, onPick }: { projectId: string | null; onClose: () => void; onPick: (p: FigmaPicked[]) => void }) {
  const { api, toast } = useApp()
  const list = useAsync(async () => {
    const [all, projects] = await Promise.all([api.listAllFigma(), api.listProjects().catch(() => [] as Project[])])
    return { files: all.sort((a, b) => Number(b.project_id === projectId) - Number(a.project_id === projectId)), projects }
  }, [api, projectId], { files: [] as ProjectFigma[], projects: [] as Project[] })
  const projects = list.data.projects
  const projName = (id: string) => { const p = projects.find(x => x.id === id); return p ? `${p.code ? `${p.code} ` : ''}${p.name}` : '' }
  const [fileId, setFileId] = useState<string | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const files = list.data.files
  const file = files.find(f => f.id === (fileId ?? files[0]?.id)) ?? null
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= MAX ? s : [...s, id]))
  const load = async () => {
    if (!file || !sel.length) return
    setBusy(true)
    try {
      const imgs = await api.figmaFrameImages(file.id, sel)
      onPick(imgs.map(i => ({ fileId: `figma-${file.file_key}-${i.id.replace(/[^0-9a-z]/gi, '_')}-${Date.now().toString(36)}`, name: i.name, w: i.w, h: i.h, mime: i.mime, dataURL: `data:${i.mime};base64,${i.data}` })))
    } catch (e) { toast(e instanceof Error ? e.message : '피그마 그림을 불러오지 못했습니다.') } finally { setBusy(false) }
  }
  return (
    <div className="board-figma" role="dialog" aria-label="피그마 불러오기">
      <div className="board-figma-head">
        <b>피그마 · 피그잼 프레임 불러오기</b>
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
      </div>
      {list.loading ? <p className="board-figma-note">불러오는 중입니다.</p> : !files.length ? (
        <p className="board-figma-note">연결된 피그마 · 피그잼 보드가 없습니다. 아무 프로젝트 화면 › ‘피그잼 · 피그마’ 칸에서 보드 주소를 먼저 연결해 주세요. 한 번 연결하면 모든 화이트보드에서 불러올 수 있습니다.</p>
      ) : (
        <>
          <label className="board-figma-pick">
            <span className="board-figma-meta">피그마 보드</span>
            <select className="input" value={file?.id ?? ''} onChange={e => { setFileId(e.target.value); setSel([]) }}>
              {files.map(f => (
                <option key={f.id} value={f.id}>{f.project_id === projectId ? '이 프로젝트 · ' : projName(f.project_id) ? `${projName(f.project_id)} · ` : ''}{f.title || f.url}</option>
              ))}
            </select>
          </label>
          <p className="board-figma-note">붙일 프레임을 고르세요 (한 번에 {MAX}개까지 · 고른 순서대로 오른쪽에 나란히).</p>
          <ul className="board-figma-list">
            {(file?.frames ?? []).map(fr => (
              <li key={fr.id}>
                <label>
                  <input type="checkbox" checked={sel.includes(fr.id)} onChange={() => toggle(fr.id)} disabled={!sel.includes(fr.id) && sel.length >= MAX} />
                  <span className="board-figma-name">{fr.name || fr.id}</span>
                  <span className="board-figma-meta">{fr.page} · {fr.w}×{fr.h}{sel.includes(fr.id) ? ` · ${sel.indexOf(fr.id) + 1}번째` : ''}</span>
                </label>
              </li>
            ))}
            {file && !file.frames.length && <li className="board-figma-note">이 보드에 프레임이 없습니다. 피그마에서 프레임 · 섹션을 만든 뒤 ‘다시 읽기’를 눌러 주세요.</li>}
          </ul>
          <div className="board-figma-foot">
            <span className="board-figma-meta">{sel.length ? `${sel.length}개 고름` : ''}</span>
            <span className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>취소</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()} disabled={busy || !sel.length}>{busy ? '불러오는 중…' : '보드에 붙이기'}</button>
          </div>
        </>
      )}
    </div>
  )
}
