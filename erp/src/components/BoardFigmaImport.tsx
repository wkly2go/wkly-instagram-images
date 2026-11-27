// 화이트보드 › 피그마 불러오기 (2026-11-27 대표 '화이트보드에 피그마 불러오기 가능하도록')
// 모든 프로젝트에 연결한 피그마 · 피그잼(프로젝트 화면 '피그잼 · 피그마' 칸)의 프레임을 골라 PNG 그림으로 보드에 붙임.
// 2026-11-27 '모든 프로젝트에서 공통으로': 이 보드의 프로젝트 것이 먼저, 다른 프로젝트 · 공통 보드에서도 모두 고를 수 있음.
// 피그마는 읽기만 · 한 번에 6개 · 그림은 보드 사진처럼 비공개 보관함에 저장됨(보드 자동 저장이 올림).
// 2026-11-27 대표 '프레임말고 모든 컨텐츠를 불러와서 수정할 수 있게': 기본은 '수정 가능한 요소로'(글 · 도형 · 선 · 포스트잇 · 연결선은
// 보드 요소, 아이콘 · 로고 · 사진은 그림 요소) · '그림 한 장으로'는 예전처럼. 피그마 원본은 바뀌지 않음.
// 2026-11-27 대표 '피그마 링크에 있는 자료를 모두 불러오고': 연결하지 않은 파일도 주소를 붙여 넣어 바로 · '모두 고르기'(최대 30개)는
// 3개씩 나눠 받아 피그마 배치 그대로 한 번에 붙임.
import { useState } from 'react'
import { Link2, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import type { FigmaFrame, ProjectFigma } from '../lib/figmaApi'
import { mergeContents, pickAllFrames, type FigmaContent } from '../lib/figmaToBoard'
import type { Project } from '../lib/types'

export interface FigmaPicked { fileId: string; name: string; w: number; h: number; mime: string; dataURL: string }

const MAX_IMAGE = 6
const MAX_EDIT = 30
const BATCH = 3
/** 한 번에 붙이는 요소 합계 한도 (보드 저장 크기 · 서버 쓰기 부하) */
const MAX_ELEMENTS = 8000

type Source = { kind: 'linked'; file: ProjectFigma } | { kind: 'url'; url: string; title: string; frames: FigmaFrame[] }

export function BoardFigmaImport({ projectId, onClose, onPick, onContent }: { projectId: string | null; onClose: () => void; onPick: (p: FigmaPicked[]) => void; onContent: (c: FigmaContent) => void }) {
  const { api, toast } = useApp()
  const list = useAsync(async () => {
    const [all, projects] = await Promise.all([api.listAllFigma(), api.listProjects().catch(() => [] as Project[])])
    return { files: all.sort((a, b) => Number(b.project_id === projectId) - Number(a.project_id === projectId)), projects }
  }, [api, projectId], { files: [] as ProjectFigma[], projects: [] as Project[] })
  const projects = list.data.projects
  const projName = (id: string) => { const p = projects.find(x => x.id === id); return p ? `${p.code ? `${p.code} ` : ''}${p.name}` : '' }
  const [fileId, setFileId] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linked, setLinked] = useState<Extract<Source, { kind: 'url' }> | null>(null)
  const [reading, setReading] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [mode, setMode] = useState<'edit' | 'image'>('edit')
  const MAX = mode === 'edit' ? MAX_EDIT : MAX_IMAGE
  const files = list.data.files
  const file = files.find(f => f.id === (fileId ?? files[0]?.id)) ?? null
  const source: Source | null = linked ?? (file ? { kind: 'linked', file } : null)
  const frames = source ? (source.kind === 'url' ? source.frames : source.file.frames) : []
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= MAX ? s : [...s, id]))

  /** 붙여 넣은 피그마 주소의 프레임 목록 읽기 (주소에 node-id 가 있으면 그것을 미리 고름) */
  const readLink = async () => {
    const url = linkUrl.trim()
    if (!url) return
    setReading(true)
    try {
      const o = await api.figmaOutline(url)
      setLinked({ kind: 'url', url, title: o.title, frames: o.frames })
      setSel(o.node ? [o.node] : [])
      toast(`‘${o.title || '피그마 파일'}’ 프레임 ${o.frames.length}개를 읽었습니다.${o.node ? ' 주소의 프레임을 골라 두었습니다.' : ''}`)
    } catch (e) { toast(e instanceof Error ? e.message : '피그마 주소를 읽지 못했습니다.') } finally { setReading(false) }
  }

  const selectAll = () => setSel(pickAllFrames(frames, MAX).map(f => f.id))

  const load = async () => {
    if (!source || !sel.length) return
    setBusy(true)
    try {
      if (mode === 'edit') {
        // 3개씩 나눠 받고, 한 묶음이 실패해도 나머지는 계속 (요소 합계가 너무 많으면 거기서 멈춤 — 저장 부하)
        const parts: FigmaContent[] = []
        let failed = 0, total = 0, lastErr = ''
        for (let i = 0; i < sel.length; i += BATCH) {
          if (total >= MAX_ELEMENTS) break
          const part = sel.slice(i, i + BATCH)
          setProgress(`${Math.min(i + BATCH, sel.length)} / ${sel.length}`)
          try {
            const c = source.kind === 'url' ? await api.figmaContentByUrl(source.url, part) : await api.figmaContent(source.file.id, part)
            parts.push(c)
            total += c.frames.reduce((n, f) => n + f.els.length, 0)
          } catch (e) { failed += part.length; lastErr = e instanceof Error ? e.message : '' }
        }
        if (!parts.length) throw new Error(lastErr || '피그마를 불러오지 못했습니다.')
        onContent(mergeContents(parts))
        const got = parts.reduce((n, p) => n + p.frames.length, 0)
        if (failed || got < sel.length) toast(`프레임 ${sel.length}개 중 ${got}개를 붙였습니다.${failed ? ` ${failed}개는 받지 못했습니다(${lastErr || '피그마 응답 없음'}) — 다시 시도해 주세요.` : ' 요소가 많아 나머지는 멈췄습니다 — 남은 프레임을 다시 골라 붙여 주세요.'}`)
        return
      }
      if (source.kind !== 'linked') { toast('그림 한 장으로는 프로젝트에 연결한 파일만 됩니다. ‘수정 가능한 요소로’를 써 주세요.'); return }
      const imgs = await api.figmaFrameImages(source.file.id, sel)
      onPick(imgs.map(i => ({ fileId: `figma-${source.file.file_key}-${i.id.replace(/[^0-9a-z]/gi, '_')}-${Date.now().toString(36)}`, name: i.name, w: i.w, h: i.h, mime: i.mime, dataURL: `data:${i.mime};base64,${i.data}` })))
    } catch (e) { toast(e instanceof Error ? e.message : '피그마를 불러오지 못했습니다.') } finally { setBusy(false); setProgress('') }
  }
  return (
    <div className="board-figma" role="dialog" aria-label="피그마 불러오기">
      <div className="board-figma-head">
        <b>피그마 · 피그잼 불러오기</b>
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
      </div>
      <form className="board-figma-link" onSubmit={e => { e.preventDefault(); void readLink() }}>
        <input className="input" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="피그마 주소 붙여 넣기 (figma.com/…)" aria-label="피그마 주소" />
        <button type="submit" className="btn btn-outline btn-sm" disabled={reading || !linkUrl.trim()}><Link2 size={13} /> {reading ? '읽는 중…' : '읽기'}</button>
      </form>
      {list.loading && !linked ? <p className="board-figma-note">불러오는 중입니다.</p> : !source ? (
        <p className="board-figma-note">위 칸에 피그마 주소를 붙여 넣거나, 프로젝트 화면 › ‘피그잼 · 피그마’ 칸에서 보드를 연결해 주세요.</p>
      ) : (
        <>
          {linked ? (
            <p className="board-figma-note"><b>{linked.title || '피그마 파일'}</b> · 붙여 넣은 주소 <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLinked(null); setSel([]) }}>연결한 파일로 돌아가기</button></p>
          ) : (
            <label className="board-figma-pick">
              <span className="board-figma-meta">연결한 피그마 파일</span>
              <select className="input" value={file?.id ?? ''} onChange={e => { setFileId(e.target.value); setSel([]) }}>
                {files.map(f => (
                  <option key={f.id} value={f.id}>{f.project_id === projectId ? '이 프로젝트 · ' : projName(f.project_id) ? `${projName(f.project_id)} · ` : ''}{f.title || f.url}</option>
                ))}
              </select>
            </label>
          )}
          <div className="board-figma-mode" role="radiogroup" aria-label="불러오는 방식">
            <label><input type="radio" checked={mode === 'edit'} onChange={() => setMode('edit')} /> 수정 가능한 요소로 <span className="board-figma-meta">글 · 도형 · 선 · 포스트잇을 보드에서 바로 고침 · 아이콘 · 사진은 그림 · 최대 {MAX_EDIT}개</span></label>
            <label><input type="radio" checked={mode === 'image'} onChange={() => { setMode('image'); setSel(s => s.slice(0, MAX_IMAGE)) }} /> 그림 한 장으로 <span className="board-figma-meta">보이는 그대로 · 고칠 수 없음 · {MAX_IMAGE}개까지</span></label>
          </div>
          <div className="board-figma-tools">
            <span className="board-figma-meta">프레임 {frames.length}개 · 피그마 배치 그대로 붙습니다 · 원본은 바뀌지 않습니다</span>
            <span className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={selectAll} disabled={!frames.length}>모두 고르기</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel([])} disabled={!sel.length}>비우기</button>
          </div>
          <ul className="board-figma-list">
            {frames.map(fr => (
              <li key={fr.id}>
                <label>
                  <input type="checkbox" checked={sel.includes(fr.id)} onChange={() => toggle(fr.id)} disabled={!sel.includes(fr.id) && sel.length >= MAX} />
                  <span className="board-figma-name">{fr.name || fr.id}</span>
                  <span className="board-figma-meta">{fr.page} · {fr.w}×{fr.h}{sel.includes(fr.id) ? ` · ${sel.indexOf(fr.id) + 1}번째` : ''}</span>
                </label>
              </li>
            ))}
            {!frames.length && <li className="board-figma-note">이 파일에 프레임이 없습니다. 피그마에서 프레임 · 섹션을 만든 뒤 다시 읽어 주세요.</li>}
          </ul>
          <div className="board-figma-foot">
            <span className="board-figma-meta">{busy && progress ? `받는 중 ${progress}` : sel.length ? `${sel.length}개 고름` : ''}</span>
            <span className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>취소</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()} disabled={busy || !sel.length}>{busy ? (mode === 'edit' ? '요소로 바꾸는 중…' : '불러오는 중…') : '보드에 붙이기'}</button>
          </div>
        </>
      )}
    </div>
  )
}
