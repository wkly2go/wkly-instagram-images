// 프로젝트 메일 (대표 지시 2026-10-31 "지메일 연동해"): 회사 메일함(info@)에서 이 프로젝트 · 거래처와 연결된 메일
//  - 연번 · 프로젝트 이름 · 거래처 · 연락처 메일 주소로 자동 연결 (서버 10분마다)
//  - 읽기만 · 누르면 지메일에서 그 대화를 엶
import { useState } from 'react'
import { FileText, Mail, Paperclip, RefreshCw } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { shortDate } from '../lib/date'
import { gmailThreadUrl, type MailFile, type MailItem, type Project } from '../lib/types'
import { openLink } from './WebSearch'
import { SectionHead } from './ui'

export function ProjectMails({ project }: { project: Project }) {
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
      {saved.length > 0 && (
        <div className="mail-files">
          <span className="t-cap">받은 파일 · 드라이브 수신방</span>
          {saved.slice(0, 24).map(f => (
            <button key={f.id} type="button" className="chip" onClick={() => openLink(f.drive_url)} title={`${f.vendor} · ${f.kind}`}>
              <FileText size={11} /> {f.kind !== '첨부' ? `[${f.kind}] ` : ''}
              {f.name}
            </button>
          ))}
        </div>
      )}
      {threads.length > 6 && (
        <button type="button" className="link-btn t-cap" onClick={() => setAll(v => !v)}>
          {all ? '접기' : `${threads.length - 6}개 더 보기`}
        </button>
      )}
    </section>
  )
}
