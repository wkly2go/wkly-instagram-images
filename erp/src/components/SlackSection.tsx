// 슬랙 대화 · 자료 가져오기 (대표 지시 2026-11-05 "슬랙의 채팅과 자료 공유를 프로젝트 폴더에 가져오기")
//  - 프로젝트마다 슬랙 채널을 연결 → '가져오기' 를 누르면 새 대화는 여기 · 공유 파일은 드라이브 프로젝트 폴더(01.협의자료/02.슬랙/날짜)
//  - 슬랙이 아직 연결 안 됐으면: 관리자에게만 토큰 넣는 칸과 슬랙 앱 만드는 순서 안내
import { useState } from 'react'
import { Download, ExternalLink, Hash, Link2, Lock, Paperclip, Unlink } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate } from '../lib/date'
import type { Project, SlackChannel, SlackLink, SlackMessage } from '../lib/types'
import { openLink } from './WebSearch'
import { Button, SectionHead } from './ui'

const SCOPES = 'channels:read, channels:history, channels:join, groups:read, groups:history, files:read, users:read'

export function SlackSection({ project }: { project: Project }) {
  const { api, me, version } = useApp()
  const admin = me.role === 'admin'
  const { busy, run } = useAction()
  const { data: status, loading } = useAsync(() => api.slackStatus(), [version], { connected: false } as Awaited<ReturnType<typeof api.slackStatus>>)
  const { data: links } = useAsync(() => api.listSlackLinks(project.id), [project.id, version], [] as SlackLink[])
  const { data: msgs } = useAsync(() => api.listSlackMessages(project.id, 80), [project.id, version], [] as SlackMessage[])
  const [channels, setChannels] = useState<SlackChannel[] | null>(null)
  const [pick, setPick] = useState('')
  const [token, setToken] = useState('')
  const [all, setAll] = useState(false)
  const [progress, setProgress] = useState('')

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
            <Button disabled={busy || !token.trim()} onClick={() => void run(() => api.slackSetToken(token.trim()).then(() => setToken('')), '슬랙을 연결했습니다.')}>
              연결
            </Button>
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
      setProgress(errs.length ? `일부 실패: ${errs.slice(0, 2).join(' · ')}` : '')
      return total
    }, '슬랙에서 새 대화 · 파일을 가져왔습니다.')
  const shown = all ? msgs : msgs.slice(0, 12)
  // 오래된 것부터 위 → 아래 (대화 읽는 순서)
  const ordered = [...shown].reverse()
  return (
    <section className="section slack-sec" aria-label="슬랙 대화 · 자료">
      <SectionHead
        title="슬랙 대화 · 자료"
        count={msgs.length ? String(msgs.length) : undefined}
        right={<span className="t-cap">{status.team ? `${status.team} · ` : ''}파일은 드라이브 01.협의자료/02.슬랙</span>}
      />
      <div className="slack-links">
        {links.map(l => (
          <span key={l.id} className="slack-chip">
            <Hash size={13} />
            <b>{l.channel_name || l.channel_id}</b>
            <span className="t-cap">
              {l.imported_count ? `대화 ${l.imported_count} · 파일 ${l.file_count}` : '아직 안 가져옴'}
              {l.last_imported_at ? ` · ${shortDate(l.last_imported_at.slice(0, 10))}` : ''}
            </span>
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
      </div>
      {channels?.some(c => c.is_private && !c.is_member) && (
        <span className="t-cap">
          <Lock size={11} /> 비공개 채널은 슬랙에서 그 채널에 <code>/invite @wkly-intranet</code> 으로 앱을 먼저 초대해야 가져올 수 있습니다.
        </span>
      )}
      {progress && <span className="t-cap">{progress}</span>}
      {msgs.length > 0 ? (
        <ul className="slack-msgs">
          {ordered.map(m => (
            <li key={m.id} className={m.thread_ts ? 'reply' : ''}>
              <div className="slack-meta">
                <b>{m.user_name}</b>
                <span className="t-cap">
                  #{m.channel_name} · {shortDate(m.posted_at.slice(0, 10))} {new Date(m.posted_at).toTimeString().slice(0, 5)}
                  {m.thread_ts ? ' · 답글' : ''}
                </span>
              </div>
              {m.text && <div className="slack-text pre">{m.text}</div>}
              {m.files.length > 0 && (
                <div className="slack-files">
                  {m.files.map((f, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`slack-file${f.drive_url ? '' : ' off'}`}
                      onClick={() => (f.drive_url ? openLink(f.drive_url) : f.slack_url ? openLink(f.slack_url) : undefined)}
                      title={f.drive_url ? '드라이브에서 열기' : f.skipped ?? ''}
                    >
                      <Paperclip size={12} />
                      <span className="truncate">{f.name}</span>
                      {f.drive_url ? <ExternalLink size={11} /> : <span className="t-cap">{f.skipped ?? '슬랙에만 있음'}</span>}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        links.length > 0 && <span className="t-cap">'지금 가져오기' 를 누르면 연결한 채널의 대화와 파일을 가져옵니다.</span>
      )}
      {msgs.length > 12 && (
        <button type="button" className="link-btn" onClick={() => setAll(v => !v)}>
          {all ? '접기' : `지난 대화 ${msgs.length - 12}개 더 보기`}
        </button>
      )}
    </section>
  )
}
