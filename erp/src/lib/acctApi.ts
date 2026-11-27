import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { AcctApi, AcctSettings, MonthClose, TaxEvent } from './acct'
import { todayKey } from './date'

const fail = (e: { message: string; code?: string } | null) => {
  if (!e) return
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(e.code ?? '')) throw new ApiError('세무 · 결산 서버를 준비 중입니다. 잠시 뒤 다시 열어 주세요.')
  if (e.code === '42501') throw new ApiError('관리자만 볼 수 있습니다.')
  throw new ApiError(e.message)
}

export function createSupabaseAcctApi(sb: SupabaseClient): AcctApi {
  return {
    async acctTaxCalendar(from, to) {
      const r = await sb.rpc('acct_tax_calendar', { p_from: from, p_to: to })
      fail(r.error)
      return (r.data ?? []) as TaxEvent[]
    },
    async acctTaxMark(company, key, done, memo = null) {
      fail((await sb.rpc('acct_tax_mark', { p_company: company, p_key: key, p_done: done, p_memo: memo })).error)
    },
    async listAcctSettings() {
      const r = await sb.from('acct_settings').select('*').order('company')
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []) as AcctSettings[]
    },
    async saveAcctSettings(company, patch) {
      const me = (await sb.auth.getUser()).data.user?.id ?? null
      const now = new Date().toISOString()
      fail((await sb.from('acct_settings').update({ ...patch, confirmed_at: now, confirmed_by: me, updated_at: now }).eq('company', company)).error)
    },
    async listAcctHolidays() {
      const r = await sb.from('acct_holidays').select('day,name').order('day')
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []) as { day: string; name: string }[]
    },
    async listMonthClose() {
      const r = await sb.from('acct_month_close').select('*').order('month', { ascending: false })
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []) as MonthClose[]
    },
    async saveMonthClose(row) {
      const me = (await sb.auth.getUser()).data.user?.id ?? null
      const now = new Date().toISOString()
      const body: Record<string, unknown> = row.closed
        ? { company: row.company, month: row.month, closed: true, closed_at: now, closed_by: me, snapshot: row.snapshot ?? {}, note: row.note ?? null, reopened_at: null, reopened_by: null, updated_at: now }
        : { company: row.company, month: row.month, closed: false, reopened_at: now, reopened_by: me, note: row.note ?? null, updated_at: now }
      fail((await sb.from('acct_month_close').upsert(body, { onConflict: 'company,month' })).error)
    },
  }
}

/**
 * 체험 모드: 세무 일정 · 설정 · 마감 기록을 두지 않는다 (지어낸 회계 자료 금지).
 * 화면 확인은 개발 서버 VITE_ACCT_HARNESS=1 에서만 — 지어낸 [시험] 일정 (배포 묶음에는 없음).
 */
export function createDemoAcctApi(): AcctApi {
  const harness = import.meta.env?.DEV && import.meta.env?.VITE_ACCT_HARNESS === '1'
  let closes: MonthClose[] = []
  const marks = new Map<string, boolean>()
  let settings: AcctSettings[] | null = null
  const loadSettings = async () => (settings ??= harness ? (await import('../dev/acctHarness')).HARNESS_SETTINGS.map(s => ({ ...s })) : [])
  return {
    async acctTaxCalendar(from, to) {
      if (!harness) return []
      const list = (await import('../dev/acctHarness')).harnessTaxEvents(todayKey())
      return list.filter(e => e.due_date >= from && e.due_date <= to).map(e => ({ ...e, done: marks.get(`${e.company}|${e.task_key}`) ?? e.done }))
    },
    async acctTaxMark(company, key, done) {
      if (!harness) throw new ApiError('체험 모드에서는 세무 일정을 고칠 수 없습니다.')
      marks.set(`${company}|${key}`, done)
    },
    async listAcctSettings() {
      return clone(await loadSettings())
    },
    async saveAcctSettings(company, patch) {
      if (!harness) throw new ApiError('체험 모드에서는 회계 설정을 고칠 수 없습니다.')
      const list = await loadSettings()
      settings = list.map(s => (s.company === company ? { ...s, ...patch, confirmed_at: new Date().toISOString() } : s))
    },
    async listAcctHolidays() {
      return harness ? (await import('../dev/acctHarness')).HARNESS_HOLIDAYS : []
    },
    async listMonthClose() {
      return clone(closes)
    },
    async saveMonthClose(row) {
      if (!harness) throw new ApiError('체험 모드에서는 월 마감을 기록하지 않습니다.')
      const now = new Date().toISOString()
      const prev = closes.find(c => c.company === row.company && c.month === row.month)
      const next: MonthClose = row.closed
        ? { company: row.company, month: row.month, closed: true, closed_at: now, closed_by: null, snapshot: row.snapshot ?? {}, note: row.note ?? null, reopened_at: null, updated_at: now }
        : { ...(prev ?? { company: row.company, month: row.month, closed_at: null, closed_by: null, snapshot: {}, note: null }), closed: false, reopened_at: now, updated_at: now }
      closes = [next, ...closes.filter(c => !(c.company === row.company && c.month === row.month))]
    },
  }
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
