import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ApiError, type Api } from './api'
import type { Approval, ChatMessage, ChatRoom, ChatRoomSummary, Client, Contact, Profile, Project, Task, WorkLog } from './types'

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

const READONLY = ['id', 'created_at', 'updated_at', 'created_by', 'can_decide', 'completed_at', 'edited_at']

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
    subscribeChanges(tables, cb) {
      let ch = sb.channel(`changes-${tables.join('-')}-${Math.random().toString(36).slice(2)}`)
      for (const table of tables) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => cb())
      ch.subscribe()
      return () => {
        sb.removeChannel(ch)
      }
    },
  }
}
