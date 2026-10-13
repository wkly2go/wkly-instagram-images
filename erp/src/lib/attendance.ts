import { useEffect } from 'react'
import { useApp, useAsync } from './app'
import { todayKey } from './date'
import type { Attendance, Profile, TodayStatus } from './types'

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
