// 슬랙 대화 · 자료 가져오기 (대표 지시 2026-11-05 "슬랙의 채팅과 자료 공유를 프로젝트 폴더에 가져오기")
//  - 프로젝트마다 슬랙 채널을 연결 → '가져오기' 를 누르면 새 대화는 여기 · 공유 파일은 드라이브 프로젝트 폴더(01.협의자료/02.슬랙/날짜)
//  - 슬랙이 아직 연결 안 됐으면: 관리자에게만 토큰 넣는 칸과 슬랙 앱 만드는 순서 안내
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Download, ExternalLink, Hash, Link2, Lock, Paperclip, RefreshCw, Unlink } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { shortDate } from '../lib/date'
import { createSlackSnapshotLoader } from '../lib/slackSnapshot'
import { createVisiblePoller } from '../lib/visiblePolling'
import type { Project, SlackChannel, SlackLink, SlackMessage } from '../lib/types'
import { openLink } from './WebSearch'
import { Button, Linkify, SectionHead } from './ui'

const SCOPES = 'channels:read, channels:history, channels:join, groups:read, groups:history, files:read, users:read'

export function SlackSection({ project }: { project: Project }) {
  const { me } = useApp()
  // 프로젝트·계정이 바뀌면 접기 상태와 읽던 대화를 함께 새로 시작한다.
  return <SlackProjectSection key={`${me.id}:${project.id}`} project={project} />
}

function SlackProjectSection({ project }: { project: Project }) {
  const { api, me, version } = useApp()
  const admin = me.role === 'admin'
  const { busy, run } = useAction()
  const { data: status, loading, reload: reloadStatus } = useAsync(() => api.slackStatus(), [api, me.id], { connected: false } as Awaited<ReturnType<typeof api.slackStatus>>)
  const [snapshot, setSnapshot] = useState<{ links: SlackLink[]; messages: SlackMessage[] }>({ links: [], messages: [] })
  const { links, messages: msgs } = snapshot
  const [refreshing, setRefreshing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const poller = useRef<ReturnType<typeof createVisiblePoller> | null>(null)
  const snapshotLoader = useRef<ReturnType<typeof createSlackSnapshotLoader> | null>(null)
  const seenVersion = useRef(version)
  const statusCheckedAt = useRef(Date.now())
  const [channels, setChannels] = useState<SlackChannel[] | null>(null)
  const [pick, setPick] = useState('')
  const [token, setToken] = useState('')
  const [open, setOpenState] = useState(() => readFold(project.id))
  const setOpen = (v: boolean) => {
    setOpenState(v)
    try {
      localStorage.setItem(`wkly-slack-open-${project.id}`, v ? '1' : '0')
    } catch {
      /* 기억 못 해도 괜찮음 */
    }
  }
  const [tab, setTab] = useState<'talk' | 'files'>('talk')
  const [allOpen, setAllOpen] = useState<boolean | undefined>(undefined)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    const loader = createSlackSnapshotLoader(api, project.id)
    const controller = createVisiblePoller({
      load: () => loader.load(),
      onValue: value => {
        setSnapshot(value)
        setLoaded(true)
        setLoadError(null)
      },
      onError: error => setLoadError(friendlyError(error)),
      onLoading: setRefreshing,
      isVisible: () => document.visibilityState === 'visible',
      intervalMs: 60_000,
    })
    poller.current = controller
    snapshotLoader.current = loader
    const resume = () => controller.visibilityChanged()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    return () => {
      controller.stop()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
      poller.current = null
      snapshotLoader.current = null
    }
  }, [api, project.id])

  useEffect(() => {
    poller.current?.setEnabled(open && status.connected)
  }, [open, status.connected, api, project.id])

  useEffect(() => {
    const check = () => {
      if (!open || document.visibilityState !== 'visible' || Date.now() - statusCheckedAt.current < 60_000) return
      statusCheckedAt.current = Date.now()
      reloadStatus()
    }
    check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [open, reloadStatus])

  useEffect(() => {
    if (seenVersion.current === version) return
    seenVersion.current = version
    void poller.current?.refresh(true)
  }, [version])

  const refresh = () => {
    snapshotLoader.current?.forceMessages()
    void poller.current?.refresh(true)
    statusCheckedAt.current = Date.now()
    reloadStatus()
  }

  if (loading && !status.connected) return null
  // 연결 전: 관리자만 연결 칸 · 팀원에게는 숨김
  if (!status.connected) {
    if (!admin) return null
    return (
      <section className="section slack-sec" aria-label="슬랙 연결">
        <SectionHead title="슬랙 대화 · 자료 가져오기" right={<span className="t-cap">관리자만 보임</span>} />
        <div className="slack-setup">
          <ol>
            <li>
              <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
                api.slack.com/apps
              </a>{' '}
              › <b>Create New App</b> › From scratch › 이름 'WKLY 인트라넷' · 회사 워크스페이스
            </li>
            <li>
              <b>OAuth &amp; Permissions</b> › Bot Token Scopes 에 추가: <code>{SCOPES}</code>
            </li>
            <li>
              <b>Install to Workspace</b> › 나오는 <b>Bot User OAuth Token</b>(xoxb- 로 시작)을 복사해 아래 칸에 붙여 넣기
            </li>
          </ol>
          <div className="row gap-6 wrap">
            <input className="input grow" type="password" autoComplete="off" placeholder="xoxb-…" value={token} onChange={e => setToken(e.target.value)} aria-label="슬랙 봇 토큰" />
            <Button disabled={busy || !token.trim()} onClick={() => void run(() => api.slackSetToken(token.trim()).then(() => { setToken(''); reloadStatus() }), '슬랙을 연결했습니다.')}>
              연결
            </Button>
            <Button kind="outline" disabled={loading || busy} onClick={reloadStatus}>연결 상태 새로고침</Button>
          </div>
          <span className="t-cap">토큰은 서버 금고(Vault)에만 저장되고 화면 · 대화에는 다시 보이지 않습니다.</span>
          {status.error && <span className="t-cap t-red">{status.error}</span>}
        </div>
      </section>
    )
  }

  const loadChannels = () => void run(async () => setChannels(await api.slackChannels()))
  const linked = new Set(links.map(l => l.channel_id))
  const doImport = () =>
    void run(async () => {
      let total = { messages: 0, files: 0 }
      const errs: string[] = []
      for (let i = 0; i < 10; i++) {
        setProgress(i ? `이어서 가져오는 중… (대화 ${total.messages} · 파일 ${total.files})` : '가져오는 중…')
        const r = await api.slackImport(project.id)
        total = { messages: total.messages + r.messages, files: total.files + r.files }
        errs.push(...r.errors)
        if (!r.more) break
      }
      snapshotLoader.current?.forceMessages()
      setProgress(errs.length ? `일부 실패: ${errs.slice(0, 2).join(' · ')}` : '')
      return total
    }, '슬랙에서 새 대화 · 파일을 가져왔습니다.')
  // 대표 지시 2026-11-06 "모든 대화와 자료들은 접을 수 있는 탭": 칸 전체 접기 · 대화 / 자료 탭 · 날짜별 접기 (최근 날짜만 펼침)
  const kday = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  // 최신 날짜가 맨 위 (대표 지시 2026-11-06 "오늘 날짜는 안 들어왔어" — 오늘 대화가 맨 아래 접힌 곳에 있었음) · 하루 안은 시간 순
  const days = groupBy([...msgs].reverse(), m => kday(m.posted_at)).reverse()
  const fileRows = [...msgs].reverse().flatMap(m => m.files.map((f, i) => ({ f, m, key: `${m.id}-${i}` })))
  // 자료도 최신 날짜가 위 · 최신 날짜만 펼침 (대표 지시 2026-11-06 "자료를 접어서 창을 축소")
  const fileDays = groupBy(fileRows, r => kday(r.m.posted_at)).sort((a, b) => b[0].localeCompare(a[0]))
  const latest = days.length ? days[0][0] : ''
  const fileBtn = (f: SlackMessage['files'][number], key: string) => (
    <button
      key={key}
      type="button"
      className={`slack-file${f.drive_url ? '' : ' off'}`}
      onClick={() => (f.drive_url ? openLink(f.drive_url) : f.slack_url ? openLink(f.slack_url) : undefined)}
      title={f.drive_url ? '드라이브에서 열기' : f.skipped ?? ''}
    >
      <Paperclip size={12} />
      <span className="truncate">{f.name}</span>
      {f.drive_url ? <ExternalLink size={11} /> : <span className="t-cap">{f.skipped ?? '슬랙에만 있음'}</span>}
    </button>
  )
  return (
    <section className={`section slack-sec${open ? '' : ' folded'}`} aria-label="슬랙 대화 · 자료">
      <SectionHead
        title="슬랙 대화 · 자료"
        count={msgs.length ? String(msgs.length) : undefined}
        right={
          <span className="row gap-6">
            <span className="t-cap hide-phone">{status.team ? `${status.team} · ` : ''}2분마다 자동 · 파일은 드라이브 01.협의자료/02.슬랙</span>
            <button type="button" className="slack-fold" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? '접기' : '펼치기'}>
              {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {open ? '접기' : '펼치기'}
            </button>
          </span>
        }
      />
      {open && (
      <>
      <div className="slack-links">
        {links.map(l => (
          <span key={l.id} className="slack-chip">
            <Hash size={13} />
            <b>{l.channel_name || l.channel_id}</b>
            <span className="t-cap">
              {l.imported_count ? `대화 ${l.imported_count} · 파일 ${l.file_count}` : l.last_imported_at ? '새 대화 없음' : '아직 안 가져옴'}
              {l.last_imported_at ? ` · ${new Date(l.last_imported_at).toTimeString().slice(0, 5)} 확인` : ''}
            </span>
            {l.last_error && <span className="t-cap t-red" title={l.last_error}>· {l.last_error}</span>}
            <button type="button" className="icon-btn sm" title="연결 해제 (가져온 자료는 그대로)" aria-label={`#${l.channel_name} 연결 해제`} onClick={() => void run(() => api.slackUnlink(project.id, l.channel_id), '연결을 해제했습니다.')}>
              <Unlink size={12} />
            </button>
          </span>
        ))}
        {channels ? (
          <span className="row gap-6 slack-pick">
            <select className="select" value={pick} onChange={e => setPick(e.target.value)} aria-label="연결할 슬랙 채널">
              <option value="">채널 고르기</option>
              {channels
                .filter(c => !linked.has(c.id))
                .map(c => (
                  <option key={c.id} value={c.id}>
                    {c.is_private ? '🔒 ' : '# '}
                    {c.name}
                    {!c.is_member && c.is_private ? ' (앱 초대 필요)' : ''}
                  </option>
                ))}
            </select>
            <Button
              size="sm"
              disabled={!pick || busy}
              onClick={() => {
                const c = channels.find(x => x.id === pick)
                if (c) void run(() => api.slackLink(project.id, { id: c.id, name: c.name }).then(() => setPick('')), `#${c.name} 를 이 프로젝트에 연결했습니다.`)
              }}
            >
              <Link2 size={13} /> 연결
            </Button>
          </span>
        ) : (
          <Button kind="outline" size="sm" onClick={loadChannels} disabled={busy}>
            <Link2 size={13} /> 채널 연결
          </Button>
        )}
        {links.length > 0 && (
          <Button size="sm" onClick={doImport} disabled={busy}>
            <Download size={13} /> 지금 가져오기
          </Button>
        )}
        <Button kind="outline" size="sm" onClick={refresh} disabled={busy || refreshing} aria-label="슬랙 대화 새로고침">
          <RefreshCw size={13} /> 새로고침
        </Button>
      </div>
      {channels?.some(c => c.is_private && !c.is_member) && (
        <span className="t-cap">
          <Lock size={11} /> 비공개 채널은 슬랙에서 그 채널에 <code>/invite @wkly-intranet</code> 으로 앱을 먼저 초대해야 가져올 수 있습니다.
        </span>
      )}
      {progress && <span className="t-cap">{progress}</span>}
      {loadError && <span className="t-cap t-red" role="status">{loadError} · 새로고침으로 다시 확인할 수 있습니다.</span>}
      {!loaded && refreshing && <span className="t-cap" role="status">슬랙 대화를 불러오는 중…</span>}
      {msgs.length > 0 ? (
        <>
          <div className="slack-tabs" role="tablist" aria-label="슬랙 보기">
            <button type="button" role="tab" aria-selected={tab === 'talk'} className={tab === 'talk' ? 'on' : ''} onClick={() => setTab('talk')}>
              대화 <b>{msgs.length}</b>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
              자료 <b>{fileRows.length}</b>
            </button>
            <span className="grow" />
            <button type="button" className="link-btn" onClick={() => setAllOpen(v => (v === true ? false : true))}>
              {allOpen === true ? '날짜 모두 접기' : '날짜 모두 펼치기'}
            </button>
          </div>
          {tab === 'talk'
            ? days.map(([d, list]) => (
                <details key={`${d}-${allOpen}`} className="slack-day" open={allOpen ?? d === latest}>
                  <summary>
                    <b>{shortDate(d)}</b>
                    <span className="t-cap">
                      대화 {list.length}
                      {list.some(m => m.files.length) ? ` · 파일 ${list.reduce((n, m) => n + m.files.length, 0)}` : ''}
                      {` · ${[...new Set(list.map(m => m.user_name))].slice(0, 3).join(', ')}`}
                    </span>
                  </summary>
                  <ul className="slack-msgs">
                    {list.map(m => (
                      <li key={m.id} className={m.thread_ts ? 'reply' : ''}>
                        <div className="slack-meta">
                          <b>{m.user_name}</b>
                          <span className="t-cap">
                            #{m.channel_name} · {new Date(m.posted_at).toTimeString().slice(0, 5)}
                            {m.thread_ts ? ' · 답글' : ''}
                          </span>
                        </div>
                        {m.text && <div className="slack-text pre"><Linkify text={m.text} /></div>}
                        {m.files.length > 0 && <div className="slack-files">{m.files.map((f, i) => fileBtn(f, `${m.id}-${i}`))}</div>}
                      </li>
                    ))}
                  </ul>
                </details>
              ))
            : fileDays.length
              ? fileDays.map(([d, list]) => (
                  <details key={`f${d}-${allOpen}`} className="slack-day" open={allOpen ?? d === fileDays[0]?.[0]}>
                    <summary>
                      <b>{shortDate(d)}</b>
                      <span className="t-cap">파일 {list.length}</span>
                    </summary>
                    <div className="slack-filelist">
                      {list.map(({ f, m, key }) => (
                        <div key={key} className="slack-filerow">
                          {fileBtn(f, key)}
                          <span className="t-cap">{m.user_name}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))
              : <span className="t-cap">가져온 파일이 없습니다.</span>}
        </>
      ) : (
        links.length > 0 && <span className="t-cap">'지금 가져오기' 를 누르면 연결한 채널의 대화와 파일을 가져옵니다.</span>
      )}
      </>
      )}
    </section>
  )
}

/** 칸을 접어 두었는지 (프로젝트마다 기억 · 기본은 펼침) */
function readFold(projectId: string): boolean {
  try {
    return localStorage.getItem(`wkly-slack-open-${projectId}`) !== '0'
  } catch {
    return true
  }
}

/** 순서를 지키며 묶기 → [[키, 항목들], …] */
function groupBy<T>(list: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const x of list) {
    const k = key(x)
    m.set(k, [...(m.get(k) ?? []), x])
  }
  return [...m.entries()]
}
