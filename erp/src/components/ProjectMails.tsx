// 프로젝트 메일 (대표 지시 2026-10-31 "지메일 연동해"): 회사 메일함(info@)에서 이 프로젝트 · 거래처와 연결된 메일
//  - 연번 · 프로젝트 이름 · 거래처 · 연락처 메일 주소로 자동 연결 (서버 10분마다)
//  - 읽기만 · 누르면 지메일에서 그 대화를 엶
import { useState } from 'react'
import { Mail, Paperclip } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { shortDate } from '../lib/date'
import { gmailThreadUrl, type MailItem, type Project } from '../lib/types'
import { openLink } from './WebSearch'
import { SectionHead } from './ui'

export function ProjectMails({ project }: { project: Project }) {
  const { api, version } = useApp()
  const { data } = useAsync(() => api.listProjectMails(project.id, project.client_id ?? null), [project.id, project.client_id, version], [] as MailItem[])
  const [all, setAll] = useState(false)
  // 같은 대화는 최신 한 통만
  const threads = [...new Map(data.map(m => [m.thread_id, m])).values()]
  if (!threads.length) return null
  const shown = all ? threads : threads.slice(0, 6)
  return (
    <section className="section" aria-label="메일">
      <SectionHead title="메일" count={String(threads.length)} right={<span className="t-cap">회사 메일함 · 연번 · 이름 · 거래처로 자동 연결</span>} />
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
      {threads.length > 6 && (
        <button type="button" className="link-btn t-cap" onClick={() => setAll(v => !v)}>
          {all ? '접기' : `${threads.length - 6}개 더 보기`}
        </button>
      )}
    </section>
  )
}
