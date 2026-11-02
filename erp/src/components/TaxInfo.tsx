// 매출 세금계산서 발행 정보 (대표 지시 2026-11-02 "매출에는 우리가 세금계산서 발행해줘야 하니까 사업자등록증이랑 메일주소 올리는 칸")
//  - 협력업체 관리 › 매출 줄을 펼치면 나옴
//  - 거래처(발주처)에 저장: 사업자등록번호 · 세금계산서 메일 · 사업자등록증 파일 → 다른 프로젝트에서도 같은 거래처면 그대로 보임
//  - 거래처가 없으면 업체명으로 거래처를 만들고 이 프로젝트에 연결
//  - 사업자등록증은 끌어다 놓거나 골라서 올림 → 수신방/날짜/프로젝트/분류 에 저장
import { useRef, useState } from 'react'
import { FileText, Upload } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { uploadLarge } from '../lib/gdrive'
import type { Client, Project } from '../lib/types'
import { openLink } from './WebSearch'

const norm = (s: string) => s.replace(/\s|㈜|\(주\)|주식회사/g, '').toLowerCase()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function TaxInfo({ projectId, payee }: { projectId: string; payee: string }) {
  const { api, version, bump, toast } = useApp()
  const { busy, run } = useAction()
  const { data } = useAsync(
    async () => {
      const [clients, projects] = await Promise.all([api.listClients(), api.listProjects()])
      return { clients, project: projects.find(p => p.id === projectId) ?? null }
    },
    [projectId, version],
    { clients: [] as Client[], project: null as Project | null },
  )
  const [up, setUp] = useState<number | null>(null)
  const [drag, setDrag] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const client = data.clients.find(c => c.id === data.project?.client_id) ?? data.clients.find(c => norm(c.name) === norm(payee))

  /** 거래처가 없으면 만들고 프로젝트에 연결 */
  const ensureClient = async (): Promise<Client> => {
    if (client) return client
    const c = await api.saveClient({ name: payee, category: '클라이언트' } as Partial<Client> as Client)
    if (data.project && !data.project.client_id) await api.saveProject({ id: data.project.id, client_id: c.id } as Partial<Project> as Project)
    return c
  }
  const save = (patch: Partial<Client>, msg: string) =>
    void run(async () => {
      const c = await ensureClient()
      await api.saveClient({ id: c.id, ...patch } as Partial<Client> as Client)
      bump()
    }, msg)

  const uploadCert = async (file: File | undefined) => {
    if (!file || up != null) return
    try {
      setUp(0)
      const c = await ensureClient()
      const mime = file.type || 'application/octet-stream'
      const s = await api.inboxUploadStart(projectId, { name: file.name, mime, size: file.size })
      const g = await uploadLarge('', file, s.folder_id, async () => s.url, r => setUp(r))
      if (!g.id) throw new Error('올린 뒤 파일 정보를 받지 못했습니다.')
      await api.inboxUploadDone(projectId, { file_id: g.id, folder_id: s.folder_id, kind: s.kind, name: file.name })
      await api.saveClient({ id: c.id, biz_cert_url: g.webViewLink ?? `https://drive.google.com/file/d/${g.id}/view`, biz_cert_name: file.name } as Partial<Client> as Client)
      bump()
      toast(`${c.name} 사업자등록증을 올렸습니다.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '사업자등록증을 올리지 못했습니다.')
    } finally {
      setUp(null)
    }
  }

  const ready = !!client?.business_no && !!client?.tax_email && !!client?.biz_cert_url
  return (
    <div className="tax-info">
      <div className="tax-h">
        <b>세금계산서 발행 정보</b>
        <span className={ready ? 'tax-ok' : 'tax-miss'}>{ready ? '발행 준비 완료' : '빠진 정보가 있습니다'}</span>
        <span className="t-cap">{client ? `거래처: ${client.name}` : `거래처 없음 → 저장하면 '${payee}'로 만들고 이 프로젝트에 연결`}</span>
      </div>
      <div className="tax-grid" key={client?.updated_at ?? 'new'}>
        <label className="label">
          <span>사업자등록번호</span>
          <input
            className="input mono"
            defaultValue={client?.business_no ?? ''}
            placeholder="000-00-00000"
            onBlur={e => {
              const t = e.target.value.trim() || null
              if (t !== (client?.business_no ?? null)) save({ business_no: t }, '사업자등록번호를 저장했습니다.')
            }}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <label className="label">
          <span>세금계산서 받을 메일</span>
          <input
            className="input"
            type="email"
            defaultValue={client?.tax_email ?? ''}
            placeholder="tax@company.co.kr"
            onBlur={e => {
              const t = e.target.value.trim() || null
              if (t && !EMAIL.test(t)) return toast('메일 주소 형식을 확인해 주세요.')
              if (t !== (client?.tax_email ?? null)) save({ tax_email: t }, '세금계산서 메일을 저장했습니다.')
            }}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <div className="label">
          <span>사업자등록증</span>
          <div
            className={`tax-drop${drag ? ' on' : ''}`}
            onDragOver={e => {
              if (![...e.dataTransfer.types].includes('Files')) return
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => {
              e.preventDefault()
              setDrag(false)
              void uploadCert(e.dataTransfer.files[0])
            }}
          >
            {client?.biz_cert_url && (
              <button type="button" className="link-btn" onClick={() => openLink(client.biz_cert_url!)} title="열기">
                <FileText size={13} /> {client.biz_cert_name ?? '사업자등록증'}
              </button>
            )}
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || up != null} onClick={() => pick.current?.click()}>
              <Upload size={12} /> {up != null ? `올리는 중 ${Math.round(up * 100)}%` : client?.biz_cert_url ? '다시 올리기' : '올리기 (끌어다 놓기)'}
            </button>
            <input ref={pick} type="file" hidden accept=".pdf,image/*" onChange={e => (void uploadCert(e.target.files?.[0]), (e.target.value = ''))} />
          </div>
        </div>
      </div>
    </div>
  )
}
