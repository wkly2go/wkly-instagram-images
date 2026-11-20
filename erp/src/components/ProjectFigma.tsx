// 프로젝트 화면 '피그잼 · 피그마' 칸 (2026-11-20 대표 지시 '피그잼 계속 사용중 · 인트라넷에서 사용하고 자료도 저장 · 제출용 pdf 도 출력')
//  - 보드 주소를 붙여 연결 → 미리보기 그림 · 프레임 목록 · 보드 글을 인트라넷에 보관(30분마다 바뀐 것만 다시 읽음)
//  - '여기서 보기'는 피그마 공식 보여 주기(피그마에 로그인한 브라우저에서 보임) · 편집은 피그잼에서
//  - 제출용 PDF: 프레임을 골라 순서대로 한 부 → 인트라넷 보관 + 프로젝트 드라이브 '제안서' 폴더에 자동 저장
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download, ExternalLink, Eye, FileText, KeyRound, Link2, RefreshCw, Trash2, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { relativeLabel } from '../lib/date'
import { driveIdOf, listChildren, newFolder, uploadToDrive, FOLDER_MIME, type GFile } from '../lib/gdrive'
import { FIGMA_KIND_LABEL, figmaEmbedUrl, isWide, type FigmaExport, type ProjectFigma as Linked } from '../lib/figmaApi'
import type { Project } from '../lib/types'
import { ask } from './Ask'
import { Button, Field, Modal, SectionHead } from './ui'
import './ProjectFigma.css'

const download = (blob: Blob, name: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}

export function ProjectFigma({ project }: { project: Project }) {
  const { api, me, version, bump, toast } = useApp()
  const status = useAsync(() => api.figmaStatus().catch(() => ({ token: false })), [api, version], { token: false })
  const list = useAsync(() => api.listProjectFigma(project.id), [api, project.id, version], { files: [] as Linked[], exports: [] as FigmaExport[] })
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [pdfFor, setPdfFor] = useState<Linked | null>(null)
  const [tokenOpen, setTokenOpen] = useState(false)
  const admin = me.role === 'admin'
  const files = list.data.files

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try { await fn(); if (ok) toast(ok); bump() } catch (e) { toast(e instanceof Error ? e.message : '처리하지 못했습니다.') } finally { setBusy(null) }
  }
  const link = () => run('link', async () => { await api.linkFigma(project.id, url); setUrl('') }, '보드를 연결하고 내용을 인트라넷에 저장했습니다.')

  return (
    <section className="section pfig" aria-label="피그잼 · 피그마">
      <SectionHead title="피그잼 · 피그마" count={files.length ? String(files.length) : undefined}
        right={admin ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setTokenOpen(true)}><KeyRound size={13} /> {status.data.token ? '피그마 열쇠 바꾸기' : '피그마 열쇠 넣기'}</button> : undefined} />
      {!status.loading && !status.data.token ? (
        <p className="pfig-note">{admin ? '먼저 오른쪽 위 ‘피그마 열쇠 넣기’로 피그마 읽기 열쇠를 넣어 주세요. 한 번만 넣으면 모든 팀원이 보드를 연결할 수 있습니다.' : '관리자가 피그마 열쇠를 넣으면 이 프로젝트에 피그잼 보드를 연결할 수 있습니다.'}</p>
      ) : (
        <form className="pfig-link" onSubmit={e => { e.preventDefault(); if (url.trim()) void link() }}>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="피그잼 · 피그마 주소 붙여 넣기 (보드 › 공유 › 링크 복사)" aria-label="피그잼 주소" />
          <Button type="submit" disabled={!url.trim() || busy === 'link'}><Link2 size={13} /> {busy === 'link' ? '연결 중…' : '연결'}</Button>
        </form>
      )}
      {files.length > 0 && (
        <ul className="pfig-list">
          {files.map(f => (
            <li key={f.id} className="pfig-item">
              <div className="pfig-card">
                {f.thumb_url ? <img src={f.thumb_url} alt="" className="pfig-thumb" loading="lazy" /> : <div className="pfig-thumb pfig-thumb-empty">{FIGMA_KIND_LABEL[f.kind]}</div>}
                <div className="pfig-body">
                  <b className="pfig-title">{f.title || '(이름 없음)'}</b>
                  <span className="pfig-meta">{FIGMA_KIND_LABEL[f.kind]} · 프레임 {f.frames.length}개{f.last_modified ? ` · ${relativeLabel(f.last_modified)} 수정` : ''}{f.content ? ` · 글 ${f.content.length.toLocaleString()}자 보관` : ''}</span>
                  {f.sync_error && <span className="pfig-err" role="alert">{f.sync_error}</span>}
                  <div className="pfig-actions">
                    <a className="btn btn-sm" href={f.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> {FIGMA_KIND_LABEL[f.kind]}에서 편집</a>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setViewing(viewing === f.id ? null : f.id)} aria-expanded={viewing === f.id}><Eye size={13} /> {viewing === f.id ? '닫기' : '여기서 보기'}</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setPdfFor(f)} disabled={!f.frames.length}><FileText size={13} /> 제출용 PDF</button>
                    <button type="button" className="icon-btn" title="다시 읽기" aria-label="다시 읽기" disabled={busy === f.id} onClick={() => void run(f.id, () => api.refreshFigma(f.id), '보드 내용을 다시 읽었습니다.')}><RefreshCw size={13} className={busy === f.id ? 'spin' : undefined} /></button>
                    {(f.created_by === me.id || admin) && (
                      <button type="button" className="icon-btn" title="연결 떼기" aria-label="연결 떼기" onClick={async () => { if (await ask(`‘${f.title}’ 연결을 뗄까요? 피그잼 보드는 그대로 남고, 인트라넷에 보관한 미리보기 · 글만 지워집니다. 만든 PDF 도 함께 지워집니다.`)) void run(f.id, () => api.unlinkFigma(f.id), '연결을 뗐습니다.') }}><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              </div>
              {viewing === f.id && (
                <div className="pfig-embed">
                  <iframe title={`${f.title} 보기`} src={figmaEmbedUrl(f.url)} allowFullScreen />
                  <p className="pfig-note">피그마에 로그인한 브라우저에서 보입니다. 안 보이면 ‘{FIGMA_KIND_LABEL[f.kind]}에서 편집’으로 여세요.</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.data.exports.length > 0 && (
        <div className="pfig-exports">
          <span className="pfig-meta">만든 PDF</span>
          {list.data.exports.map(x => (
            <span key={x.id} className="pfig-export">
              <button type="button" className="chip" onClick={() => void api.figmaExportBlob(x.path).then(b => download(b, `${x.title}.pdf`)).catch(e => toast(e instanceof Error ? e.message : '받지 못했습니다.'))}>
                <Download size={11} /> {x.title} · {x.pages}쪽 · {relativeLabel(x.created_at)}
              </button>
              {x.drive_url && <a className="pfig-drive" href={x.drive_url} target="_blank" rel="noopener noreferrer">드라이브</a>}
            </span>
          ))}
        </div>
      )}
      {pdfFor && <PdfMaker project={project} file={pdfFor} onClose={() => { setPdfFor(null); bump() }} />}
      {tokenOpen && <TokenForm hasToken={status.data.token} onClose={() => { setTokenOpen(false); bump() }} />}
    </section>
  )
}

/** 프레임을 골라 순서대로 PDF 한 부 → 받기 + 프로젝트 드라이브 '제안서' 폴더에 자동 저장 */
function PdfMaker({ project, file, onClose }: { project: Project; file: Linked; onClose: () => void }) {
  const { api, toast } = useApp()
  const wide = file.frames.filter(f => isWide(f.w, f.h))
  const [order, setOrder] = useState<string[]>((wide.length ? wide : file.frames).map(f => f.id))
  const [title, setTitle] = useState(`${project.code ? `${project.code} ` : ''}${project.name} 제안서`)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const byId = useMemo(() => new Map(file.frames.map(f => [f.id, f])), [file.frames])
  const pages = useMemo(() => [...new Set(file.frames.map(f => f.page))], [file.frames])
  const toggle = (id: string) => setOrder(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]))
  const move = (i: number, d: -1 | 1) => setOrder(o => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n })

  const make = async () => {
    setBusy(true); setDone(null)
    try {
      const r = await api.exportFigmaPdf(file.id, order, title)
      const blob = await api.figmaExportBlob(r.path)
      download(blob, `${title}.pdf`)
      // 프로젝트 드라이브 '제안서' 폴더에 자동 저장 (폴더가 연결된 프로젝트만)
      const root = project.drive_url ? driveIdOf(project.drive_url) : null
      let where = '인트라넷에 보관했습니다'
      if (root) {
        try {
          const tk = await api.driveAccessToken()
          if (tk) {
            const folder = await proposalFolder(tk.token, root)
            const g = await uploadToDrive(tk.token, new File([blob], `${title}.pdf`, { type: 'application/pdf' }), folder)
            if (g.webViewLink) await api.markFigmaExportDrive(r.id, g.id, g.webViewLink)
            where = '인트라넷과 프로젝트 드라이브 ‘제안서’ 폴더에 저장했습니다'
          }
        } catch { where = '인트라넷에 보관했습니다 (드라이브 저장은 실패 · 위 목록에서 다시 받을 수 있음)' }
      }
      setDone(`${r.pages}쪽 PDF 를 만들어 내려받고 ${where}.`)
      toast('제출용 PDF 를 만들었습니다.')
    } catch (e) { toast(e instanceof Error ? e.message : 'PDF 를 만들지 못했습니다.') } finally { setBusy(false) }
  }

  return (
    <Modal title="제출용 PDF 만들기" onClose={onClose} wide
      actions={<><Button kind="outline" onClick={onClose}>닫기</Button><Button onClick={() => void make()} disabled={busy || !order.length}>{busy ? 'PDF 만드는 중…' : `${order.length}쪽 PDF 만들기`}</Button></>}>
      <Field label="파일 이름"><input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} /></Field>
      <p className="pfig-note">고른 프레임 · 섹션이 한 장씩, 아래 순서대로 들어갑니다. {wide.length ? '16:9 프레임을 먼저 골라 두었습니다.' : '16:9 프레임이 없어 전체를 골라 두었습니다 — 제출용은 1920×1080 프레임으로 만들면 페이지 크기가 고릅니다.'}</p>
      {done && <p className="pfig-done" role="status">{done}</p>}
      <div className="pfig-pdf">
        <div>
          <b className="pfig-meta">넣을 순서 ({order.length})</b>
          <ol className="pfig-order">
            {order.map((id, i) => {
              const f = byId.get(id)
              return (
                <li key={id}>
                  <span className="truncate">{i + 1}. {f?.name ?? id}</span>
                  <button type="button" className="icon-btn" aria-label="위로" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={12} /></button>
                  <button type="button" className="icon-btn" aria-label="아래로" onClick={() => move(i, 1)} disabled={i === order.length - 1}><ArrowDown size={12} /></button>
                  <button type="button" className="icon-btn" aria-label="빼기" onClick={() => toggle(id)}><X size={12} /></button>
                </li>
              )
            })}
          </ol>
        </div>
        <div>
          <b className="pfig-meta">프레임 · 섹션 ({file.frames.length})</b>
          {pages.map(pg => (
            <div key={pg} className="pfig-page">
              {pages.length > 1 && <span className="pfig-meta">{pg}</span>}
              {file.frames.filter(f => f.page === pg).map(f => (
                <label key={f.id} className="pfig-frame">
                  <input type="checkbox" checked={order.includes(f.id)} onChange={() => toggle(f.id)} />
                  <span className="truncate">{f.name || f.type}</span>
                  <span className="pfig-meta">{f.w}×{f.h}{isWide(f.w, f.h) ? ' · 16:9' : ''}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/** 프로젝트 폴더 안 '제안서' 폴더 (한 층 · 두 층 아래에서 찾고 없으면 '02.제안서' 를 만듦) */
async function proposalFolder(token: string, root: string): Promise<string> {
  const isProposal = (f: GFile) => f.mimeType === FOLDER_MIME && /제안/.test(f.name)
  const top = await listChildren(token, root, { foldersOnly: true })
  const hit = top.find(isProposal)
  if (hit) return hit.id
  for (const t of top.slice(0, 12)) {
    const sub = (await listChildren(token, t.id, { foldersOnly: true }).catch(() => [] as GFile[])).find(isProposal)
    if (sub) return sub.id
  }
  return (await newFolder(token, '02.제안서', root)).id
}

/** 관리자: 피그마 읽기 열쇠 넣기 (값은 금고에만 · 다시 보여 주지 않음) */
function TokenForm({ hasToken, onClose }: { hasToken: boolean; onClose: () => void }) {
  const { api, toast } = useApp()
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (value: string) => {
    setBusy(true)
    try { await api.setFigmaToken(value); toast(value ? '피그마 열쇠를 저장했습니다.' : '피그마 열쇠를 지웠습니다.'); onClose() } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.') } finally { setBusy(false) }
  }
  return (
    <Modal title="피그마 읽기 열쇠" onClose={onClose}
      actions={<>{hasToken && <Button kind="outline" onClick={() => void save('')} disabled={busy}>지우기</Button>}<Button onClick={() => void save(v.trim())} disabled={busy || !v.trim()}>저장</Button></>}>
      <ol className="pfig-steps">
        <li>피그마(figma.com)에 회사 계정으로 로그인 → 왼쪽 위 계정 이름 › <b>Settings</b> › <b>Security</b> › <b>Personal access tokens</b> › <b>Generate new token</b></li>
        <li>이름: ‘WKLY 인트라넷’ · 기간: 가장 길게 · 권한: <b>File content — Read only</b>(나머지는 고르지 않음)</li>
        <li>만들어진 값을 아래에 붙여 넣고 저장 — 값은 서버 금고에만 들어가고 다시 보이지 않습니다. 대화 · 메일로 보내지 마세요.</li>
      </ol>
      <Field label={hasToken ? '새 열쇠 (지금 열쇠를 바꿈)' : '열쇠'}><input type="password" autoComplete="off" value={v} onChange={e => setV(e.target.value)} placeholder="figd_…" /></Field>
    </Modal>
  )
}
