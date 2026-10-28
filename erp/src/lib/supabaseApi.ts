import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { LedgerStatus } from './types'
import { ApiError, CHAT_FILE_MAX, EXCHANGE_FILE_MAX, groupIps, type AgentDraft, type Api, type DriveEnsureResult, type DriveFolder, type DriveStatus, type ImportResult } from './api'
import { desktop } from './desktop'
import type {
  SavedItem,
  Subscription,
  ExchangeFile,
  ProjectDriveFile,
  DriveIndexFile,
  AiAgent,
  AgentSchedule,
  ApprovalActivity,
  ProjectContact,
  ProjectMember,
  AttendanceDevice,
  AccessLog,
  AttendanceCheckin,
  AttendanceMonthRow,
  DecideStatus,
  Department,
  WorkPlan,
  Note,
  AdminOverview,
  AgentToken,
  AppNotification,
  Approval,
  ApprovalRoute,
  BrandContact,
  BudgetLine,
  Attendance,
  HrRecord,
  LeaveRecord,
  AgentInstruction,
  AgentActionLog,
  ChatMessage,
  ChatRead,
  ChatRoom,
  ChatRoomSummary,
  Client,
  Contact,
  EmailTemplate,
  Payment,
  Profile,
  Project,
  ProjectFinance,
  AdCampaign,
  AdCreative,
  AdReport,
  AdDaily,
  SeoCheck,
  AgentJob,
  AgentJobRequest,
  AgentReport,
  ReportTemplate,
  ResearchItem,
  Task,
  WorkLog,
  SiteLog,
  MeetingRecording,
  LedgerEntry,
  LedgerRecurring,
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

  /** Supabase 기본 1,000줄 제한을 넘어 전부 읽기 (정렬은 build 에서) */
  async function pageAll<T>(build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<T[]> {
    const out: T[] = []
    const size = 1000
    for (let from = 0; ; from += size) {
      const rows = must((await build().range(from, from + size - 1)) as never) as T[]
      out.push(...rows)
      if (rows.length < size) return out
    }
  }

  /** 회사 구글 드라이브 함수 호출: 연결 안 됨(409)은 null */
  const invokeDrive = async <T,>(payload: object): Promise<T | null> => {
    const { data, error } = await sb.functions.invoke('gdrive', { body: payload })
    if (error) {
      const ctx = (error as { context?: Response }).context
      let body: { error?: string; not_connected?: boolean } = {}
      try {
        body = ctx ? await ctx.json() : {}
      } catch {
        /* 본문 없음 */
      }
      if (body.not_connected || ctx?.status === 404) return null
      throw new ApiError(body.error || error.message)
    }
    return data as T
  }

  /** 관리자 Edge Function 호출 (팀원 추가 · 비밀번호 재설정) */
  const invokeAdminFn = async (payload: object): Promise<{ id?: string } | null> => {
    const { data, error } = await sb.functions.invoke('admin-create-user', { body: payload })
    if (error) {
      const ctx = (error as { context?: Response }).context
      let detail = ''
      try {
        detail = ctx ? ((await ctx.json()) as { error?: string }).error ?? '' : ''
      } catch {
        /* 본문 없음 */
      }
      if (ctx?.status === 404) throw new ApiError("팀원 관리 기능(Edge Function 'admin-create-user')이 아직 배포되지 않았습니다. README 의 '팀원 추가 기능 켜기'를 참고하세요.")
      throw new ApiError(detail || error.message)
    }
    if ((data as { error?: string })?.error) throw new ApiError((data as { error: string }).error)
    return (data as { id?: string } | null) ?? null
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
      if (!clientId) return must(await sb.from('contacts').select('*').limit(5000)) as Contact[]
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
      if (f.from) q = q.gte('log_date', f.from)
      if (f.to) q = q.lte('log_date', f.to)
      if (f.q?.trim()) q = q.ilike('content', `%${f.q.trim().replace(/[%_]/g, '')}%`)
      if (f.userId) q = q.eq('user_id', f.userId)
      if (f.clientId) q = q.eq('client_id', f.clientId)
      if (f.projectId) q = q.eq('project_id', f.projectId)
      if (f.contactId) q = q.eq('contact_id', f.contactId)
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
      // v3 는 알림 단계 · 멘션 수까지, v2 는 1:1 대화 멤버(members)까지. 아직 없는 DB 면 예전 함수로
      const v3 = await sb.rpc('chat_room_summaries_v3')
      if (!v3.error) return v3.data as ChatRoomSummary[]
      const v2 = await sb.rpc('chat_room_summaries_v2')
      if (!v2.error) return v2.data as ChatRoomSummary[]
      return must(await sb.rpc('chat_room_summaries')) as ChatRoomSummary[]
    },
    async listSaved() {
      return must(await sb.from('saved_items').select('*').is('done_at', null).order('created_at', { ascending: false }).limit(200)) as SavedItem[]
    },
    async saveForLater(item) {
      return must(await sb.from('saved_items').insert({ ...item, preview: item.preview.slice(0, 300) || '메시지' }).select().single()) as SavedItem
    },
    async finishSaved(id) {
      must(await sb.from('saved_items').update({ done_at: new Date().toISOString() }).eq('id', id))
    },
    async setRoomLevel(roomId, level) {
      const { data } = await sb.auth.getUser()
      must(await sb.from('chat_room_prefs').upsert({ user_id: data.user?.id, room_id: roomId, level, updated_at: new Date().toISOString() }))
    },
    async sendCard(roomId, content, card) {
      return must(await sb.from('chat_messages').insert({ room_id: roomId, content, attachment: { card, name: card.title || '카드' } }).select().single()) as ChatMessage
    },
    async createRoom(r) {
      return must(await sb.from('chat_rooms').insert(r).select().single()) as ChatRoom
    },
    deleteRoom: id => remove('chat_rooms', id),
    async openDm(otherId) {
      return must(await sb.rpc('chat_open_dm', { p_other: otherId })) as string
    },
    async listMessages(roomId, limit = 150) {
      const rows = must(await sb.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(limit)) as ChatMessage[]
      return rows.reverse()
    },
    async sendMessage(roomId, content, parentId) {
      return must(await sb.from('chat_messages').insert({ room_id: roomId, content, ...(parentId ? { parent_id: parentId } : {}) }).select().single()) as ChatMessage
    },
    async reactMessage(id, emoji) {
      return (must(await sb.rpc('chat_react', { p_message: id, p_emoji: emoji })) ?? {}) as Record<string, string[]>
    },
    async sendFile(roomId, file, caption) {
      if (file.size > CHAT_FILE_MAX) throw new ApiError('파일은 20MB 까지 보낼 수 있습니다.')
      // 저장소 경로는 영문만: 원래 이름은 메시지에 남김
      const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase()
      const path = `${roomId}/${crypto.randomUUID()}/file${ext}`
      const type = file.type || 'application/octet-stream'
      const up = await sb.storage.from('chat-files').upload(path, file, { contentType: type, upsert: false })
      if (up.error) throw new ApiError(`파일을 올리지 못했습니다: ${up.error.message}`)
      const attachment = { path, name: file.name, size: file.size, type }
      const res = await sb.from('chat_messages').insert({ room_id: roomId, content: caption?.trim() || `📎 ${file.name}`, attachment }).select().single()
      if (res.error) {
        await sb.storage.from('chat-files').remove([path])
        throw new ApiError(res.error.message)
      }
      return res.data as ChatMessage
    },
    async fileUrl(att, download) {
      const r = await sb.storage.from('chat-files').createSignedUrl(att.path, 60 * 60, download ? { download: att.name } : undefined)
      if (r.error || !r.data) throw new ApiError('파일을 열 수 없습니다.')
      return r.data.signedUrl
    },
    deleteMessage: id => remove('chat_messages', id),
    async editMessage(id, content) {
      return must(await sb.from('chat_messages').update({ content }).eq('id', id).select().single()) as ChatMessage
    },
    async markRead(roomId) {
      must(await sb.from('chat_reads').upsert({ room_id: roomId, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,room_id' }))
    },
    async pushPublicKey() {
      const { data, error } = await sb.functions.invoke('send-push', { body: { action: 'public-key' } })
      if (error) throw new ApiError('알림 서버에 연결하지 못했습니다.')
      return (data as { publicKey?: string } | null)?.publicKey ?? null
    },
    async pushSubscribe(s) {
      must(await sb.rpc('push_subscribe', { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth, p_user_agent: s.userAgent ?? null }))
    },
    async calendarFeedUrl(reset = false) {
      const token = must(await sb.rpc('calendar_feed_token', { p_reset: reset })) as unknown as string
      return `${url.replace(/\/$/, '')}/functions/v1/calendar-feed?t=${token}`
    },
    async pushUnsubscribe(endpoint) {
      must(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint))
    },
    async listRoomReads(roomId) {
      return must(await sb.from('chat_reads').select('user_id, room_id, last_read_at').eq('room_id', roomId)) as ChatRead[]
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

    subscribeAgentDrafts(roomId, cb) {
      // 비공개 방송: 이 방을 볼 수 있는 사람만 받음 (realtime.messages 정책 0062)
      const ch = sb
        .channel(`agent:${roomId}`, { config: { private: true } })
        .on('broadcast', { event: 'draft' }, ({ payload }) => cb(payload as AgentDraft))
        .subscribe()
      return () => {
        sb.removeChannel(ch)
      }
    },

    async listApprovals() {
      const rows = must(
        await sb
          .from('approvals')
          .select('*, can_decide, approval_activity(count)')
          .in('approval_activity.kind', ['댓글', '진행', '결과', 'AI 답변'])
          .order('created_at', { ascending: false })
          .limit(300),
      ) as (Approval & { approval_activity?: { count: number }[] })[]
      return rows.map(({ approval_activity, ...a }) => ({ ...a, activity_count: approval_activity?.[0]?.count ?? 0 }))
    },
    async listApprovalActivity(approvalId) {
      return must(await sb.from('approval_activity').select('*').eq('approval_id', approvalId).order('created_at').order('id')) as ApprovalActivity[]
    },
    async addApprovalActivity(approvalId, kind, body) {
      const text = body.trim()
      if (!text) throw new ApiError('내용을 적어 주세요.')
      return must(await sb.from('approval_activity').insert({ approval_id: approvalId, kind, body: text.slice(0, 4000) }).select().single()) as ApprovalActivity
    },
    removeApprovalActivity: async id => {
      must(await sb.from('approval_activity').delete().eq('id', id))
    },
    async createApproval(a) {
      return must(await sb.from('approvals').insert(strip(a, READONLY)).select('*, can_decide').single()) as Approval
    },
    async decideApproval(id, status, comment) {
      // 반려는 대기 · 승인(나중에 반려) 모두 가능, 승인은 대기만
      mustAffect(await sb.from('approvals').update({ status, decision_comment: comment || null }).eq('id', id).in('status', status === '반려' ? ['대기', '승인'] : ['대기']).select('id'))
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
    // ---------- 입출금 장부 (서버가 관리자 + 잠금 해제 여부를 확인) ----------
    async ledgerStatus() {
      return must(await sb.rpc('ledger_status')) as LedgerStatus
    },
    async ledgerSetPassword(oldPw, newPw) {
      must(await sb.rpc('ledger_set_password', { p_old: oldPw, p_new: newPw }))
    },
    async ledgerUnlock(pw) {
      return must(await sb.rpc('ledger_unlock', { p_password: pw })) as string
    },
    async ledgerLock() {
      await sb.rpc('ledger_lock')
    },
    async ledgerTouch() {
      const { data } = await sb.rpc('ledger_touch')
      return (data as string | null) ?? null
    },
    async listLedger(from, to) {
      return must(await sb.from('cash_ledger').select('*').gte('entry_date', from).lte('entry_date', to).order('entry_date', { ascending: false }).order('id', { ascending: false })) as LedgerEntry[]
    },
    async saveLedger(e) {
      const body = strip(e, READONLY) as Record<string, unknown>
      delete body.created_by
      const q = e.id ? sb.from('cash_ledger').update(body).eq('id', e.id) : sb.from('cash_ledger').insert(body)
      return must(await q.select().single()) as LedgerEntry
    },
    async deleteLedger(id) {
      mustAffect(await sb.from('cash_ledger').delete().eq('id', id).select('id'))
    },
    async listRecurring() {
      return must(await sb.from('cash_recurring').select('*').order('day_of_month').order('name')) as LedgerRecurring[]
    },
    async saveRecurring(r) {
      const body = strip(r, READONLY) as Record<string, unknown>
      delete body.created_by
      const q = r.id ? sb.from('cash_recurring').update(body).eq('id', r.id) : sb.from('cash_recurring').insert(body)
      return must(await q.select().single()) as LedgerRecurring
    },
    async deleteRecurring(id) {
      mustAffect(await sb.from('cash_recurring').delete().eq('id', id).select('id'))
    },
    async listSubscriptions() {
      const { data, error } = await sb.from('subscriptions').select('*').order('status').order('next_billing', { ascending: true, nullsFirst: false }).order('name')
      return error ? [] : (data as Subscription[])
    },
    saveSubscription: s => save('subscriptions', s) as Promise<Subscription>,
    deleteSubscription: id => remove('subscriptions', id),
    async startMeetingMinutes(audio, meta) {
      const { data: u } = await sb.auth.getUser()
      if (!u.user) throw new ApiError('로그인이 필요합니다.')
      if (audio.size > 200 * 1024 * 1024) throw new ApiError('녹음은 200MB 까지 올릴 수 있습니다.')
      // 받아쓰기 텍스트(.txt · .md)도 받음 (회의록 AI v3: 클로바노트 텍스트 → 회의록). 종류가 비어 있으면 이름으로 판단
      const isText = /\.(txt|md)$/i.test(meta.filename ?? '') || audio.type.startsWith('text/')
      if (isText && audio.size > 5 * 1024 * 1024) throw new ApiError('받아쓰기 텍스트는 5MB 까지 올릴 수 있습니다.')
      const mime = isText ? (/\.md$/i.test(meta.filename ?? '') ? 'text/markdown' : 'text/plain') : (audio.type || 'audio/webm').split(';')[0]
      const ext = meta.filename?.match(/\.[A-Za-z0-9]{2,5}$/)?.[0]?.toLowerCase() ?? (mime.includes('mp4') || mime.includes('m4a') ? '.m4a' : mime.includes('mpeg') ? '.mp3' : mime.includes('wav') ? '.wav' : '.webm')
      const path = `${u.user.id}/${crypto.randomUUID()}${ext}`
      const up = await sb.storage.from('meeting-audio').upload(path, audio, { contentType: mime, upsert: false })
      if (up.error) throw new ApiError(`녹음을 올리지 못했습니다: ${up.error.message}`)
      const rec = must(await sb.from('meeting_recordings').insert({ title: meta.title || null, attendees: meta.attendees || null, duration_sec: meta.duration_sec ?? null, audio_path: path, mime }).select('*').single()) as MeetingRecording
      const r = await sb.functions.invoke('meeting-minutes', { body: { id: rec.id } })
      if (r.error) throw new ApiError('AI 정리를 시작하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
      return { ...rec, status: '처리 중' }
    },
    async getMeetingRecording(id) {
      return (must(await sb.from('meeting_recordings').select('*').eq('id', id).maybeSingle()) as MeetingRecording | null) ?? null
    },
    async listSiteLogs(projectId) {
      return must(await sb.from('site_logs').select('*').eq('project_id', projectId).order('log_date', { ascending: false })) as SiteLog[]
    },
    async saveSiteLog(l) {
      try {
        return (await save('site_logs', { ...l, updated_at: new Date().toISOString() })) as SiteLog
      } catch (e) {
        if (String((e as Error)?.message ?? e).includes('duplicate')) throw new ApiError('그 날짜의 작업일지가 이미 있습니다.')
        throw e
      }
    },
    deleteSiteLog: id => remove('site_logs', id),
    async uploadSitePhoto(projectId, file) {
      if (file.size > 15 * 1024 * 1024) throw new ApiError('사진은 15MB 까지 올릴 수 있습니다.')
      const ext = (file.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? '.jpg').toLowerCase()
      const path = `${projectId}/${crypto.randomUUID()}${ext}`
      const up = await sb.storage.from('site-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
      if (up.error) throw new ApiError(`사진을 올리지 못했습니다: ${up.error.message}`)
      const signed = await sb.storage.from('site-photos').createSignedUrl(path, 60 * 60 * 24 * 30)
      return { path, url: signed.data?.signedUrl ?? '' }
    },
    async sitePhotoUrl(path) {
      const r = await sb.storage.from('site-photos').createSignedUrl(path, 60 * 60)
      if (r.error || !r.data) throw new ApiError('사진을 열 수 없습니다.')
      return r.data.signedUrl
    },
    async listPayments(filter = {}) {
      const read = (table: string) =>
        pageAll<Payment>(() => {
          let q = sb.from(table).select('*')
          if (filter.projectId) q = q.eq('project_id', filter.projectId)
          if (filter.clientId) q = q.eq('client_id', filter.clientId)
          return q.order('due_date', { nullsFirst: false }).order('created_at').order('id')
        })
      // 관리자는 원본(계좌 포함), 구성원은 계좌 · 예금주를 비운 공개 보기
      const rows = await read('payments')
      return rows.length ? rows : read('payments_shared')
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
      return pageAll<BudgetLine>(() => {
        let q = sb.from('project_budget_lines').select('*')
        if (projectId) q = q.eq('project_id', projectId)
        return q.order('sort_order').order('created_at').order('id')
      })
    },
    saveBudgetLine: b => save('project_budget_lines', b) as Promise<BudgetLine>,
    deleteBudgetLine: id => remove('project_budget_lines', id),

    async adminOverview() {
      return must(await sb.rpc('admin_overview')) as AdminOverview
    },
    async createMember(m) {
      await invokeAdminFn(m)
    },
    async listAiAgents() {
      return must(await sb.from('ai_agents').select('*')) as AiAgent[]
    },
    async createAiAgent(a) {
      // 로그인하지 않는 AI 계정: 임의 주소 · 긴 임의 비밀번호 (어디에도 보이지 않음)
      const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('')
      const r = await invokeAdminFn({ email: `ai-${rand(5)}@ai.thewklyn.com`, password: rand(24), name: a.name.trim(), title: a.title?.trim() || null, role: 'member', is_agent: true })
      if (!r?.id) throw new ApiError('AI 팀원 계정을 만들지 못했습니다.')
      must(await sb.from('ai_agents').upsert({ profile_id: r.id, role: a.role, instructions: a.instructions, tools: a.tools, owner_id: a.owner_id, model: a.model }))
      return r.id
    },
    async saveAiAgent(profileId, patch) {
      must(await sb.from('ai_agents').upsert({ profile_id: profileId, ...patch }))
    },
    async listAgentSchedules() {
      return must(await sb.from('agent_schedules').select('*').order('enabled', { ascending: false }).order('next_run_at', { ascending: true, nullsFirst: false }).limit(300)) as AgentSchedule[]
    },
    async saveAgentSchedule(s) {
      const body = strip(s as Record<string, unknown>, ['next_run_at', 'last_run_at', 'last_instruction_id', 'runs', 'created_at', 'updated_at', 'created_by'])
      if (s.id) return must(await sb.from('agent_schedules').update(body).eq('id', s.id).select().single()) as AgentSchedule
      return must(await sb.from('agent_schedules').insert(body).select().single()) as AgentSchedule
    },
    deleteAgentSchedule: id => remove('agent_schedules', id),
    async resetMemberPassword(userId, password) {
      await invokeAdminFn({ action: 'reset_password', user_id: userId, password })
    },
    async deleteMember(userId) {
      await invokeAdminFn({ action: 'delete_user', user_id: userId })
    },
    async getHrRecord(profileId) {
      const { data, error } = await sb.from('hr_records').select('*').eq('profile_id', profileId).maybeSingle()
      // 표가 없을 때(0006 미적용)만 빈 기록. 그 밖의 오류는 던져서 빈 양식으로 덮어쓰지 않게
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return null
        throw new ApiError(error.message)
      }
      return data as HrRecord | null
    },
    async listHrRecords() {
      const { data, error } = await sb.from('hr_records').select('*')
      if (error) return []
      return data as HrRecord[]
    },
    async saveHrRecord(r) {
      must(await sb.from('hr_records').upsert(strip(r, ['updated_at', 'updated_by'])).select('profile_id'))
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
    async listAgentJobs() {
      const r = await sb.from('agent_jobs').select('*').eq('removed', false).order('group_name').order('name')
      return r.error ? [] : (r.data as AgentJob[])
    },
    async listAgentReports(from, to) {
      const r = await sb.from('agent_reports').select('*').gte('report_date', from).lte('report_date', to).order('report_date', { ascending: false }).order('run_at', { ascending: false, nullsFirst: false }).limit(1000)
      return r.error ? [] : (r.data as AgentReport[])
    },
    async listAgentJobRequests() {
      const r = await sb.from('agent_job_requests').select('*').order('created_at', { ascending: false }).limit(100)
      return r.error ? [] : (r.data as AgentJobRequest[])
    },
    async requestAgentJob(req) {
      must(await sb.from('agent_job_requests').insert({ trigger_id: req.trigger_id, action: req.action, detail: req.detail ?? null }))
    },
    async cancelAgentJobRequest(id) {
      must(await sb.from('agent_job_requests').delete().eq('id', id))
    },
    async listAdDaily(from, to) {
      const r = await sb.from('ad_daily').select('*').gte('date', from).lte('date', to).order('date').limit(5000)
      return r.error ? [] : (r.data as AdDaily[])
    },
    async listAdCampaigns() {
      const r = await sb.from('ad_campaigns').select('*').order('platform').order('campaign')
      return r.error ? [] : (r.data as AdCampaign[])
    },
    async listAdCreatives() {
      const r = await sb.from('ad_creatives').select('*').order('side').order('updated_at', { ascending: false }).limit(1000)
      return r.error ? [] : (r.data as AdCreative[])
    },
    async listAdReports() {
      const r = await sb.from('ad_reports').select('*').order('report_date', { ascending: false }).order('created_at', { ascending: false }).limit(300)
      return r.error ? [] : (r.data as AdReport[])
    },
    async listSeoChecks() {
      const r = await sb.from('seo_checks').select('*').order('checked_on', { ascending: false }).limit(1000)
      return r.error ? [] : (r.data as SeoCheck[])
    },
    async listReportTemplates() {
      const r = await sb.from('report_templates').select('*').order('is_default', { ascending: false }).order('updated_at', { ascending: false })
      return r.error ? [] : (r.data as ReportTemplate[])
    },
    saveReportTemplate: t => save('report_templates', t) as Promise<ReportTemplate>,
    deleteReportTemplate: id => remove('report_templates', id),
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
        if (!email || !r.brand_name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
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
      if (!(await sb.auth.getSession()).data.session) return 0 // 로그인 만료 · 잠금 화면: 서버 예약 작업에 맡김
      const { data, error } = await sb.rpc('notify_due_tasks')
      if (error) return 0 // 0004 미적용 등: 알람은 서버 예약 작업에 맡김
      return Number(data) || 0
    },

    async touchAttendance(source) {
      // 회사 인터넷 + 등록된 회사 PC 에서만 출근 (0027). PC 프로그램 1.2+ 는 기기 ID 를 함께 보냄
      if (!(await sb.auth.getSession()).data.session) return // 로그인 만료면 보내지 않음 (서버 401 방지)
      const { error } = await sb.rpc('touch_attendance_v3', { p_source: source, p_device: desktop()?.deviceId ?? null })
      if (!error) return
      const { error: e2 } = await sb.rpc('touch_attendance_v2', { p_source: source })
      if (e2) await sb.rpc('touch_attendance') // 0014 미적용
    },
    async punchAttendance(kind, source) {
      return must(await sb.rpc('attendance_punch', { p_kind: kind, p_source: source, p_device: desktop()?.deviceId ?? null })) as { kind: string; at: string }
    },
    async listNotes() {
      const { data, error } = await sb.from('notes').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false })
      if (error) return [] // 0016 미적용
      return data as Note[]
    },
    async saveNote(n) {
      const row = { content: n.content, ...(n.pinned !== undefined ? { pinned: n.pinned } : {}), updated_at: new Date().toISOString() }
      if (n.id) return must(await sb.from('notes').update(row).eq('id', n.id).select().single()) as Note
      return must(await sb.from('notes').insert(row).select().single()) as Note
    },
    deleteNote: id => remove('notes', id),
    async listAccessLog(day) {
      const { data, error } = await sb.from('access_log').select('*').eq('day', day)
      if (error) return [] // 0014 미적용
      return data as AccessLog[]
    },
    async getDesktopOnly() {
      const { data } = await sb.from('app_settings').select('value').eq('key', 'attendance_desktop_only').maybeSingle()
      return data?.value === true
    },
    async setDesktopOnly(on) {
      must(await sb.rpc('set_app_setting', { p_key: 'attendance_desktop_only', p_value: on }))
    },
    async listAttendance(day) {
      return must(await sb.from('attendance').select('*').eq('day', day)) as Attendance[]
    },
    async listLeave() {
      const { data, error } = await sb.from('leave_records').select('*').order('start_date', { ascending: false })
      if (error) return [] // 0007 미적용
      return (data as LeaveRecord[]).map(r => ({ ...r, days: Number(r.days) }))
    },
    async createLeave(r) {
      must(await sb.from('leave_records').insert({ ...r, status: r.status ?? '신청' }).select('id'))
    },
    async decideLeave(id, status) {
      mustAffect(await sb.from('leave_records').update({ status }).eq('id', id).select('id'))
    },
    deleteLeave: id => remove('leave_records', id),
    async listAgentInstructions() {
      const { data, error } = await sb.from('agent_instructions').select('*').order('created_at', { ascending: false }).limit(50)
      if (error) return [] // 0007 미적용
      return data as AgentInstruction[]
    },
    async instructAgent(agentId, instruction) {
      const { data } = await sb.auth.getSession()
      const rows = must(await sb.from('agent_instructions').insert({ agent_id: agentId, instruction, created_by: data.session?.user.id }).select('id')) as { id: string }[]
      return rows[0].id
    },
    deleteAgentInstruction: id => remove('agent_instructions', id),
    async listAgentActions() {
      const { data, error } = await sb.from('agent_actions').select('*').order('created_at', { ascending: false }).limit(100)
      if (error) return [] // 0042 미적용
      return data as AgentActionLog[]
    },
    async listAttendanceFor(userId, fromDay) {
      return must(await sb.from('attendance').select('*').eq('user_id', userId).gte('day', fromDay).order('day', { ascending: false })) as Attendance[]
    },
    async listDepartments() {
      const { data, error } = await sb.from('departments').select('*').order('sort').order('name')
      return error ? [] : (data as Department[])
    },
    async saveDepartment(d) {
      const row = { name: d.name, duties: d.duties ?? null, lead_id: d.lead_id ?? null, member_ids: d.member_ids ?? [], agent_groups: d.agent_groups ?? [], sort: d.sort ?? 0, updated_at: new Date().toISOString() }
      if (d.id) mustAffect(await sb.from('departments').update(row).eq('id', d.id).select('id'))
      else must(await sb.from('departments').insert(row).select('id'))
    },
    deleteDepartment: id => remove('departments', id),
    async listWorkPlans(fromDay) {
      const { data, error } = await sb.from('work_plans').select('*').gte('day', fromDay).order('day')
      return error ? [] : (data as WorkPlan[])
    },
    async requestWorkPlan(p) {
      must(await sb.from('work_plans').insert({ day: p.day, kind: p.kind, place: p.place || null, reason: p.reason || null }).select('id'))
    },
    cancelWorkPlan: id => remove('work_plans', id),
    async decideWorkPlan(id, status) {
      must(await sb.rpc('decide_work_plan', { p_id: id, p_status: status }))
    },
    async listCheckins(day) {
      const { data, error } = await sb.from('attendance_checkins').select('*').eq('day', day)
      return error ? [] : (data as AttendanceCheckin[])
    },
    async mobileCheckIn(c) {
      const r = must(await sb.rpc('mobile_check_in', { p_kind: c.kind, p_note: c.note || null, p_lat: c.lat ?? null, p_lng: c.lng ?? null, p_accuracy: c.accuracy == null ? null : Math.round(c.accuracy) })) as { status: DecideStatus; already: boolean }
      return r
    },
    async decideCheckin(id, status) {
      must(await sb.rpc('decide_checkin', { p_id: id, p_status: status }))
    },
    async getAttendanceRules() {
      const { data } = await sb.from('app_settings').select('key, value').in('key', ['work_start', 'plan_deadline'])
      const get = (k: string, d: string) => (data?.find(r => r.key === k)?.value as string | undefined) ?? d
      return { workStart: get('work_start', '10:00'), planDeadline: get('plan_deadline', '18:00') }
    },
    async setAttendanceRule(key, value) {
      must(await sb.rpc('set_app_setting', { p_key: key, p_value: value }))
    },
    async listProjectContacts(f) {
      let q = sb.from('project_contacts').select('*')
      if (f.projectId) q = q.eq('project_id', f.projectId)
      if (f.contactId) q = q.eq('contact_id', f.contactId)
      const { data, error } = await q
      return error ? [] : (data as ProjectContact[])
    },
    async linkProjectContact(projectId, contactId, role) {
      must(await sb.from('project_contacts').upsert({ project_id: projectId, contact_id: contactId, role: role?.trim() || null }).select('project_id'))
    },
    async unlinkProjectContact(projectId, contactId) {
      must(await sb.from('project_contacts').delete().eq('project_id', projectId).eq('contact_id', contactId).select('project_id'))
    },
    async listProjectMembers(projectId) {
      const { data, error } = await sb.from('project_members').select('*').eq('project_id', projectId).order('created_at')
      return error ? [] : (data as ProjectMember[]) // 0050 미적용
    },
    async addProjectMember(projectId, profileId, role) {
      must(await sb.from('project_members').upsert({ project_id: projectId, profile_id: profileId, role: role?.trim() || null }).select('project_id'))
    },
    async removeProjectMember(projectId, profileId) {
      must(await sb.from('project_members').delete().eq('project_id', projectId).eq('profile_id', profileId).select('project_id'))
    },
    async listExchangeFiles(f) {
      const ors = [f.clientId && `client_id.eq.${f.clientId}`, f.contactId && `contact_id.eq.${f.contactId}`, f.projectId && `project_id.eq.${f.projectId}`].filter(Boolean)
      if (!ors.length) return []
      const { data, error } = await sb.from('exchange_files').select('*').or(ors.join(',')).order('file_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
      return error ? [] : (data as ExchangeFile[])
    },
    async addExchangeFile(f) {
      let storage_path: string | null = null
      let name = f.name?.trim() || ''
      let size: number | null = null
      let mime: string | null = null
      if (f.file) {
        if (f.file.size > EXCHANGE_FILE_MAX) throw new ApiError('파일은 50MB 까지 올릴 수 있습니다.')
        const ext = (f.file.name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase()
        storage_path = `${crypto.randomUUID()}/file${ext}`
        mime = f.file.type || 'application/octet-stream'
        const up = await sb.storage.from('exchange-files').upload(storage_path, f.file, { contentType: mime, upsert: false })
        if (up.error) throw new ApiError(`파일을 올리지 못했습니다: ${up.error.message}`)
        name = name || f.file.name
        size = f.file.size
      }
      const url = f.url?.trim() || null
      if (!storage_path && !url) throw new ApiError('파일을 고르거나 링크를 넣어 주세요.')
      const row = { client_id: f.client_id, contact_id: f.contact_id ?? null, project_id: f.project_id ?? null, direction: f.direction, name: name || url!, url, storage_path, size, mime, note: f.note?.trim() || null, ...(f.file_date ? { file_date: f.file_date } : {}) }
      const res = await sb.from('exchange_files').insert(row).select('id')
      if (res.error) {
        if (storage_path) await sb.storage.from('exchange-files').remove([storage_path])
        throw new ApiError(res.error.message)
      }
    },
    async updateExchangeFile(id, patch) {
      const row = must(await sb.from('exchange_files').update(patch).eq('id', id).select('id')) as { id: string }[]
      if (!row.length) throw new ApiError('고칠 수 없습니다 (올린 사람 · 관리자만).')
    },
    async listProjectDriveFiles(projectId) {
      const { data, error } = await sb.from('project_drive_files').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
      if (error) return [] // 0045 미적용
      return data as ProjectDriveFile[]
    },
    async addProjectDriveFiles(projectId, files) {
      if (!files.length) return
      const { data } = await sb.auth.getSession()
      const rows = files.map(f => ({ ...f, project_id: projectId, added_by: data.session?.user.id }))
      must(await sb.from('project_drive_files').upsert(rows, { onConflict: 'project_id,drive_id', ignoreDuplicates: true }).select('id'))
    },
    async renameProjectDriveFile(id, patch) {
      mustAffect(await sb.from('project_drive_files').update(patch).eq('id', id).select('id'))
    },
    removeProjectDriveFile: id => remove('project_drive_files', id),
    async deleteExchangeFile(id) {
      const row = must(await sb.from('exchange_files').delete().eq('id', id).select('storage_path')) as { storage_path: string | null }[]
      if (!row.length) throw new ApiError('지울 수 없습니다 (올린 사람 · 관리자만).')
      if (row[0].storage_path) await sb.storage.from('exchange-files').remove([row[0].storage_path])
    },
    async exchangeFileUrl(f, download) {
      if (!f.storage_path) return f.url ?? ''
      const r = await sb.storage.from('exchange-files').createSignedUrl(f.storage_path, 60 * 60, download ? { download: f.name } : undefined)
      if (r.error || !r.data) throw new ApiError('파일을 열 수 없습니다.')
      return r.data.signedUrl
    },
    async getAccessInfo() {
      const { data, error } = await sb.rpc('my_access_info')
      if (error || !data) return { ip: null, office: true, officeIps: null, configured: false }
      const d = data as { ip: string | null; office: boolean; office_ips: string[] | null; configured: boolean }
      return { ip: d.ip, office: d.office, officeIps: d.office_ips, configured: d.configured }
    },
    async setOfficeIps(ips) {
      must(await sb.rpc('set_office_ips', { p_ips: ips }))
    },
    async listRecentDesktopIps() {
      const from = new Date(Date.now() - 14 * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10)
      const { data, error } = await sb.from('access_log').select('user_id, day, ip, last_at').eq('source', 'desktop').gte('day', from).not('ip', 'is', null)
      if (error) return []
      return groupIps(data as { user_id: string; day: string; ip: string; last_at: string }[])
    },
    async listAttendanceDevices() {
      const { data, error } = await sb.from('attendance_devices').select('*').order('last_seen', { ascending: false })
      return error ? [] : (data as AttendanceDevice[])
    },
    async deleteAttendanceDevice(userId, deviceId) {
      mustAffect(await sb.from('attendance_devices').delete().eq('user_id', userId).eq('device_id', deviceId).select('user_id'))
    },
    async getSearchCx() {
      const { data } = await sb.from('app_settings').select('value').eq('key', 'google_cse_cx').maybeSingle()
      return typeof data?.value === 'string' ? data.value : null
    },
    async setSearchCx(cx) {
      must(await sb.rpc('set_app_setting', { p_key: 'google_cse_cx', p_value: cx }))
    },
    async getDriveFolders() {
      const { data } = await sb.from('app_settings').select('value').eq('key', 'drive_folders').maybeSingle()
      return Array.isArray(data?.value) ? (data.value as DriveFolder[]) : []
    },
    async getGoogleClientId() {
      const { data } = await sb.from('app_settings').select('value').eq('key', 'google_oauth_client_id').maybeSingle()
      return typeof data?.value === 'string' ? data.value : null
    },
    async driveStatus() {
      return (await invokeDrive<DriveStatus>({ action: 'status' })) ?? { clientId: false, secret: false, connected: false, account: null }
    },
    async driveConnect(code) {
      const r = await invokeDrive<{ account: string | null }>({ action: 'connect', code })
      if (!r) throw new ApiError('연결하지 못했습니다.')
      return r
    },
    driveEnsure: projectId => invokeDrive<DriveEnsureResult>({ action: 'ensure', project_id: projectId }),
    async driveEnsureAll() {
      const r = await invokeDrive<{ made: number; fixed: number; fail: string[] }>({ action: 'ensure_all' })
      if (!r) throw new ApiError('회사 구글 계정이 아직 연결되지 않았습니다.')
      return r
    },
    async listDriveIndex(projectId) {
      let q = sb.from('drive_index').select('id,project_id,name,mime_type,parent_id,path,url,icon_url,size,modified_at,modified_by').order('modified_at', { ascending: false, nullsFirst: false })
      q = projectId ? q.eq('project_id', projectId).limit(2000) : q.limit(3000)
      return must(await q) as DriveIndexFile[]
    },
    driveAccessToken: () => invokeDrive<{ token: string; expires_at: number }>({ action: 'token' }),
    async driveSync(full) {
      const r = await invokeDrive<{ mode: 'full' | 'changes'; files: number; changed: number }>({ action: 'sync', full: !!full })
      if (!r) throw new ApiError('회사 구글 계정이 아직 연결되지 않았습니다.')
      return r
    },
    async setGoogleClientId(id) {
      must(await sb.rpc('set_app_setting', { p_key: 'google_oauth_client_id', p_value: id }))
    },
    async setDriveFolders(list) {
      must(await sb.rpc('set_app_setting', { p_key: 'drive_folders', p_value: list }))
    },
    async attendanceMonthSummary(month) {
      const { data, error } = await sb.rpc('attendance_month_summary', { p_month: `${month}-01` })
      return error ? [] : (data as AttendanceMonthRow[]).map(r => ({ ...r, leave_days: Number(r.leave_days) }))
    },
  }
}
