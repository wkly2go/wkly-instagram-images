import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Clock, Copy, ExternalLink, FilePen, Pencil, RotateCw, X, FilePlus, Folder, HardDrive, LogIn, LogOut, Search, Star, Trash2, Users } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import type { DriveFolder, DriveStatus } from '../lib/api'
import { desktop } from '../lib/desktop'
import { copyFile, driveApi, DriveAuthError, editUrl, embedUrl, ensureProjectFolder, googleConnectCode, YEAR_RE, FOLDER_MIME as FOLDER, renameFile, trashFile, googleLogin, googleLogout, type GFile } from '../lib/gdrive'
import { useDriveToken } from '../components/DriveFiles'
import { DriveExplorer, useExplorerToken, type Loc as ExLoc } from '../components/DriveExplorer'
import { useRouter, withQuery } from '../lib/router'
import { relativeLabel } from '../lib/date'
import { Shell } from '../components/Shell'
import { claimNative, moveNative, openLink, releaseNative } from '../components/WebSearch'
import { Badge, Button, Empty, SectionHead } from '../components/ui'
import { ask, askText } from '../components/Ask'

/**
 * 구글 드라이브 탭 (대표 지시 2026-10-20)
 *  "구글드라이브 오른쪽 탭에 넣어줘, 인터넷이 아니고" · "드라이브는 기본이 로그인으로 하고, 내 드라이브를 클릭하면 아래에 나오게"
 *  - 처음 화면은 구글 로그인. 내 드라이브 · 공유 문서함 · 최근 · 중요 · 공유 드라이브 · 회사 공용 폴더를 누르면 이 화면 아래에 보여 줌
 *  - PC 프로그램: 프로그램의 웹 칸을 이 화면 아래 칸에 띄워 구글 드라이브 화면 그대로 (로그인 · 파일 작업 모두)
 *  - 웹 브라우저: 구글 로그인(관리자가 등록한 OAuth 클라이언트 ID) → 드라이브 파일 목록을 이 화면 아래에, 파일은 오른쪽 창에서 엶
 */
const DRIVE = 'https://drive.google.com/drive'
const LOGIN_URL = `https://accounts.google.com/ServiceLogin?service=wise&passive=1209600&continue=${encodeURIComponent(`${DRIVE}/my-drive`)}&hd=thewklyn.com`
type ViewKey = 'my' | 'shared' | 'recent' | 'starred' | 'drives'
const QUICK: { key: ViewKey; label: string; url: string; icon: typeof HardDrive }[] = [
  { key: 'my', label: '내 드라이브', url: `${DRIVE}/my-drive`, icon: HardDrive },
  { key: 'shared', label: '공유 문서함', url: `${DRIVE}/shared-with-me`, icon: Users },
  { key: 'recent', label: '최근 문서함', url: `${DRIVE}/recent`, icon: Clock },
  { key: 'starred', label: '중요 문서함', url: `${DRIVE}/starred`, icon: Star },
  { key: 'drives', label: '공유 드라이브', url: `${DRIVE}/shared-drives`, icon: Folder },
]
/** 새 구글 문서 · 시트 · 슬라이드 (만들어서 바로 편집) */
const NEW_DOCS = [
  { label: '새 문서', url: 'https://docs.google.com/document/create' },
  { label: '새 시트', url: 'https://docs.google.com/spreadsheets/create' },
  { label: '새 슬라이드', url: 'https://docs.google.com/presentation/create' },
] as const
/** 폴더 주소에서 폴더 id (…/folders/<id>) */
const folderId = (url: string) => url.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? null

export default function Drive() {
  const { api, me, version } = useApp()
  const { busy, run } = useAction()
  const { data: folders } = useAsync(() => api.getDriveFolders(), [version], [] as DriveFolder[])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', url: '' })
  const admin = me.role === 'admin'
  const native = !!desktop()?.searchOpen
  const save = (list: DriveFolder[], msg: string) => run(() => api.setDriveFolders(list), msg)

  return (
    <Shell active="drive">
      <div className="col gap-10">
        {native ? <NativeDriveSwitch folders={folders} /> : <WebDrive folders={folders} />}

        <SectionHead
          title="회사 공용 폴더"
          count={folders.length}
          right={
            admin && (
              <Button kind="outline" size="sm" onClick={() => setEditing(v => !v)}>
                {editing ? '편집 닫기' : '폴더 등록 · 편집'}
              </Button>
            )
          }
        />
        {admin && editing && (
          <div className="box col gap-6">
            <div className="row wrap gap-6">
              <input className="input" style={{ flex: '1 1 160px' }} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="폴더 이름 (예: ARTERIOR 현장)" maxLength={60} aria-label="폴더 이름" />
              <input className="input" style={{ flex: '3 1 280px' }} value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value.trim() })} placeholder="드라이브 폴더 주소 https://drive.google.com/drive/folders/…" aria-label="폴더 주소" />
              <Button
                size="sm"
                disabled={busy || !draft.name.trim() || !draft.url}
                onClick={async () => {
                  if (await save([...folders, { name: draft.name.trim(), url: draft.url }], '폴더를 등록했습니다.')) setDraft({ name: '', url: '' })
                }}
              >
                추가
              </Button>
            </div>
            {editing &&
              folders.map((f, i) => (
                <div key={f.url + i} className="row gap-6">
                  <Folder size={14} />
                  <span className="t-small grow">{f.name}</span>
                  <button type="button" className="icon-btn sm" disabled={busy} onClick={async () => (await ask(`'${f.name}' 폴더를 목록에서 뺄까요? (드라이브 파일은 그대로)`)) && save(folders.filter((_, j) => j !== i), '목록에서 뺐습니다.')} aria-label={`${f.name} 빼기`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            <span className="t-cap">드라이브에서 폴더를 열고 주소창의 주소를 그대로 붙여 넣으세요. 팀원에게 그 폴더 공유 권한이 있어야 열립니다.</span>
          </div>
        )}
        {admin && <ProjectFoldersSync />}
        {admin && !native && <ClientIdSetting />}
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* PC 프로그램: 탐색기(회사 계정 연결 시 기본) ↔ 구글 드라이브 화면          */
/* ------------------------------------------------------------------ */
function NativeDriveSwitch({ folders }: { folders: DriveFolder[] }) {
  const { query, navigate } = useRouter()
  const ex = useExplorerToken(null)
  const [mode, setMode] = useState<'explorer' | 'google' | null>(null)
  const shown = query.get('doc') ? 'google' : mode ?? (ex.token ? 'explorer' : ex.checked ? 'google' : null)
  if (!shown) return null
  return (
    <>
      <div className="chips">
        <button type="button" className={`chip ${shown === 'explorer' ? 'active' : ''}`} onClick={() => (navigate('/drive', { replace: true }), setMode('explorer'))} disabled={!ex.token} title={ex.token ? '윈도우 탐색기처럼 보기' : '관리자가 회사 구글 계정을 연결하면 쓸 수 있습니다'}>
          탐색기
        </button>
        <button type="button" className={`chip ${shown === 'google' ? 'active' : ''}`} onClick={() => setMode('google')}>
          구글 드라이브 화면
        </button>
      </div>
      {shown === 'explorer' && ex.token ? (
        <DriveExplorer
          token={ex.token}
          companyFolders={companyOf(folders)}
          onOpenDoc={u => (setMode('google'), navigate(withQuery('/drive', query, { doc: u })))}
          onAuthError={ex.refresh}
        />
      ) : (
        <NativeDrive folders={folders} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* PC 프로그램: 웹 칸을 아래 칸에 띄움                                    */
/* ------------------------------------------------------------------ */
function NativeDrive({ folders }: { folders: DriveFolder[] }) {
  const box = useRef<HTMLDivElement>(null)
  const { query } = useRouter()
  const doc = query.get('doc')
  // 처음은 구글 로그인 (이미 로그인돼 있으면 구글이 바로 내 드라이브로 넘김) · 문서 편집으로 들어오면 그 문서
  const [url, setUrl] = useState(() => (doc && /^https:\/\/(docs|drive)\.google\.com\//.test(doc) ? doc : LOGIN_URL))
  const [label, setLabel] = useState(doc ? '문서 편집' : '구글 로그인')
  useEffect(() => {
    if (doc && /^https:\/\/(docs|drive)\.google\.com\//.test(doc)) {
      setUrl(doc)
      setLabel('문서 편집')
    }
  }, [doc])
  const rect = () => {
    const r = box.current?.getBoundingClientRect()
    if (!r || document.querySelector('.scrim, .lock-screen, .notif-panel, .m-more-scrim, .img-viewer')) return { x: 0, y: 0, width: 0, height: 0 }
    const top = Math.max(r.top, 0)
    const bottom = Math.min(r.bottom, window.innerHeight)
    return { x: Math.round(r.left), y: Math.round(top), width: Math.round(r.width), height: Math.max(0, Math.round(bottom - top)) }
  }
  useEffect(() => {
    claimNative(url, rect())
  }, [url])
  useEffect(() => {
    const send = () => moveNative(rect())
    const ro = new ResizeObserver(send)
    if (box.current) ro.observe(box.current)
    const mo = new MutationObserver(send)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', send)
    window.addEventListener('scroll', send, true)
    const t = window.setInterval(send, 700)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', send)
      window.removeEventListener('scroll', send, true)
      window.clearInterval(t)
      releaseNative()
    }
  }, [])
  const go = (u: string, l: string) => {
    setLabel(l)
    setUrl(u === url ? `${u}${u.includes('?') ? '&' : '?'}r=${Date.now()}` : u)
  }
  return (
    <>
      <DriveHead
        active={label}
        folders={folders}
        onLogin={() => go(LOGIN_URL, '구글 로그인')}
        onQuick={qk => go(qk.url, qk.label)}
        onFolder={f => go(f.url, f.name)}
        onSearch={s => go(`${DRIVE}/search?q=${encodeURIComponent(s)}`, `검색: ${s}`)}
        onNew={n => go(n.url, n.label)}
      />
      <div className="drive-native" ref={box} aria-label={`구글 드라이브 · ${label}`} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 웹 브라우저: 구글 로그인 → 드라이브 API 로 목록                          */
/* ------------------------------------------------------------------ */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
type Loc = { kind: ViewKey | 'folder' | 'search'; id?: string; name: string; driveId?: string }

/** 웹 브라우저: 문서 편집 칸 + 드라이브 목록 (대표 지시 2026-10-20 "구글 드라이브 앱내에서 편집 가능하도록") */
function WebDrive({ folders }: { folders: DriveFolder[] }) {
  const { query, navigate } = useRouter()
  const doc = query.get('doc')
  const src = doc && /^https:\/\/(docs|drive)\.google\.com\//.test(doc) ? embedUrl(doc) : null
  const setDoc = (u: string | null) => navigate(withQuery('/drive', query, { doc: u }))
  const openDoc = (u: string) => (embedUrl(u) ? setDoc(u) : openLink(u))
  return (
    <>
      {src && <WebDocEditor key={src} src={src} url={doc!} onClose={() => setDoc(null)} />}
      <WebDriveList folders={folders} onOpenDoc={openDoc} />
    </>
  )
}

/** 구글 편집기를 인트라넷 화면 안에 (이 브라우저에 구글 로그인이 돼 있어야 편집됨) */
function WebDocEditor({ src, url, onClose }: { src: string; url: string; onClose: () => void }) {
  const [n, setN] = useState(0)
  const external = src.includes('/create') ? src : editUrl(url)
  return (
    <div className="drive-editor">
      <div className="drive-editor-bar">
        <b className="t-small">문서 편집</b>
        <span className="t-cap grow">편집 화면이 비어 있거나 로그인 화면이 막히면 '구글 로그인' 후 '다시 불러오기'를 누르세요.</span>
        <Button kind="outline" size="sm" onClick={() => window.open(LOGIN_URL, '_blank', 'noopener')}>
          <LogIn size={13} /> 구글 로그인
        </Button>
        <button type="button" className="icon-btn sm" onClick={() => setN(v => v + 1)} aria-label="다시 불러오기" title="다시 불러오기">
          <RotateCw size={14} />
        </button>
        <button type="button" className="icon-btn sm" onClick={() => window.open(external, '_blank', 'noopener')} aria-label="새 창에서 열기" title="새 창에서 열기">
          <ExternalLink size={14} />
        </button>
        <button type="button" className="icon-btn sm" onClick={onClose} aria-label="편집 닫기" title="편집 닫기">
          <X size={14} />
        </button>
      </div>
      <iframe key={n} className="drive-editor-frame" src={src} title="구글 문서 편집" allow="clipboard-read; clipboard-write; fullscreen" />
    </div>
  )
}

function WebDriveList({ folders, onOpenDoc }: { folders: DriveFolder[]; onOpenDoc: (url: string) => void }) {
  const { api, version } = useApp()
  const { data: clientId, loading: idLoading } = useAsync(() => api.getGoogleClientId(), [version], null as string | null)
  const browserToken = useDriveToken()
  const ex = useExplorerToken(browserToken)
  const [start, setStart] = useState<{ loc: ExLoc | null; n: number }>({ loc: null, n: 0 })
  if (ex.token)
    return (
      <>
        <DriveHead
          active={start.loc?.name ?? ''}
          folders={folders}
          onLogout={browserToken ? googleLogout : undefined}
          onQuick={qk => setStart(s => ({ loc: QUICK_LOC[qk.key] ?? null, n: s.n + 1 }))}
          onFolder={f => {
            const id = folderId(f.url)
            if (id) setStart(s => ({ loc: { kind: 'folder', id, name: f.name }, n: s.n + 1 }))
            else openLink(f.url)
          }}
          onSearch={q => setStart(s => ({ loc: { kind: 'search', name: q }, n: s.n + 1 }))}
          onNew={n => onOpenDoc(n.url)}
        />
        {ex.server && <span className="t-cap">회사 구글 계정으로 연결된 드라이브입니다 (개인 로그인 필요 없음).</span>}
        <DriveExplorer key={start.n} token={ex.token} start={start.loc} companyFolders={companyOf(folders)} onOpenDoc={onOpenDoc} onAuthError={ex.refresh} />
      </>
    )
  return <WebDriveListOld folders={folders} onOpenDoc={onOpenDoc} clientId={clientId} idLoading={idLoading || !ex.checked} />
}

const QUICK_LOC: Record<string, ExLoc> = {
  my: { kind: 'my', id: 'root', name: '내 드라이브' },
  shared: { kind: 'shared', name: '공유 문서함' },
  recent: { kind: 'recent', name: '최근 문서' },
  starred: { kind: 'starred', name: '중요 문서함' },
  drives: { kind: 'drives', name: '공유 드라이브' },
}
const companyOf = (folders: DriveFolder[]) => folders.map(f => ({ name: f.name, id: folderId(f.url) ?? '' })).filter(f => f.id)

/** 구글 로그인 전 (로그인 안내 · 예전 목록) */
function WebDriveListOld({ folders, onOpenDoc, clientId, idLoading }: { folders: DriveFolder[]; onOpenDoc: (url: string) => void; clientId: string | null; idLoading: boolean }) {
  const { me } = useApp()
  const token = useDriveToken()
  const [trail, setTrail] = useState<Loc[]>([])
  const [files, setFiles] = useState<GFile[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const here = trail[trail.length - 1]

  const login = async () => {
    setErr('')
    try {
      await googleLogin(clientId!, me.email)
      setTrail(t => (t.length ? t : [{ kind: 'my', name: '내 드라이브' }]))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '구글 로그인을 불러오지 못했습니다.')
    }
  }
  const logout = () => {
    googleLogout()
    setTrail([])
    setFiles([])
  }

  const load = useCallback(
    async (loc: Loc) => {
      if (!token) return
      setLoading(true)
      setErr('')
      try {
        const p = new URLSearchParams({ pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', fields: 'files(id,name,mimeType,iconLink,webViewLink,modifiedTime,owners(displayName),shortcutDetails),nextPageToken' })
        let path = 'files'
        if (loc.kind === 'drives') {
          path = 'drives'
          p.delete('supportsAllDrives')
          p.delete('includeItemsFromAllDrives')
          p.set('fields', 'drives(id,name)')
          p.set('pageSize', '100')
        } else if (loc.kind === 'my') {
          p.set('q', "'root' in parents and trashed = false")
          p.set('orderBy', 'folder,name')
        } else if (loc.kind === 'shared') {
          p.set('q', 'sharedWithMe and trashed = false')
          p.set('orderBy', 'modifiedTime desc')
        } else if (loc.kind === 'recent') {
          p.set('q', `trashed = false and mimeType != '${FOLDER}'`)
          p.set('orderBy', 'viewedByMeTime desc')
          p.set('pageSize', '60')
        } else if (loc.kind === 'starred') {
          p.set('q', 'starred and trashed = false')
          p.set('orderBy', 'folder,name')
        } else if (loc.kind === 'search') {
          p.set('q', `name contains '${esc(loc.name)}' and trashed = false`)
          p.set('corpora', 'allDrives')
        } else {
          p.set('q', `'${esc(loc.id!)}' in parents and trashed = false`)
          p.set('orderBy', 'folder,name')
          if (loc.driveId) {
            p.set('corpora', 'drive')
            p.set('driveId', loc.driveId)
          } else p.set('corpora', 'allDrives')
        }
        const body = await driveApi<{ files?: GFile[]; drives?: { id: string; name: string }[] }>(token, `${path}?${p}`)
        setFiles(loc.kind === 'drives' ? (body.drives ?? []).map((d: { id: string; name: string }) => ({ id: d.id, name: d.name, mimeType: 'drive' })) : body.files ?? [])
      } catch (e) {
        if (e instanceof DriveAuthError) setTrail([])
        setErr(e instanceof Error ? e.message : '드라이브를 불러오지 못했습니다.')
      } finally {
        setLoading(false)
      }
    },
    [token],
  )
  useEffect(() => {
    if (here && token) void load(here)
  }, [here, token, load])

  const pick = (loc: Loc) => setTrail([loc])
  // 기존 드라이브 자료는 절대 수정 · 삭제 금지 (대표 지시 2026-10-21) → 이름 바꾸기 · 삭제는 인트라넷 전용 '#연도' 폴더 안에서만
  const inIntranetTree = trail.some(t => t.kind === 'folder' && YEAR_RE.test(t.name))
  // 수정 · 복사 · 삭제 (대표 지시 2026-10-21 "드라이브에 있는 자료 수정 · 복사 · 삭제 가능하도록")
  const { toast } = useApp()
  const [acting, setActing] = useState(false)
  const act = async (f: GFile, kind: 'rename' | 'copy' | 'trash') => {
    if (!token) return
    if (kind !== 'copy' && !inIntranetTree) return toast('기존 드라이브 자료는 고치거나 지울 수 없습니다. (인트라넷 #연도 폴더 안에서만)')
    let name = f.name
    if (kind === 'rename') {
      const v = (await askText('새 이름', f.name))?.trim()
      if (!v || v === f.name) return
      name = v
    } else if (kind === 'copy') {
      const v = (await askText('사본 이름', `${f.name} 사본`))?.trim()
      if (!v) return
      name = v
    } else if (!(await ask(`'${f.name}'을(를) 삭제할까요?\n구글 드라이브 휴지통으로 옮겨지며 30일 안에 되살릴 수 있습니다.`))) return
    setActing(true)
    setErr('')
    try {
      if (kind === 'rename') await renameFile(token, f.id, name)
      else if (kind === 'copy') await copyFile(token, f.id, name)
      else await trashFile(token, f.id)
      toast(kind === 'rename' ? '이름을 바꿨습니다.' : kind === 'copy' ? '사본을 만들었습니다.' : '휴지통으로 옮겼습니다.')
      if (here) await load(here)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '드라이브 작업을 하지 못했습니다.')
    } finally {
      setActing(false)
    }
  }
  const openItem = (f: GFile) => {
    if (f.mimeType === 'drive') return setTrail(t => [...t, { kind: 'folder', id: f.id, name: f.name, driveId: f.id }])
    const isFolder = f.mimeType === FOLDER || f.shortcutDetails?.targetMimeType === FOLDER
    if (isFolder) return setTrail(t => [...t, { kind: 'folder', id: f.shortcutDetails?.targetId ?? f.id, name: f.name, driveId: t[t.length - 1]?.driveId }])
    if (f.webViewLink) onOpenDoc(editUrl(f.webViewLink))
  }

  if (idLoading) return null
  if (!clientId) {
    return (
      <>
        <DriveHead active="" folders={folders} onQuick={qk => openLink(qk.url)} onFolder={f => openLink(f.url)} onSearch={s => openLink(`${DRIVE}/search?q=${encodeURIComponent(s)}`)} onNew={n => onOpenDoc(n.url)} />
        <div className="drive-login">
          <LogIn size={22} />
          <b>웹 브라우저에서 드라이브를 이 화면에 보려면 구글 로그인 연결이 필요합니다.</b>
          <span className="t-small">관리자가 아래 '구글 로그인 연결'에 클라이언트 ID를 등록하면 됩니다. 그 전에는 위 버튼이 오른쪽 창으로 엽니다. PC 프로그램에서는 바로 이 화면 안에 나옵니다.</span>
        </div>
      </>
    )
  }
  return (
    <>
      <DriveHead
        active={here?.name ?? (token ? '' : '구글 로그인')}
        folders={folders}
        disabled={!token}
        onLogin={token ? undefined : login}
        onLogout={token ? logout : undefined}
        onQuick={qk => pick({ kind: qk.key, name: qk.label })}
        onFolder={f => {
          const id = folderId(f.url)
          if (id) pick({ kind: 'folder', id, name: f.name })
          else openLink(f.url)
        }}
        onSearch={s => pick({ kind: 'search', name: s })}
        onNew={n => onOpenDoc(n.url)}
      />
      {!token ? (
        <span className="t-cap drive-hint">위 제목 옆 '구글 로그인'을 누르면 내 드라이브 · 공유 문서함 · 회사 폴더가 이 아래에 나옵니다. (기존 자료는 열기 · 복사만, 이름 바꾸기 · 삭제는 인트라넷 #연도 폴더 안에서만)</span>
      ) : (
        <div className="drive-list">
          <div className="drive-trail">
            {trail.map((t, i) => (
              <span key={i} className="row" style={{ gap: 2 }}>
                {i > 0 && <ChevronRight size={12} />}
                <button type="button" className="link-btn" disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))}>
                  {t.kind === 'search' ? `검색: ${t.name}` : t.name}
                </button>
              </span>
            ))}
            <span className="grow" />
            {loading && <span className="t-cap">불러오는 중…</span>}
          </div>
          {!loading && !files.length && <Empty>{here ? '파일이 없습니다.' : '위에서 내 드라이브를 눌러 보세요.'}</Empty>}
          {files.map(f => (
            <div key={f.id} className="drive-row-wrap">
              <button type="button" className="drive-row" onClick={() => openItem(f)}>
                {f.mimeType === 'drive' ? <Folder size={16} /> : f.iconLink ? <img src={f.iconLink} alt="" width={16} height={16} /> : <Folder size={16} />}
                <span className="grow drive-name">{f.name}</span>
                <span className="t-cap hide-narrow">{f.owners?.[0]?.displayName ?? ''}</span>
                <span className="t-meta">{f.modifiedTime ? f.modifiedTime.slice(0, 10) : ''}</span>
              </button>
              {f.mimeType !== 'drive' && (
                <span className="drive-acts">
                  {f.webViewLink && f.mimeType !== FOLDER && (
                    <button type="button" className="icon-btn sm" onClick={() => onOpenDoc(editUrl(f.webViewLink!))} aria-label="편집" title="열어서 편집">
                      <FilePen size={13} />
                    </button>
                  )}
                  {inIntranetTree && (
                    <button type="button" className="icon-btn sm" disabled={acting} onClick={() => act(f, 'rename')} aria-label="이름 바꾸기" title="이름 바꾸기">
                      <Pencil size={13} />
                    </button>
                  )}
                  {f.mimeType !== FOLDER && (
                    <button type="button" className="icon-btn sm" disabled={acting} onClick={() => act(f, 'copy')} aria-label="복사" title="사본 만들기 (같은 폴더)">
                      <Copy size={13} />
                    </button>
                  )}
                  {inIntranetTree && (
                    <button type="button" className="icon-btn sm del" disabled={acting} onClick={() => act(f, 'trash')} aria-label="삭제" title="삭제 (구글 드라이브 휴지통으로 · 30일 안에 되살리기 가능)">
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {err && <span className="err">{err}</span>}
    </>
  )
}

/** 위쪽: 로그인 · 바로가기 · 회사 폴더 · 드라이브 검색 */
function DriveHead({
  active,
  folders,
  disabled,
  onLogin,
  onLogout,
  onQuick,
  onFolder,
  onSearch,
  onNew,
}: {
  active: string
  folders: DriveFolder[]
  disabled?: boolean
  onLogin?: () => void
  onLogout?: () => void
  onQuick: (q: (typeof QUICK)[number]) => void
  onFolder: (f: DriveFolder) => void
  onSearch: (s: string) => void
  onNew?: (n: (typeof NEW_DOCS)[number]) => void
}) {
  const [q, setQ] = useState('')
  return (
    <div className="col gap-6">
      <div className="row wrap gap-6">
        <span className="t-title">구글 드라이브</span>
        {/* 구글 로그인은 제목 옆에 작게 */}
        {onLogin && (
          <button type="button" className={`drive-login-sm${active === '구글 로그인' ? ' on' : ''}`} onClick={onLogin} title="회사 구글 계정으로 로그인">
            <LogIn size={12} /> 구글 로그인
          </button>
        )}
        {onLogout && (
          <button type="button" className="drive-login-sm" onClick={onLogout} title="이 화면의 구글 로그인 해제">
            <LogOut size={12} /> 로그아웃
          </button>
        )}
        <span className="grow" />
        <form
          className="drive-search"
          role="search"
          onSubmit={e => {
            e.preventDefault()
            if (q.trim() && !disabled) onSearch(q.trim())
          }}
        >
          <Search size={14} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="드라이브에서 파일 찾기 (Enter)" aria-label="드라이브 검색" disabled={disabled} />
        </form>
      </div>
      <div className="drive-quick">
        {QUICK.map(qk => (
          <button key={qk.key} type="button" className={`drive-chip${active === qk.label ? ' on' : ''}`} disabled={disabled} onClick={() => onQuick(qk)}>
            <qk.icon size={14} aria-hidden="true" /> {qk.label}
          </button>
        ))}
        {NEW_DOCS.map(n => (
          <button key={n.label} type="button" className={`drive-chip new${active === n.label ? ' on' : ''}`} onClick={() => (onNew ? onNew(n) : openLink(n.url))} title={`${n.label} 만들어 바로 편집`}>
            <FilePlus size={14} aria-hidden="true" /> {n.label}
          </button>
        ))}
        {folders.map((f, i) => (
          <button key={f.url + i} type="button" className={`drive-chip folder${active === f.name ? ' on' : ''}`} disabled={disabled} onClick={() => onFolder(f)} title="회사 공용 폴더">
            <Folder size={14} aria-hidden="true" /> {f.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 관리자: 웹 브라우저 드라이브 목록용 구글 OAuth 클라이언트 ID */
/**
 * 관리자: 회사 구글 계정 연결 + 프로젝트 폴더 정리
 *  - 연결하면 서버(gdrive 함수)가 회사 계정으로 폴더를 만듦 → PC 프로그램 · 웹 어디서 프로젝트를 만들어도 자동
 *  - #2026 / #ARTERIOR_2026 · #WKLY_2026 / 연번_이름 (기존 드라이브 자료는 건드리지 않음)
 */
function ProjectFoldersSync() {
  const { api, version, toast, bump } = useApp()
  const { busy, run } = useAction()
  const token = useDriveToken()
  const native = !!desktop()?.searchOpen
  const { data: st, reload } = useAsync(() => api.driveStatus(), [version], null as DriveStatus | null)
  const [state, setState] = useState<{ done: number; total: number; made: number; fixed: number; fail: string[] } | null>(null)
  const running = !!state && state.done < state.total
  const connect = async () => {
    const id = await api.getGoogleClientId()
    if (!id) return toast("먼저 아래 '구글 로그인 연결'에 OAuth 클라이언트 ID를 등록해 주세요.")
    try {
      const code = await googleConnectCode(id)
      await run(async () => {
        const r = await api.driveConnect(code)
        toast(`회사 구글 계정을 연결했습니다${r.account ? ` (${r.account})` : ''}.`)
      })
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : '구글 연결 실패')
    }
  }
  const runAll = async () => {
    if (st?.connected) {
      setState({ done: 0, total: 1, made: 0, fixed: 0, fail: [] })
      try {
        const r = await api.driveEnsureAll()
        setState({ done: 1, total: 1, ...r })
        bump()
      } catch (e) {
        setState(null)
        toast(e instanceof Error ? e.message : '정리하지 못했습니다.')
      }
      return
    }
    if (!token) return toast("회사 구글 계정을 연결하거나, 위쪽 '구글 로그인'으로 회사 계정에 로그인해 주세요.")
    const list = (await api.listProjects()).sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
    let made = 0
    let fixed = 0
    const fail: string[] = []
    setState({ done: 0, total: list.length, made, fixed, fail })
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      try {
        const r = await ensureProjectFolder(token, p)
        if (r.url !== p.drive_url) await api.saveProject({ id: p.id, drive_url: r.url })
        if (r.action === 'created' || r.action === 'linked') made++
        else if (r.action !== 'ok') fixed++
      } catch (e) {
        fail.push(`${p.code ?? ''} ${p.name}: ${e instanceof Error ? e.message : '오류'}`)
      }
      setState({ done: i + 1, total: list.length, made, fixed, fail: [...fail] })
    }
    bump()
  }
  return (
    <div className="web-setting col gap-4">
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="t-cap grow">
          프로젝트 폴더 정리 (관리자) · 회사 구글 계정 드라이브에 새로 만든 <b>#2026</b> 안의 <b>#ARTERIOR_2026</b> / <b>#WKLY_2026</b>(더위클리 · 내부 리서치) 아래 '연번_이름' 폴더를 만들어 연결합니다. 이미 폴더가 연결된
          프로젝트와 기존 드라이브 자료는 건드리지 않습니다. 연도가 바뀌면 #2027 을 새로 만듭니다.
        </span>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {st?.connected ? (
          <Badge tone="green">회사 계정 연결됨{st.account ? ` · ${st.account}` : ''}</Badge>
        ) : (
          <Badge tone="outline">회사 계정 연결 안 됨</Badge>
        )}
        {!native && (
          <Button size="sm" kind={st?.connected ? 'ghost' : 'blue'} disabled={busy} onClick={connect} title="회사 구글 계정으로 로그인 · 허락 → 서버가 그 계정으로 폴더를 만듦">
            {st?.connected ? '다시 연결' : '회사 구글 계정 연결'}
          </Button>
        )}
        <Button size="sm" kind="outline" disabled={running || (!st?.connected && !token)} onClick={runAll}>
          {running ? (state!.total > 1 ? `맞추는 중 ${state!.done}/${state!.total}` : '맞추는 중…') : '프로젝트 폴더 모두 맞추기'}
        </Button>
        {st && !st.connected && (
          <span className="t-cap">
            준비: ① 아래 '구글 로그인 연결'에 클라이언트 ID {st.clientId ? '✓' : '등록'} ② Supabase › Vault 에 GOOGLE_CLIENT_SECRET {st.secret ? '✓' : '등록'} ③ '회사 구글 계정 연결'
          </span>
        )}
      </div>
      {state && !running && (
        <span className="t-cap">
          끝 · 새로 만들거나 연결 {state.made} · 이름 · 위치 맞춤 {state.fixed}
          {state.fail.length ? ` · 실패 ${state.fail.length}: ${state.fail.slice(0, 3).join(' / ')}` : ''}
        </span>
      )}
      {st?.connected && (
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="t-cap grow">
            파일 목록 자동 동기화 · 5분마다 프로젝트 폴더 안 파일을 읽어 프로젝트 화면 · Ctrl+K 검색에 보여 줍니다 (드라이브는 읽기만).
            {st.syncedAt ? ` 마지막 ${relativeLabel(st.syncedAt)}` : ' 아직 한 번도 돌지 않았습니다.'}
          </span>
          <Button size="sm" kind="outline" disabled={busy} onClick={() => run(async () => {
            const r = await api.driveSync(!st.fullAt)
            toast(r.mode === 'full' ? `전체 훑기 끝 · 파일 ${r.files}개` : `바뀐 것 ${r.changed}건 반영`)
            reload()
          })}>
            지금 동기화
          </Button>
          <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(async () => {
            const r = await api.driveSync(true)
            toast(`전체 다시 훑기 끝 · 파일 ${r.files}개`)
            reload()
          })} title="목록이 이상할 때: 모든 프로젝트 폴더를 처음부터 다시 읽음">
            전체 다시 읽기
          </Button>
        </div>
      )}
    </div>
  )
}

function ClientIdSetting() {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const { data: cur } = useAsync(() => api.getGoogleClientId(), [version], null as string | null)
  const [v, setV] = useState('')
  useEffect(() => setV(cur ?? ''), [cur])
  return (
    <details className="web-setting">
      <summary className="t-cap">구글 로그인 연결 (관리자 · 웹 브라우저용){cur ? ' · 연결됨' : ''}</summary>
      <ol className="t-cap">
        <li>
          <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer" data-external>
            Google Cloud 콘솔
          </a>
          에 info@thewklyn.com 으로 로그인 → 새 프로젝트 → 'Google Drive API' 사용 설정
        </li>
        <li>API 및 서비스 › OAuth 동의 화면: 사용자 유형 <b>내부</b>(회사 계정만) · 앱 이름 'WKLY 인트라넷'</li>
        <li>
          사용자 인증 정보 › 만들기 › OAuth 클라이언트 ID › 웹 애플리케이션 · 승인된 자바스크립트 원본에 <code>{window.location.origin}</code> 추가
        </li>
        <li>만들어진 '클라이언트 ID'(…apps.googleusercontent.com, 공개 값)를 아래에 붙여 넣고 저장 · 비밀번호(클라이언트 보안 비밀)는 넣지 않습니다</li>
      </ol>
      <div className="row">
        <input className="input grow" value={v} onChange={e => setV(e.target.value.trim())} placeholder="1234567890-abc….apps.googleusercontent.com" aria-label="구글 클라이언트 ID" />
        <button type="button" className="btn btn-outline btn-sm" disabled={busy || v === (cur ?? '')} onClick={() => run(() => api.setGoogleClientId(v || null), v ? '저장했습니다. 드라이브 탭에서 구글 로그인을 눌러 보세요.' : '해제했습니다.')}>
          저장
        </button>
      </div>
      <a className="t-cap" href="#" onClick={e => (e.preventDefault(), openLink('https://console.cloud.google.com/apis/credentials'))}>
        사용자 인증 정보 바로가기 <ExternalLink size={11} />
      </a>
    </details>
  )
}
