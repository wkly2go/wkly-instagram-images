import { useEffect } from 'react'
import { useApp, useAsync } from './app'
import { todayKey } from './date'
import type { AccessLog, Attendance, Profile, TodayStatus } from './types'

/** 화면에 보이는 근태 상태: 오늘 접속 기록이 없으면 '미출근' (AI 팀원은 접속 개념이 없어 제외) */
export type Presence = TodayStatus | '미출근'

export function presenceOf(p: Profile, row: Attendance | undefined): Presence {
  if (p.is_agent) return p.today_status
  return row ? p.today_status : '미출근'
}

/** 특정 날짜 근태 기록 (user_id → 기록). 누가 접속하면 실시간으로 다시 불러옴 */
export function useAttendance(day: string = todayKey()) {
  const { api, version } = useApp()
  const { data, reload } = useAsync(() => api.listAttendance(day), [version, day], [] as Attendance[])
  useEffect(() => api.subscribeChanges(['attendance'], reload), [api, reload])
  return new Map(data.map(a => [a.user_id, a]))
}

/** 그날 경로별 접속 기록 (user_id → 기록 목록) */
export function useAccessLog(day: string = todayKey()) {
  const { api, version } = useApp()
  const { data, reload } = useAsync(() => api.listAccessLog(day), [version, day], [] as AccessLog[])
  useEffect(() => api.subscribeChanges(['access_log'], reload), [api, reload])
  const m = new Map<string, AccessLog[]>()
  for (const a of data) m.set(a.user_id, [...(m.get(a.user_id) ?? []), a])
  return m
}

/** 출근은 PC 프로그램에서만 인정하는지 (관리 설정) */
export function useDesktopOnly() {
  const { api, version } = useApp()
  return useAsync(() => api.getDesktopOnly(), [version], false)
}
