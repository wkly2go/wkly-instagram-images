import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ApiError, type Api, type ImportResult } from './api'
import type {
  AdminOverview,
  AgentToken,
  AppNotification,
  Approval,
  ApprovalRoute,
  BrandContact,
  BudgetLine,
  ChatMessage,
  ChatRoom,
  ChatRoomSummary,
  Client,
  Contact,
  EmailTemplate,
  Payment,
  Profile,
  Project,
  ProjectFinance,
  ResearchItem,
  Task,
  WorkLog,
} from './types'

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new ApiError(res.error.message)
  return res.data as T
}

/** RLS 로 막힌 update/delete 는 오류 없이 0행이 되므로 행 수를 확인 */
function mustAffect<T>(res: { data: T[] | null; error: { message: string } | null }): T[] {
  const rows = must(res) ?? []
  if (rows.length === 0) throw new ApiError('권한이 없거나 이미 처리된 항목입니다.')
  return rows
}

function strip<T extends object>(obj: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k) && v !== undefined) out[k] = v
  return out as Partial<T>
}

const READONLY = ['id', 'created_at', 'updated_at', 'created_by', 'can_decide', 'completed_at', 'edited_at', 'reminded_at', 'opt_out_at', 'updated_by']

export function createSupabaseApi(url: string, key: string): Api {
  const sb: SupabaseClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  })

  async function save<T extends { id?: string }>(table: string, row: T): Promise<T> {
    const body = strip(row, READONLY) as Record<string, unknown>
    if (row.id) {
      const rows = mustAffect(await sb.from(table).update(body).eq('id', row.id).select())
      return rows[0] as T
    }
    return must(await sb.from(table).insert(body).select().single()) as T
  }

  async function remove(table: string, id: string | number) {
    mustAffect(await sb.from(table).delete().eq('id', id).select('id'))
  }

  return {
    mode: 'supabase',

    async getSessionUserId() {
      const { data } = await sb.auth.getSession()
      return data.session?.user.id ?? null
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session?.user.id ?? null))
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw new ApiError(error.message)
    },
    async signOut() {
      await sb.auth.signOut()
    },
    async changePassword(password) {
      const { error } = await sb.auth.updateUser({ password })
      if (error) throw new ApiError(error.message)
    },
    async isActiveMember() {
      return Boolean(must(await sb.rpc('is_active_member')))
    },

    async listProfiles() {
      return must(await sb.from('profiles').select('*').order('created_at')) as Profile[]
    },
    async updateProfile(id, patch) {
      mustAffect(await sb.from('profiles').update(patch).eq('id', id).select('id'))
    },

    async listClients() {
      return must(await sb.from('clients').select('*').order('name')) as Client[]
    },
    saveClient: c => save('clients', c) as Promise<Client>,
    deleteClient: id => remove('clients', id),
    async listContacts(clientId) {
      return must(await sb.from('contacts').select('*').eq('client_id', clientId).order('is_primary', { ascending: false }).order('created_at')) as Contact[]
    },
    saveContact: c => save('contacts', c) as Promise<Contact>,
    deleteContact: id => remove('contacts', id),

    async listProjects() {
      return must(await sb.from('projects').select('*').order('start_date', { ascending: false, nullsFirst: false })) as Project[]
    },
    saveProject: p => save('projects', p) as Promise<Project>,
    deleteProject: id => remove('projects', id),
    async listTasks(filter = {}) {
      let q = sb.from('tasks').select('*')
      if (filter.projectId) q = q.eq('project_id', filter.projectId)
      if (filter.from) q = q.gte('due_date', filter.from)
      if (filter.to) q = q.lte('due_date', filter.to)
      return must(await q.order('due_date', { nullsFirst: false }).order('created_at')) as Task[]
    },
    saveTask: t => save('tasks', t) as Promise<Task>,
    deleteTask: id => remove('tasks', id),

    async listWorkLogs(f) {
      let q = sb.from('work_logs').select('*')
      if (f.date) q = q.eq('log_date', f.date)
      if (f.userId) q = q.eq('user_id', f.userId)
      if (f.clientId) q = q.eq('client_id', f.clientId)
      if (f.projectId) q = q.eq('project_id', f.projectId)
      q = q.order('log_date', { ascending: false }).order('created_at', { ascending: !!f.date })
      if (f.limit) q = q.limit(f.limit)
      return must(await q) as WorkLog[]
    },
    saveWorkLog: l => save('work_logs', l) as Promise<WorkLog>,
    deleteWorkLog: id => remove('work_logs', id),
    async countWorkLogs(today) {
      const [t, all] = await Promise.all([
        sb.from('work_logs').select('id', { count: 'exact', head: true }).eq('log_date', today),
        sb.from('work_logs').select('id', { count: 'exact', head: true }),
      ])
      return { today: t.count ?? 0, total: all.count ?? 0 }
    },

    async listRooms() {
      return must(await sb.rpc('chat_room_summaries')) as ChatRoomSummary[]
    },
    async createRoom(r) {
      return must(await sb.from('chat_rooms').insert(r).select().single()) as ChatRoom
    },
    async listMessages(roomId, limit = 150) {
      const rows = must(await sb.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(limit)) as ChatMessage[]
      return rows.reverse()
    },
    async sendMessage(roomId, content) {
      return must(await sb.from('chat_messages').insert({ room_id: roomId, content }).select().single()) as ChatMessage
    },
    deleteMessage: id => remove('chat_messages', id),
    async markRead(roomId) {
      must(await sb.from('chat_reads').upsert({ room_id: roomId, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,room_id' }))
    },
    subscribeMessages(roomId, cb) {
      const ch = sb
        .channel(`msgs-${roomId ?? 'all'}-${Math.random().toString(36).slice(2)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_messages', ...(roomId ? { filter: `room_id=eq.${roomId}` } : {}) },
          payload => {
            const type = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
            const message = (type === 'DELETE' ? payload.old : payload.new) as ChatMessage
            cb({ type, message })
          },
        )
        .subscribe()
      return () => {
        sb.removeChannel(ch)
      }
    },

    async listApprovals() {
      return must(await sb.from('approvals').select('*, can_decide').order('created_at', { ascending: false }).limit(300)) as Approval[]
    },
    async createApproval(a) {
      return must(await sb.from('approvals').insert(strip(a, READONLY)).select('*, can_decide').single()) as Approval
    },
    async decideApproval(id, status, comment) {
      mustAffect(await sb.from('approvals').update({ status, decision_comment: comment || null }).eq('id', id).eq('status', '대기').select('id'))
    },
    async cancelApproval(id) {
      mustAffect(await sb.from('approvals').update({ status: '취소' }).eq('id', id).eq('status', '대기').select('id'))
    },
    async listApprovalRoutes() {
      return must(await sb.from('approval_routes').select('*')) as ApprovalRoute[]
    },
    async saveApprovalRoute(kind, approverId) {
      must(await sb.from('approval_routes').upsert({ kind, approver_id: approverId }, { onConflict: 'kind' }))
    },
    subscribeChanges(tables, cb) {
      let ch = sb.channel(`changes-${tables.join('-')}-${Math.random().toString(36).slice(2)}`)
      for (const table of tables) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => cb())
      ch.subscribe()
      return () => {
        sb.removeChannel(ch)
      }
    },

    async listFinances() {
      return must(await sb.from('project_finances').select('*')) as ProjectFinance[]
    },
    async saveFinance(f) {
      const body = strip(f, READONLY) as Record<string, unknown>
      return must(await sb.from('project_finances').upsert(body, { onConflict: 'project_id' }).select().single()) as ProjectFinance
    },
    async listPayments(filter = {}) {
      let q = sb.from('payments').select('*')
      if (filter.projectId) q = q.eq('project_id', filter.projectId)
      if (filter.clientId) q = q.eq('client_id', filter.clientId)
      return must(await q.order('due_date', { nullsFirst: false }).order('created_at')) as Payment[]
    },
    savePayment: p => save('payments', p) as Promise<Payment>,
    deletePayment: id => remove('payments', id),
    async updatePayments(ids, patch) {
      if (!ids.length) return
      const body = strip(patch, READONLY) as Record<string, unknown>
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200)
        const rows = must(await sb.from('payments').update(body).in('id', part).select('id')) ?? []
        if (rows.length !== part.length) throw new ApiError('권한이 없거나 일부 항목을 바꾸지 못했습니다.')
      }
    },
    async importPayments(rows, budgetLines = []) {
      let lines = 0
      for (let i = 0; i < budgetLines.length; i += 500) {
        // 결제가 예산 줄을 가리키도록 화면에서 만든 id 는 그대로 저장
        const part = budgetLines.slice(i, i + 500).map(b => strip(b, READONLY.filter(k => k !== 'id')))
        lines += (must(await sb.from('project_budget_lines').insert(part).select('id')) ?? []).length
      }
      let count = 0
      for (let i = 0; i < rows.length; i += 500) {
        const part = rows.slice(i, i + 500).map(r => strip(r, READONLY))
        count += (must(await sb.from('payments').insert(part).select('id')) ?? []).length
      }
      return { payments: count, budgetLines: lines }
    },
    async listBudgetLines(projectId) {
      let q = sb.from('project_budget_lines').select('*')
      if (projectId) q = q.eq('project_id', projectId)
      return must(await q.order('sort_order').order('created_at')) as BudgetLine[]
    },
    saveBudgetLine: b => save('project_budget_lines', b) as Promise<BudgetLine>,
    deleteBudgetLine: id => remove('project_budget_lines', id),

    async adminOverview() {
      return must(await sb.rpc('admin_overview')) as AdminOverview
    },
    async createMember(m) {
      const { data, error } = await sb.functions.invoke('admin-create-user', { body: m })
      if (error) {
        const ctx = (error as { context?: Response }).context
        let detail = ''
        try {
          detail = ctx ? ((await ctx.json()) as { error?: string }).error ?? '' : ''
        } catch {
          /* 본문 없음 */
        }
        if (ctx?.status === 404) throw new ApiError("팀원 추가 기능(Edge Function 'admin-create-user')이 아직 배포되지 않았습니다. README 의 '팀원 추가 기능 켜기'를 참고하거나 Supabase 대시보드에서 계정을 추가하세요.")
        throw new ApiError(detail || error.message)
      }
      if ((data as { error?: string })?.error) throw new ApiError((data as { error: string }).error)
    },
    async exportTable(table) {
      const out: Record<string, unknown>[] = []
      const page = 1000
      for (let from = 0; ; from += page) {
        const rows = must(await sb.from(table).select('*').range(from, from + page - 1)) as Record<string, unknown>[]
        out.push(...rows)
        if (rows.length < page) break
      }
      return out
    },
    async listAgentTokens() {
      return must(await sb.from('agent_tokens').select('id, name, profile_id, scopes, token_hint, created_by, created_at, last_used_at, revoked_at').order('created_at', { ascending: false })) as AgentToken[]
    },
    async createAgentToken(name, scopes, profileId) {
      return must(await sb.rpc('admin_create_agent_token', { p_name: name, p_scopes: scopes, p_profile_id: profileId })) as string
    },
    async revokeAgentToken(id) {
      mustAffect(await sb.from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id).select('id'))
    },

    async listResearch() {
      return must(await sb.from('research_items').select('*').order('created_at', { ascending: false }).limit(500)) as ResearchItem[]
    },
    saveResearch: r => save('research_items', r) as Promise<ResearchItem>,
    deleteResearch: id => remove('research_items', id),
    async listBrandContacts() {
      return must(await sb.from('brand_contacts').select('*').order('created_at', { ascending: false }).limit(2000)) as BrandContact[]
    },
    saveBrandContact: c => save('brand_contacts', c) as Promise<BrandContact>,
    deleteBrandContact: id => remove('brand_contacts', id),
    async importBrandContacts(rows) {
      const existing = must(await sb.from('brand_contacts').select('*').limit(5000)) as BrandContact[]
      const byEmail = new Map(existing.map(c => [c.email.toLowerCase(), c]))
      const res: ImportResult = { created: 0, merged: 0, skipped: 0 }
      for (const r of rows) {
        const email = r.email?.trim().toLowerCase()
        if (!email || !r.brand_name?.trim()) {
          res.skipped++
          continue
        }
        const prev = byEmail.get(email)
        if (prev) {
          // 비어 있는 칸만 채움 (상태·수신거부는 건드리지 않음)
          const patch: Record<string, unknown> = {}
          for (const k of ['contact_name', 'title', 'phone', 'source_url', 'source_note', 'memo'] as const) if (!prev[k] && r[k]) patch[k] = r[k]
          if (Object.keys(patch).length) mustAffect(await sb.from('brand_contacts').update(patch).eq('id', prev.id).select('id'))
          res.merged++
        } else {
          const created = must(await sb.from('brand_contacts').insert({ ...strip(r, READONLY), email }).select().single()) as BrandContact
          byEmail.set(email, created)
          res.created++
        }
      }
      return res
    },
    async listTemplates() {
      return must(await sb.from('email_templates').select('*').order('name')) as EmailTemplate[]
    },
    saveTemplate: t => save('email_templates', t) as Promise<EmailTemplate>,
    deleteTemplate: id => remove('email_templates', id),

    async listNotifications(limit = 40) {
      return must(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit)) as AppNotification[]
    },
    async markNotificationsRead(ids) {
      let q = sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
      if (ids !== 'all') q = q.in('id', ids)
      must(await q.select('id'))
    },
    async runReminders() {
      const { data, error } = await sb.rpc('notify_due_tasks')
      if (error) return 0 // 0004 미적용 등: 알람은 서버 예약 작업에 맡김
      return Number(data) || 0
    },
  }
}
