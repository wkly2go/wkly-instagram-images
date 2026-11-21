// 프로젝트 메일 (대표 지시 2026-10-31 "지메일 연동해"): 회사 메일함(info@)에서 이 프로젝트 · 거래처와 연결된 메일
//  - 연번 · 프로젝트 이름 · 거래처 · 연락처 메일 주소로 자동 연결 (서버 10분마다)
//  - 읽기만 · 누르면 지메일에서 그 대화를 엶
//  - 2026-11-21 '연결 고치기': 자동 연결이 틀린 대화는 떼고, 빠진 대화는 찾아 붙임(같은 대화 전체 · 다시 동기화돼도 유지 · RPC mail_project_set)
import { useState } from 'react'
import { FileText, Link2, Mail, Paperclip, RefreshCw, Search, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { shortDate } from '../lib/date'
import { gmailThreadUrl, type MailFile, type MailItem, type Project } from '../lib/types'
import { openLink } from './WebSearch'
import { SectionHead } from './ui'

/** toolsOnly: '대화 모아 보기' 안에서 메일 칩을 골랐을 때 — 메일 줄은 모아 보기가 보여 주므로 새로고침 · 받은 파일만 (2026-11-20) */
export function ProjectMails({ project, toolsOnly = false }: { project: Project; toolsOnly?: boolean }) {
  const { api, version, bump, toast } = useApp()
  const [refreshing, setRefreshing] = useState(false)
  // 새로고침 (대표 지시 2026-11-11 "이메일 연결이 원활하지 않아"): 회사 메일함 최근 2일 바로 받고 목록 다시 읽기
  const refresh = async () => {
    setRefreshing(true)
    try {
      const r = await api.gmailRefresh()
      toast(r.skipped ? '방금 동기화를 시도했습니다. 목록을 다시 읽었습니다. 1분 후 다시 시도할 수 있습니다.' : `메일함을 확인했습니다 (새로 ${r.saved}통).${r.pending ? ' 남은 메일은 다음 새로고침에서 이어받습니다.' : ''}${r.failed ? ` 처리 실패 ${r.failed}통은 보존했습니다.` : ''}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '메일함 확인에 실패했습니다. 목록만 다시 읽었습니다.')
    } finally {
      bump()
      setRefreshing(false)
    }
  }
  const refreshBtn = (
    <button type="button" className="btn btn-outline btn-sm mail-refresh" onClick={() => void refresh()} disabled={refreshing} title="회사 메일함에서 최근 메일을 바로 받아 이 프로젝트 메일을 다시 읽기">
      <RefreshCw size={13} className={refreshing ? 'spin' : undefined} /> {refreshing ? '확인 중…' : '새로고침'}
    </button>
  )
  const { data } = useAsync(() => api.listProjectMails(project.id, project.client_id ?? null), [project.id, project.client_id, version], [] as MailItem[])
  const { data: savedAll } = useAsync(() => api.listMailFiles(project.id, project.client_id ?? null), [project.id, project.client_id, version], [] as MailFile[])
  // 드라이브에 넣은 자료는 '구글 드라이브 자료' 칸에서 보여 줌
  const saved = savedAll.filter(f => f.source !== 'drive')
  const [all, setAll] = useState(false)
  // 같은 대화는 최신 한 통만
  const threads = [...new Map(data.map(m => [m.thread_id, m])).values()]
  const files = saved.length > 0 && (
    <div className="mail-files">
      <span className="t-cap">받은 파일 · 드라이브 수신방</span>
      {saved.slice(0, 24).map(f => (
        <button key={f.id} type="button" className="chip" onClick={() => openLink(f.drive_url)} title={`${f.vendor} · ${f.kind}`}>
          <FileText size={11} /> {f.kind !== '첨부' ? `[${f.kind}] ` : ''}
          {f.name}
        </button>
      ))}
    </div>
  )
  if (toolsOnly)
    return (
      <div className="mail-tools" aria-label="메일 새로고침 · 받은 파일">
        <span className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="t-cap">회사 메일함 · 연번 · 프로젝트 이름으로 자동 연결 (10분마다) · 줄을 누르면 지메일에서 엽니다</span>
          {refreshBtn}
        </span>
        <MailLinkFix project={project} threads={threads} />
        {files}
      </div>
    )
  // 연결된 메일이 없어도 새로고침은 할 수 있게
  if (!threads.length)
    return (
      <section className="section" aria-label="메일">
        <SectionHead title="메일" count="0" right={refreshBtn} />
        <span className="t-cap">아직 이 프로젝트로 연결된 메일이 없습니다. 메일 제목에 연번 · 프로젝트 이름이 있으면 자동으로 연결됩니다.</span>
      </section>
    )
  const shown = all ? threads : threads.slice(0, 6)
  return (
    <section className="section" aria-label="메일">
      <SectionHead title="메일" count={String(threads.length)} right={
          <span className="row" style={{ gap: 8 }}>
            <span className="t-cap">회사 메일함 · 연번 · 프로젝트 이름으로 자동 연결</span>
            {refreshBtn}
          </span>
        } />
      <ul className="mail-list">
        {shown.map(m => (
          <li key={m.id}>
            <button type="button" onClick={() => openLink(gmailThreadUrl(m.thread_id))} title="지메일에서 열기">
              <Mail size={14} className="mail-ic" />
              <span className="mail-main">
                <span className="mail-top">
                  <b className="truncate">{m.subject || '(제목 없음)'}</b>
                  {m.has_attachment && (
                    <span className="t-cap mail-att" title={m.attachments.join(', ')}>
                      <Paperclip size={11} /> {m.attachments.length}
                    </span>
                  )}
                  <span className="t-meta">{m.sent_at ? shortDate(m.sent_at.slice(0, 10)) : ''}</span>
                </span>
                <span className="t-cap truncate">
                  {m.from_name || m.from_addr} · {m.snippet}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {files}
      {threads.length > 6 && (
        <button type="button" className="link-btn t-cap" onClick={() => setAll(v => !v)}>
          {all ? '접기' : `${threads.length - 6}개 더 보기`}
        </button>
      )}
    </section>
  )
}

/** 연결 고치기: 붙은 대화 떼기 · 안 붙은 대화 찾아 붙이기 */
function MailLinkFix({ project, threads }: { project: Project; threads: MailItem[] }) {
  const { api, bump, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<MailItem[] | null>(null)
  const [busy, setBusy] = useState('')
  const search = async () => {
    if (q.trim().length < 2) return toast('두 글자 이상 넣어 주세요.')
    setBusy('search')
    try {
      const rows = await api.searchMailsToLink(project.id, q)
      setFound([...new Map(rows.map(m => [m.thread_id, m])).values()])
    } catch (e) {
      toast(e instanceof Error ? e.message : '메일을 찾지 못했습니다.')
    } finally {
      setBusy('')
    }
  }
  const set = async (m: MailItem, on: boolean) => {
    setBusy(m.id)
    try {
      const n = await api.setMailProject(m.id, project.id, on)
      toast(on ? `이 프로젝트에 붙였습니다 (같은 대화 ${n}통).` : `이 프로젝트에서 뗐습니다 (같은 대화 ${n}통). 다시 동기화돼도 붙지 않습니다.`)
      if (on) setFound(f => (f ?? []).filter(x => x.thread_id !== m.thread_id))
      bump()
    } catch (e) {
      toast(e instanceof Error ? e.message : '바꾸지 못했습니다.')
    } finally {
      setBusy('')
    }
  }
  const line = (m: MailItem) => (
    <span className="mail-fix-text">
      <b className="truncate">{m.subject || '(제목 없음)'}</b>
      <span className="t-cap truncate">
        {m.from_name || m.from_addr} · {m.sent_at ? shortDate(m.sent_at.slice(0, 10)) : ''}
      </span>
    </span>
  )
  if (!open)
    return (
      <button type="button" className="btn btn-outline btn-sm mail-fix-open" onClick={() => setOpen(true)} title="자동 연결이 틀린 메일을 떼거나 빠진 메일을 찾아 붙입니다">
        <Link2 size={13} /> 연결 고치기
      </button>
    )
  return (
    <div className="mail-fix" aria-label="메일 연결 고치기">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <b className="tx-em">메일 연결 고치기</b>
        <button type="button" className="link-btn t-cap" onClick={() => setOpen(false)}>닫기</button>
      </div>
      <span className="t-cap">같은 대화 전체에 적용됩니다. 고친 내용은 메일이 다시 동기화돼도 그대로 지켜집니다.</span>
      <form className="row mail-fix-search" onSubmit={e => { e.preventDefault(); void search() }}>
        <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="제목 · 보낸 사람 · 메일 주소로 찾기" aria-label="붙일 메일 찾기" />
        <button type="submit" className="btn btn-sm" disabled={busy === 'search'}><Search size={13} /> 찾기</button>
      </form>
      {found && (
        <ul className="mail-fix-list" aria-label="찾은 메일">
          {found.length === 0 && <li className="t-cap">이 프로젝트에 아직 안 붙은 메일 중 맞는 것이 없습니다.</li>}
          {found.map(m => (
            <li key={m.id}>
              {line(m)}
              <button type="button" className="btn btn-outline btn-sm" disabled={busy === m.id} onClick={() => void set(m, true)}>붙이기</button>
            </li>
          ))}
        </ul>
      )}
      <span className="t-cap">지금 붙어 있는 대화 {threads.length}개</span>
      <ul className="mail-fix-list" aria-label="붙어 있는 메일">
        {threads.slice(0, 40).map(m => (
          <li key={m.id}>
            {line(m)}
            <button type="button" className="icon-btn" disabled={busy === m.id} onClick={() => void set(m, false)} title="이 프로젝트에서 떼기" aria-label={`${m.subject || '메일'} 떼기`}>
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
