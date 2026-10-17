import { useApp, useAsync } from '../lib/app'
import { shortDate } from '../lib/date'
import { Link } from '../lib/router'
import type { Approval, ChatRoomSummary, Client, Contact, Payment, Project, WorkLog } from '../lib/types'
import { Badge, Empty, SectionHead } from './ui'
import { ContactTimeline, ExchangeFilesSection, ProjectContactsSection } from './ContactHistory'

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`

/** 프로젝트에 연결된 모든 자료: 연락처 · 주고받은 자료 · 업무 기록 · 채팅방 · 승인 · 결제 */
export function ProjectMaterials({ projectId }: { projectId: string }) {
  const { api, me, version } = useApp()
  const admin = me.role === 'admin'
  const { data, loading } = useAsync(
    async () => {
      const [projects, clients, contacts, logs, rooms, approvals, payments] = await Promise.all([
        api.listProjects(),
        api.listClients(),
        api.listContacts().catch(() => [] as Contact[]),
        api.listWorkLogs({ projectId, limit: 80 }),
        api.listRooms(),
        api.listApprovals().catch(() => [] as Approval[]),
        admin ? api.listPayments({ projectId }).catch(() => [] as Payment[]) : Promise.resolve([] as Payment[]),
      ])
      return { project: projects.find(p => p.id === projectId) ?? null, projects, clients, contacts, logs, room: rooms.find(r => r.project_id === projectId) ?? null, approvals: approvals.filter(a => a.target_id === projectId), payments }
    },
    [projectId, version, admin],
    { project: null as Project | null, projects: [] as Project[], clients: [] as Client[], contacts: [] as Contact[], logs: [] as WorkLog[], room: null as ChatRoomSummary | null, approvals: [] as Approval[], payments: [] as Payment[] },
  )
  const p = data.project
  if (!p) return <Empty>{loading ? '불러오는 중…' : '프로젝트를 찾을 수 없습니다.'}</Empty>
  return (
    <div className="col gap-8 proj-materials">
      <div className="row wrap gap-6">
        {p.code && <span className="proj-code">{p.code}</span>}
        <span className="t-bodyb truncate">{p.name}</span>
        <span className="grow" />
        {data.room ? <Link to={`/chat?room=${data.room.id}`}>채팅방 ›</Link> : <span className="t-cap">채팅방 없음</span>}
      </div>
      <ProjectContactsSection project={p} clients={data.clients} contacts={data.contacts} />
      <ExchangeFilesSection clientId={p.client_id} projectId={p.id} contacts={data.contacts} projects={data.projects} />
      <SectionHead title="관련 업무 기록" count={data.logs.length ? String(data.logs.length) : undefined} />
      <ContactTimeline logs={data.logs} projects={[]} showContact contacts={data.contacts} />
      <SectionHead title="승인" count={data.approvals.length ? String(data.approvals.length) : undefined} />
      {data.approvals.length === 0 ? (
        <span className="t-cap">연결된 승인이 없습니다.</span>
      ) : (
        <div className="col gap-2">
          {data.approvals.map(a => (
            <Link key={a.id} to={`/approvals?id=${a.id}`} className="row gap-6 link-row">
              <Badge tone={a.status === '승인' ? 'green' : a.status === '반려' ? 'red' : 'yellow'}>{a.status}</Badge>
              <span className="t-small truncate grow">{a.title}</span>
              <span className="t-meta">{shortDate(a.created_at.slice(0, 10))}</span>
            </Link>
          ))}
        </div>
      )}
      {admin && (
        <>
          <SectionHead title="결제" count={data.payments.length ? String(data.payments.length) : undefined} />
          {data.payments.length === 0 ? (
            <span className="t-cap">연결된 결제가 없습니다.</span>
          ) : (
            <div className="col gap-2">
              {data.payments.map(x => (
                <div key={x.id} className="row gap-6">
                  <Badge tone={x.direction === '수금' ? 'blue' : 'paper'}>{x.direction}</Badge>
                  <span className="t-small truncate grow">{x.title}</span>
                  <span className="t-meta">{won(x.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
