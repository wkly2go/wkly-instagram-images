import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ExternalLink, Eye, FileText, Folder, FolderOpen, Link2, LogIn, Pencil, Trash2, Upload, X, FolderPlus } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { dateLabel } from '../lib/date'
import { projectDriveUrl, type DriveIndexFile, type Project, type ProjectDriveFile } from '../lib/types'
import { serverDriveToken, driveApi, driveIdOf, editUrl, ensureProjectFolder, FILE_FIELDS, fileMeta, FOLDER_MIME, googleLogin, kindOfUrl, nativeGoogle, onTokenChange, previewUrl, readToken, uploadToDrive, type GFile } from '../lib/gdrive'
import { openLink } from './WebSearch'
import { Button, Empty, Modal, SectionHead } from './ui'
import { ask } from './Ask'

/**
 * 구글 문서 편집 열기 (대표 지시 2026-10-20 "인트라넷 내에서 구글 문서의 편집이 가능하게")
 *  - PC 프로그램: 드라이브 탭의 큰 칸에서 구글 문서 · 시트 · 슬라이드를 그대로 편집
 *  - 웹 브라우저: 드라이브 탭의 편집 칸(구글 편집기를 화면 안에)에서 편집 · 안 보이면 새 창 버튼 (대표 지시 2026-10-20 "구글 드라이브 앱내에서 편집 가능하도록")
 */
export function useOpenDoc() {
  // 드라이브 탭은 탐색기만 (2026-10-31) → 문서는 오른쪽 칸(PC 프로그램) · 새 창(웹)에서 편집
  return (url: string) => openLink(editUrl(url))
}

/**
 * 프로젝트 ↔ 드라이브 폴더 맞추기 (대표 지시 2026-10-21): 회사 구글 계정에 로그인돼 있으면
 * #ARTERIOR_연도 / #WKLY_연도 아래 '연번_이름' 폴더를 만들거나 이름 · 위치를 맞추고 주소를 저장.
 * 로그인 전이면 아무것도 하지 않음 (null) — 다음에 프로젝트를 열 때 '폴더 만들기'로
 */
export function useProjectFolderSync() {
  const { api } = useApp()
  return async (p: Project): Promise<string | null> => {
    // 1) 회사 구글 계정이 서버에 연결돼 있으면 서버가 처리 (PC 프로그램 · 웹 모두, 로그인 필요 없음)
    let r = await api.driveEnsure(p.id)
    // 2) 아니면 이 브라우저의 회사 계정 구글 로그인으로
    if (!r) {
      const token = readToken()
      if (!token) return null
      r = await ensureProjectFolder(token, p)
      if (r.url && r.url !== p.drive_url) await api.saveProject({ id: p.id, drive_url: r.url })
    }
    return r.action === 'created' ? '드라이브 폴더를 만들었습니다.' : r.action === 'linked' ? '같은 연번의 드라이브 폴더를 연결했습니다.' : r.action === 'renamed' ? '드라이브 폴더 이름을 맞췄습니다.' : r.action === 'moved' ? '드라이브 폴더를 새 그룹 연도 폴더로 옮겼습니다.' : null
  }
}

/** 구글 로그인 토큰 (웹 브라우저) — 바뀌면 다시 그림 */
export function useDriveToken() {
  const { api } = useApp()
  const [t, setT] = useState<string | null>(readToken)
  const [srv, setSrv] = useState<string | null>(null)
  useEffect(() => {
    const off = onTokenChange(setT)
    return () => {
      off()
    }
  }, [])
  // 개인 로그인이 없으면 회사 계정(서버) 토큰으로 — 연결돼 있으면 로그인 없이 바로
  useEffect(() => {
    if (t) return
    let alive = true
    const load = () => serverDriveToken(() => api.driveAccessToken()).then(v => alive && setSrv(v))
    void load()
    const id = window.setInterval(load, 10 * 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [api, t])
  return t ?? srv
}

const TYPE_LABEL: Record<string, string> = {
  'application/vnd.google-apps.document': '문서',
  'application/vnd.google-apps.spreadsheet': '시트',
  'application/vnd.google-apps.presentation': '슬라이드',
  'application/vnd.google-apps.form': '설문',
  [FOLDER_MIME]: '폴더',
  'application/pdf': 'PDF',
}
const typeLabel = (m: string | null) => (m ? TYPE_LABEL[m] ?? (m.startsWith('image/') ? '이미지' : m.startsWith('video/') ? '영상' : '파일') : '파일')

/**
 * 프로젝트 · 구글 드라이브 자료 (대표 지시 2026-10-20 "드라이브의 자료를 프로젝트에 첨부, 첨부한 자료는 구글드라이브와 연동")
 *  - 파일을 복사하지 않고 드라이브 파일을 가리킴 → 드라이브에서 고친 내용이 늘 그대로 (이름도 열 때 최신으로 맞춤)
 *  - 첨부: 드라이브에서 고르기(웹 · 구글 로그인) · 드라이브 링크 붙여 넣기(모두) · 파일 올리기 → 프로젝트 드라이브 폴더에 저장 후 첨부
 *  - 열기: 구글 문서 · 시트 · 슬라이드는 편집 화면으로, 웹에서는 인트라넷 안 미리 보기도
 */
export function ProjectDriveSection({ project }: { project: Project }) {
  const { api, me, version, toast } = useApp()
  const { busy, run } = useAction()
  const openDoc = useOpenDoc()
  const token = useDriveToken()
  const native = nativeGoogle()
  const { data: files, reload } = useAsync(() => api.listProjectDriveFiles(project.id), [version, project.id], [] as ProjectDriveFile[])
  const { data: clientId } = useAsync(() => (native ? Promise.resolve(null) : api.getGoogleClientId()), [version], null as string | null)
  const [link, setLink] = useState('')
  const [picking, setPicking] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const upload = useRef<HTMLInputElement>(null)
  const folder = projectDriveUrl(project)
  const folderId = folder.exact ? driveIdOf(folder.url) : null
  const canEdit = (f: ProjectDriveFile) => me.role === 'admin' || f.added_by === me.id
  const syncFolder = useProjectFolderSync()
  const makeFolder = async () => {
    setErr('')
    try {
      const server = (await api.driveStatus()).connected
      if (!server && !readToken()) await login()
      if (!server && !readToken()) return
      let msg: string | null = null
      const ok = await run(async () => {
        msg = await syncFolder(project)
      })
      if (ok) toast(msg ?? '드라이브 폴더가 이미 맞게 정리돼 있습니다.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '드라이브 폴더를 만들지 못했습니다.')
    }
  }

  // 연동: 구글에 로그인돼 있으면 열 때마다 드라이브의 최신 이름 · 종류로 맞춤
  useEffect(() => {
    if (!token || !files.length) return
    let off = false
    void (async () => {
      for (const f of files) {
        try {
          const m = await fileMeta(token, f.drive_id)
          if (off) return
          if (m.name !== f.name || (m.mimeType && m.mimeType !== f.mime_type)) await api.renameProjectDriveFile(f.id, { name: m.name, mime_type: m.mimeType, icon_url: m.iconLink ?? null }).catch(() => undefined)
        } catch {
          /* 권한 없음 · 지워짐: 그대로 둠 */
        }
      }
    })()
    return () => {
      off = true
    }
  }, [token, files.length])

  const login = async () => {
    setErr('')
    try {
      if (!clientId) throw new Error('관리자가 드라이브 탭에서 구글 로그인 연결을 먼저 등록해야 합니다.')
      await googleLogin(clientId, me.email)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '구글 로그인 실패')
    }
  }
  const attachLink = async () => {
    const url = link.trim()
    const id = driveIdOf(url)
    if (!id || !/^https:\/\/(drive|docs)\.google\.com\//.test(url)) return setErr('구글 드라이브 · 문서 주소를 붙여 넣어 주세요 (https://drive.google.com/… 또는 https://docs.google.com/…).')
    setErr('')
    let meta: GFile | null = null
    if (token) meta = await fileMeta(token, id).catch(() => null)
    const k = kindOfUrl(url)
    const ok = await run(
      () => api.addProjectDriveFiles(project.id, [{ drive_id: id, name: meta?.name ?? `${k.label} (${id.slice(0, 6)}…)`, mime_type: meta?.mimeType ?? k.mime, url: meta?.webViewLink ?? url, icon_url: meta?.iconLink ?? null }]),
      meta || !token ? '첨부했습니다.' : '첨부했습니다. (이름은 구글 로그인 후 자동으로 맞춰집니다)',
    )
    if (ok) setLink('')
  }
  const onUpload = async (list: FileList | null) => {
    if (!list?.length || !token) return
    setErr('')
    await run(async () => {
      const done: GFile[] = []
      for (const file of Array.from(list)) done.push(await uploadToDrive(token, file, folderId))
      await api.addProjectDriveFiles(project.id, done.map(g => ({ drive_id: g.id, name: g.name, mime_type: g.mimeType, url: g.webViewLink ?? `https://drive.google.com/file/d/${g.id}/view`, icon_url: g.iconLink ?? null })))
    }, folderId ? '프로젝트 드라이브 폴더에 올리고 첨부했습니다.' : '내 드라이브에 올리고 첨부했습니다. (프로젝트 드라이브 폴더를 정하면 그 폴더에 올라갑니다)')
  }
  const open = (f: ProjectDriveFile) => (f.mime_type === FOLDER_MIME ? (native ? openDocFolder(f.url) : openLink(f.url)) : openDoc(f.url))
  const openDocFolder = (url: string) => openDoc(url)

  return (
    <section className="col gap-6">
      <SectionHead
        title="구글 드라이브 자료"
        count={files.length}
        right={
          <span className="row gap-6">
            <Button kind="outline" size="sm" onClick={() => (native ? openDoc(folder.url) : openLink(folder.url))} title={folder.exact ? '프로젝트 드라이브 폴더' : '연번 · 이름으로 드라이브 검색 (프로젝트 수정에서 폴더 주소를 넣을 수 있음)'}>
              <FolderOpen size={13} /> {folder.exact ? '프로젝트 폴더' : '폴더 찾기'}
            </Button>
            {(
              <Button kind={folder.exact ? 'outline' : 'blue'} size="sm" onClick={makeFolder} disabled={busy} title="회사 구글 계정 드라이브 #연도 / #ARTERIOR_연도 · #WKLY_연도 아래 '연번_이름' 폴더를 만듦 (기존 드라이브 폴더는 건드리지 않음)">
                <FolderPlus size={13} /> {folder.exact ? '폴더 맞추기' : '드라이브 폴더 만들기'}
              </Button>
            )}
            {!native &&
              (token ? (
                <>
                  <Button kind="outline" size="sm" onClick={() => setPicking(true)}>
                    <Folder size={13} /> 드라이브에서 고르기
                  </Button>
                  <Button kind="outline" size="sm" onClick={() => upload.current?.click()} disabled={busy} title={folderId ? '프로젝트 드라이브 폴더에 올리고 첨부' : '내 드라이브에 올리고 첨부'}>
                    <Upload size={13} /> 파일 올리기
                  </Button>
                  <input ref={upload} type="file" multiple hidden onChange={e => (void onUpload(e.target.files), (e.target.value = ''))} />
                </>
              ) : (
                clientId && (
                  <Button kind="outline" size="sm" onClick={login}>
                    <LogIn size={13} /> 구글 로그인
                  </Button>
                )
              ))}
          </span>
        }
      />
      <div className="row gap-6">
        <Link2 size={14} className="t-gray" />
        <input className="input grow" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === 'Enter' && void attachLink()} placeholder="드라이브 · 구글 문서 링크 붙여 넣기 (드라이브에서 '링크 복사')" aria-label="드라이브 링크" />
        <Button size="sm" disabled={busy || !link.trim()} onClick={attachLink}>
          첨부
        </Button>
      </div>
      {native && <span className="t-cap">PC 프로그램: '프로젝트 폴더'를 누르면 드라이브 탭에서 바로 열립니다. 파일에서 '링크 복사' 뒤 위 칸에 붙여 넣으면 첨부됩니다.</span>}
      {files.length === 0 ? (
        <Empty>첨부한 드라이브 자료가 없습니다.</Empty>
      ) : (
        <div className="drive-list">
          {files.map(f => (
            <div key={f.id} className="drive-row as-div">
              {f.icon_url ? <img src={f.icon_url} alt="" width={16} height={16} /> : f.mime_type === FOLDER_MIME ? <Folder size={16} /> : <FileText size={16} />}
              <button type="button" className="link-btn drive-name grow" onClick={() => open(f)} title={/docs\.google\.com/.test(f.url) ? '편집 화면으로 열기' : '열기'}>
                {f.name}
              </button>
              <span className="badge outline">{typeLabel(f.mime_type)}</span>
              <span className="t-cap hide-narrow">{dateLabel(f.created_at.slice(0, 10))}</span>
              {!native && previewUrl(f.url) && (
                <button type="button" className="icon-btn sm" onClick={() => setPreview(preview === f.url ? null : f.url)} aria-label="인트라넷 안에서 미리 보기" title="인트라넷 안에서 미리 보기">
                  <Eye size={13} />
                </button>
              )}
              {/docs\.google\.com/.test(f.url) && (
                <button type="button" className="icon-btn sm" onClick={() => openDoc(f.url)} aria-label="편집" title="구글 문서 편집">
                  <Pencil size={13} />
                </button>
              )}
              {canEdit(f) && (
                <button type="button" className="icon-btn sm" disabled={busy} onClick={async () => (await ask(`'${f.name}'를 프로젝트에서 뺄까요? (드라이브 파일은 그대로)`)) && run(() => api.removeProjectDriveFile(f.id), '프로젝트에서 뺐습니다.')} aria-label="첨부 빼기" title="첨부 빼기 (드라이브 파일은 그대로)">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {preview && previewUrl(preview) && (
        <div className="col gap-4">
          <div className="row gap-6">
            <span className="t-cap grow">미리 보기 · 편집은 연필 버튼</span>
            <button type="button" className="icon-btn sm" onClick={() => setPreview(null)} aria-label="미리 보기 닫기">
              <X size={13} />
            </button>
          </div>
          <iframe className="drive-preview" src={previewUrl(preview)!} title="드라이브 미리 보기" />
        </div>
      )}
      <FolderFiles project={project} onOpen={openDoc} />
      {err && <span className="err">{err}</span>}
      {picking && token && (
        <DrivePicker
          token={token}
          startFolder={folderId}
          onClose={() => setPicking(false)}
          onPick={async picked => {
            if (await run(() => api.addProjectDriveFiles(project.id, picked.map(g => ({ drive_id: g.id, name: g.name, mime_type: g.mimeType, url: g.webViewLink ?? `https://drive.google.com/file/d/${g.id}/view`, icon_url: g.iconLink ?? null }))), `${picked.length}개를 첨부했습니다.`)) {
              setPicking(false)
              reload()
            }
          }}
        />
      )}
    </section>
  )
}

/**
 * 프로젝트 폴더 안 파일 — 서버가 5분마다 회사 계정 드라이브와 맞춘 목록 (구글 로그인 없이 누구나 봄 · 드라이브는 읽기만)
 *  - 폴더 경로 · 고친 사람 · 고친 날 · 이름 찾기
 */
function FolderFiles({ project, onOpen }: { project: Project; onOpen: (url: string) => void }) {
  const { api, version } = useApp()
  const { data: rows } = useAsync(() => api.listDriveIndex(project.id), [version, project.id], [] as DriveIndexFile[])
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const files = rows.filter(r => r.mime_type !== FOLDER_MIME)
  const words = q.trim().toLowerCase()
  const hit = words ? files.filter(r => `${r.path ?? ''} ${r.name} ${r.modified_by ?? ''}`.toLowerCase().includes(words)) : files
  const shown = all || words ? hit : hit.slice(0, 30)
  return (
    <div className="col gap-4">
      <div className="row gap-6">
        <span className="t-smallb grow">
          프로젝트 폴더 파일 {files.length}
          <span className="t-cap"> · 드라이브와 자동으로 맞춤 (5분마다)</span>
        </span>
        {files.length > 10 && <input className="input" style={{ maxWidth: 220 }} value={q} onChange={e => setQ(e.target.value)} placeholder="파일 · 폴더 · 고친 사람 찾기" aria-label="폴더 파일 찾기" />}
      </div>
      <div className="drive-list">
        {shown.map(f => (
          <div key={f.id} className="drive-row as-div">
            {f.icon_url ? <img src={f.icon_url} alt="" width={16} height={16} /> : <FileText size={16} />}
            <button type="button" className="link-btn drive-name grow" onClick={() => f.url && onOpen(f.url)} title={f.path ? `${f.path}/${f.name}` : f.name}>
              {f.path && <span className="t-cap">{f.path} / </span>}
              {f.name}
            </button>
            <span className="badge outline">{typeLabel(f.mime_type)}</span>
            <span className="t-cap hide-narrow">
              {f.modified_by ? `${f.modified_by} · ` : ''}
              {f.modified_at ? dateLabel(f.modified_at.slice(0, 10)) : ''}
            </span>
          </div>
        ))}
        {!shown.length && <Empty>찾는 파일이 없습니다.</Empty>}
      </div>
      {!all && !words && hit.length > 30 && (
        <button type="button" className="link-btn t-cap" onClick={() => setAll(true)}>
          {hit.length - 30}개 더 보기
        </button>
      )}
    </div>
  )
}

/** 드라이브에서 고르기 (웹 브라우저 · 구글 로그인): 내 드라이브 · 공유 문서함 · 프로젝트 폴더를 둘러보며 여러 개 선택 */
function DrivePicker({ token, startFolder, onClose, onPick }: { token: string; startFolder: string | null; onClose: () => void; onPick: (files: GFile[]) => void }) {
  type Loc = { id: string | null; name: string; shared?: boolean }
  const roots: Loc[] = [...(startFolder ? [{ id: startFolder, name: '프로젝트 폴더' }] : []), { id: 'root', name: '내 드라이브' }, { id: null, name: '공유 문서함', shared: true }]
  const [trail, setTrail] = useState<Loc[]>([roots[0]])
  const [items, setItems] = useState<GFile[]>([])
  const [sel, setSel] = useState<Map<string, GFile>>(new Map())
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const here = trail[trail.length - 1]
  useEffect(() => {
    let off = false
    setLoading(true)
    setErr('')
    const term = q.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const query = term ? `name contains '${term}' and trashed = false` : here.shared ? 'sharedWithMe and trashed = false' : `'${here.id}' in parents and trashed = false`
    const p = new URLSearchParams({ q: query, pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives', fields: `files(${FILE_FIELDS})` })
    if (!term && !here.shared) p.set('orderBy', 'folder,name')
    driveApi<{ files: GFile[] }>(token, `files?${p}`)
      .then(r => !off && setItems(r.files ?? []))
      .catch(e => !off && setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'))
      .finally(() => !off && setLoading(false))
    return () => {
      off = true
    }
  }, [token, here, q])
  const isFolder = (f: GFile) => f.mimeType === FOLDER_MIME || f.shortcutDetails?.targetMimeType === FOLDER_MIME
  const toggle = (f: GFile) =>
    setSel(m => {
      const n = new Map(m)
      if (n.has(f.id)) n.delete(f.id)
      else n.set(f.id, f)
      return n
    })
  return (
    <Modal
      title="드라이브에서 고르기"
      onClose={onClose}
      wide
      actions={
        <>
          <span className="t-cap grow">{sel.size}개 선택 · 폴더도 고를 수 있습니다</span>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={!sel.size} onClick={() => onPick([...sel.values()])}>
            첨부
          </Button>
        </>
      }
    >
      <div className="row wrap gap-6">
        {roots.map(r => (
          <button key={r.name} type="button" className={`drive-chip${trail[0].name === r.name && !q ? ' on' : ''}`} onClick={() => (setQ(''), setTrail([r]))}>
            {r.name}
          </button>
        ))}
        <input className="input grow" value={q} onChange={e => setQ(e.target.value)} placeholder="파일 이름으로 찾기" aria-label="파일 찾기" />
      </div>
      {!q && (
        <div className="drive-trail">
          {trail.map((t, i) => (
            <span key={i} className="row" style={{ gap: 2 }}>
              {i > 0 && <ChevronRight size={12} />}
              <button type="button" className="link-btn" disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))}>
                {t.name}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="drive-list picker">
        {loading && <span className="t-cap" style={{ padding: 10 }}>불러오는 중…</span>}
        {!loading && !items.length && <Empty>파일이 없습니다.</Empty>}
        {items.map(f => (
          <div key={f.id} className={`drive-row as-div${sel.has(f.id) ? ' on' : ''}`}>
            <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f)} aria-label={`${f.name} 선택`} />
            {f.iconLink ? <img src={f.iconLink} alt="" width={16} height={16} /> : <Folder size={16} />}
            {isFolder(f) ? (
              <button type="button" className="link-btn drive-name grow" onClick={() => (setQ(''), setTrail(t => [...t, { id: f.shortcutDetails?.targetId ?? f.id, name: f.name }]))}>
                {f.name} ›
              </button>
            ) : (
              <button type="button" className="link-btn drive-name grow" onClick={() => toggle(f)}>
                {f.name}
              </button>
            )}
            <span className="t-meta">{f.modifiedTime?.slice(0, 10) ?? ''}</span>
            <button type="button" className="icon-btn sm" onClick={() => f.webViewLink && openLink(f.webViewLink)} aria-label="열어 보기">
              <ExternalLink size={12} />
            </button>
          </div>
        ))}
      </div>
      {err && <span className="err">{err}</span>}
    </Modal>
  )
}
