import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Folder, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import type { DriveFolder, DriveStatus } from '../lib/api'
import { desktop } from '../lib/desktop'
import { ensureProjectFolder, googleConnectCode } from '../lib/gdrive'
import { useDriveToken } from '../components/DriveFiles'
import { DriveExplorer, indexSource, useExplorerToken, type IndexData } from '../components/DriveExplorer'
import { DIVISIONS, projectBrand, projectDriveUrl, type Project } from '../lib/types'
import { relativeLabel } from '../lib/date'
import { Shell } from '../components/Shell'
import { openLink } from '../components/WebSearch'
import { Badge, Button, SectionHead } from '../components/ui'
import { ask } from '../components/Ask'
import { FieldUploadBox } from '../components/FieldUpload'

/**
 * 구글 드라이브 탭 (대표 지시 2026-10-20)
 *  "구글드라이브 오른쪽 탭에 넣어줘, 인터넷이 아니고" · "드라이브는 기본이 로그인으로 하고, 내 드라이브를 클릭하면 아래에 나오게"
 *  - 처음 화면은 구글 로그인. 내 드라이브 · 공유 문서함 · 최근 · 중요 · 공유 드라이브 · 회사 공용 폴더를 누르면 이 화면 아래에 보여 줌
 *  - PC 프로그램: 프로그램의 웹 칸을 이 화면 아래 칸에 띄워 구글 드라이브 화면 그대로 (로그인 · 파일 작업 모두)
 *  - 웹 브라우저: 구글 로그인(관리자가 등록한 OAuth 클라이언트 ID) → 드라이브 파일 목록을 이 화면 아래에, 파일은 오른쪽 창에서 엶
 */
/** 폴더 주소에서 폴더 id (…/folders/<id>) */
const folderId = (url: string) => url.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? null

export default function Drive() {
  const { api, me, version } = useApp()
  const { busy, run } = useAction()
  const { data: folders } = useAsync(() => api.getDriveFolders(), [version], [] as DriveFolder[])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', url: '' })
  const admin = me.role === 'admin'
  const save = (list: DriveFolder[], msg: string) => run(() => api.setDriveFolders(list), msg)

  return (
    <Shell active="drive">
      <div className="col gap-10">
        <FieldUploadBox />
        <ExplorerOnly folders={folders} />

        {admin && (
          <details className="drive-settings">
            <summary>드라이브 설정 (관리자) · 회사 공용 폴더 · 프로젝트 폴더 · 구글 연결</summary>
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
        <ClientIdSetting />
        <ProjectFoldersSync />
        <GmailSetting />
          </details>
        )}
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* 드라이브 = 탐색기만 (대표 지시 2026-10-31 "드라이브는 탐색기만 남겨 · 구글 드라이브 화면은 필요 없어") */
/*  - 회사 구글 계정이 연결돼 있으면 바로 탐색기(만들기 · 이름 바꾸기 · 올리기)              */
/*  - 연결 전이거나 막히면 서버가 모은 목록으로 같은 탐색기(보기 전용)                       */
/*  - 문서를 누르면 오른쪽 칸(PC 프로그램) · 새 창(웹)에서 엶                                 */
/* ------------------------------------------------------------------ */
function ExplorerOnly({ folders }: { folders: DriveFolder[] }) {
  const browserToken = useDriveToken()
  const ex = useExplorerToken(browserToken)
  const data = useIndexData(folders)
  const idx = useMemo(() => (data ? indexSource(data) : null), [data])
  if (ex.token) return <DriveExplorer token={ex.token} companyFolders={companyOf(folders)} onOpenDoc={openLink} onAuthError={ex.refresh} />
  if (!ex.checked || !idx) return <div className="explorer ex-loading t-cap">드라이브 목록을 불러오는 중…</div>
  return (
    <DriveExplorer
      token={null}
      source={idx}
      companyFolders={[]}
      onOpenDoc={openLink}
      banner={<div className="ex-banner"><b>보기 전용</b> · 관리자가 아래 '드라이브 설정'에서 회사 구글 계정을 연결하면 이 화면에서 바로 만들기 · 이름 바꾸기 · 올리기가 됩니다.</div>}
    />
  )
}

/** 구글 연결 전에도 탐색기를 보여 줄 목록: 프로젝트 · 서버가 모은 드라이브 목록 · 회사 폴더 */
function useIndexData(folders: DriveFolder[]): IndexData | null {
  const { api, version } = useApp()
  const { data } = useAsync(
    async () => {
      const [projects, files] = await Promise.all([api.listProjects().catch(() => [] as Project[]), api.listDriveIndex().catch(() => [])])
      return { projects, files }
    },
    [version],
    null as { projects: Project[]; files: Awaited<ReturnType<typeof api.listDriveIndex>> } | null,
  )
  if (!data) return null
  return {
    year: String(new Date().getFullYear()),
    files: data.files,
    company: folders,
    projects: data.projects.map(p => {
      const k = projectBrand(p)
      const d = projectDriveUrl(p)
      return { id: p.id, code: p.code ?? null, name: p.name, division: k, divisionName: DIVISIONS[k]?.label ?? k, url: d.exact ? d.url : null, status: p.status }
    }),
  }
}

const companyOf = (folders: DriveFolder[]) => folders.map(f => ({ name: f.name, id: folderId(f.url) ?? '' })).filter(f => f.id)

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
        {native && !st?.connected && (
          <a className="t-cap" href="https://wkly-erp.pages.dev/drive" target="_blank" rel="noreferrer" data-external>
            처음 연결은 웹 브라우저에서: wkly-erp.pages.dev/drive ›
          </a>
        )}
        {st && !st.connected && (
          <span className="t-cap">
            준비: ① 바로 아래 '구글 로그인 연결'을 펼쳐 클라이언트 ID {st.clientId ? '✓' : '등록'} ② <a href="https://supabase.com/dashboard/project/hophgcpszenrvchvbkav/integrations/vault/secrets" target="_blank" rel="noreferrer" data-external>Supabase › Vault</a> 에 GOOGLE_CLIENT_SECRET {st.secret ? '✓' : '등록'} ③ '회사 구글 계정 연결'
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
    <details className="web-setting client-id-setting" open={!cur}>
      <summary className="t-bodyb">① 구글 로그인 연결 · 클라이언트 ID 입력{cur ? ' · 저장됨 ✓' : ' (여기에 붙여 넣기)'}</summary>
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

/** 관리자: 회사 지메일 읽기 연동 (2026-10-31 "지메일 연동해") — 드라이브와 같은 회사 계정 · 메일은 읽기만 */
function GmailSetting() {
  const { api, version, toast } = useApp()
  const { busy, run } = useAction()
  const [n, setN] = useState(0)
  const { data: st } = useAsync(() => api.gmailStatus(), [version, n], null as Awaited<ReturnType<typeof api.gmailStatus>>)
  return (
    <div className="web-setting col gap-4">
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="t-bodyb">지메일 연동</span>
        {st?.connected ? <Badge tone="green">읽기 연결됨</Badge> : <Badge tone="outline">지메일 권한 없음</Badge>}
        <span className="t-cap grow">
          회사 메일함(info@) 메일을 10분마다 읽어 연번 · 프로젝트 이름 · 거래처 메일 주소로 프로젝트에 연결합니다. 제목 · 보낸 사람 · 미리보기 · 첨부 이름만 저장하고, 메일을 보내거나 지우지 않습니다.
          {st?.synced_at ? ` 마지막 ${relativeLabel(st.synced_at)} · 새 메일 ${st.saved ?? 0}통` : ''}
        </span>
        <Button
          size="sm"
          kind="outline"
          disabled={busy || !st?.connected}
          onClick={() =>
            run(async () => {
              const r = await api.gmailSync(90)
              toast(`최근 90일 메일 ${r.fetched}통 확인 · 새로 ${r.saved}통 저장`)
              setN(v => v + 1)
            })
          }
        >
          지금 불러오기 (90일)
        </Button>
      </div>
      {st && !st.connected && <span className="t-cap">위 '회사 구글 계정 연결'을 웹 브라우저에서 한 번 더 눌러(다시 연결) 지메일 읽기 권한까지 허용하면 켜집니다.</span>}
    </div>
  )
}
