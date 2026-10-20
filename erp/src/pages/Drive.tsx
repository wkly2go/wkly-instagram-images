import { useState } from 'react'
import { ExternalLink, Folder, HardDrive, Search, Star, Clock, Users, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import type { DriveFolder } from '../lib/api'
import { Shell } from '../components/Shell'
import { openLink } from '../components/WebSearch'
import { Button, Empty, SectionHead } from '../components/ui'

/**
 * 구글 드라이브 탭 (대표 지시 2026-10-20 "구글드라이브 오른쪽 탭에 넣어줘, 인터넷이 아니고")
 *  - 내 드라이브 · 공유 문서함 · 최근 · 중요 · 공유 드라이브 바로가기, 드라이브 검색
 *  - 회사 공용 폴더(관리자 등록)를 모두에게 보여 주고, 고른 폴더는 이 화면 안에 목록으로 보여 줌
 *    (구글이 허용하는 폴더 보기 · 회사 구글 계정으로 로그인돼 있어야 보임). 파일을 누르면 오른쪽 창에서 엶
 */
const DRIVE = 'https://drive.google.com/drive'
const QUICK: { label: string; url: string; icon: typeof HardDrive }[] = [
  { label: '내 드라이브', url: `${DRIVE}/my-drive`, icon: HardDrive },
  { label: '공유 문서함', url: `${DRIVE}/shared-with-me`, icon: Users },
  { label: '최근 문서함', url: `${DRIVE}/recent`, icon: Clock },
  { label: '중요 문서함', url: `${DRIVE}/starred`, icon: Star },
  { label: '공유 드라이브', url: `${DRIVE}/shared-drives`, icon: Folder },
]
/** 폴더 주소에서 폴더 id (…/folders/<id>) */
const folderId = (url: string) => url.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? null

export default function Drive() {
  const { api, me, version } = useApp()
  const { busy, run } = useAction()
  const { data: folders } = useAsync(() => api.getDriveFolders(), [version], [] as DriveFolder[])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', url: '' })
  const admin = me.role === 'admin'
  const shown = folders.find(f => f.url === open) ?? null
  const id = shown ? folderId(shown.url) : null
  const save = (list: DriveFolder[], msg: string) => run(() => api.setDriveFolders(list), msg)

  return (
    <Shell active="drive">
      <div className="col gap-10">
        <div className="row wrap gap-6">
          <span className="t-title">구글 드라이브</span>
          <span className="grow" />
          <form
            className="drive-search"
            role="search"
            onSubmit={e => {
              e.preventDefault()
              if (q.trim()) openLink(`${DRIVE}/search?q=${encodeURIComponent(q.trim())}`)
            }}
          >
            <Search size={14} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="드라이브에서 파일 찾기 (Enter)" aria-label="드라이브 검색" />
          </form>
        </div>

        <div className="drive-quick">
          {QUICK.map(({ label, url, icon: Icon }) => (
            <button key={label} type="button" className="drive-tile" onClick={() => openLink(url)}>
              <Icon size={20} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <span className="t-cap">회사 구글 계정(@thewklyn.com)으로 로그인돼 있어야 보입니다. 드라이브는 오른쪽 창(PC 프로그램은 창 안)에서 열리고, 파일 작업은 그 창에서 그대로 하면 됩니다.</span>

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
            <span className="t-cap">드라이브에서 폴더를 열고 주소창의 주소를 그대로 붙여 넣으세요. 팀원에게 그 폴더 공유 권한이 있어야 열립니다.</span>
          </div>
        )}
        {folders.length === 0 ? (
          <Empty>{admin ? "등록된 회사 폴더가 없습니다. '폴더 등록 · 편집'에서 자주 쓰는 드라이브 폴더를 걸어 두세요." : '등록된 회사 폴더가 없습니다. 관리자에게 등록을 요청하세요.'}</Empty>
        ) : (
          <div className="drive-folders">
            {folders.map((f, i) => (
              <div key={f.url + i} className={`drive-folder${open === f.url ? ' on' : ''}`}>
                <button type="button" className="drive-folder-main" onClick={() => (folderId(f.url) ? setOpen(open === f.url ? null : f.url) : openLink(f.url))} title={folderId(f.url) ? '이 화면에서 폴더 보기' : '오른쪽 창에서 열기'}>
                  <Folder size={16} aria-hidden="true" />
                  <span className="grow">{f.name}</span>
                </button>
                <button type="button" className="icon-btn sm" onClick={() => openLink(f.url)} aria-label={`${f.name} 오른쪽 창에서 열기`} title="오른쪽 창에서 열기">
                  <ExternalLink size={13} />
                </button>
                {admin && editing && (
                  <button type="button" className="icon-btn sm" disabled={busy} onClick={() => window.confirm(`'${f.name}' 폴더를 목록에서 뺄까요? (드라이브 파일은 그대로)`) && save(folders.filter((_, j) => j !== i), '목록에서 뺐습니다.')} aria-label={`${f.name} 빼기`}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {shown && id && (
            <div className="col gap-4">
              <div className="row gap-6">
                <b className="t-bodyb">{shown.name}</b>
                <span className="grow" />
                <Button kind="outline" size="sm" onClick={() => openLink(shown.url)}>
                  드라이브에서 열기
                </Button>
              </div>
              {/* 구글이 다른 화면 안에 넣는 것을 허용하는 폴더 목록 보기 */}
              <iframe className="drive-frame-list" title={`${shown.name} 폴더`} src={`https://drive.google.com/embeddedfolderview?id=${id}#list`} />
              <span className="t-cap">목록이 비어 보이면 브라우저가 구글 로그인을 막는 경우입니다. '드라이브에서 열기'를 누르세요.</span>
            </div>
        )}
      </div>
    </Shell>
  )
}
