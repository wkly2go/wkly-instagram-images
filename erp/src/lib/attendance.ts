import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Api } from './api'
import { createSharedFeed } from './sharedFeed'
import { useApp, useAsync } from './app'
import { todayKey } from './date'
import type { AccessLog, Attendance, Profile, TodayStatus } from './types'

/** 화면에 보이는 근태 상태: 오늘 접속 기록이 없으면 '미출근' (AI 팀원은 접속 개념이 없어 제외) */
export type Presence = TodayStatus | '미출근'

export function presenceOf(p: Profile, row: Attendance | undefined): Presence {
  if (p.is_agent) return p.today_status
  return row ? p.today_status : '미출근'
}

type AttendanceFeed = ReturnType<typeof createSharedFeed<Attendance[]>>
const attendanceFeeds = new WeakMap<Api, Map<string, AttendanceFeed>>()

/** 근태 화면·사이드바가 사용자와 날짜별로 조회·구독을 공유한다. */
export function useAttendance(day: string = todayKey()) {
  const { api, me } = useApp()
  const feed = useMemo(() => {
    let feeds = attendanceFeeds.get(api)
    if (!feeds) { feeds = new Map(); attendanceFeeds.set(api, feeds) }
    const key = JSON.stringify([me.id, day])
    let shared = feeds.get(key)
    if (!shared) {
      shared = createSharedFeed<Attendance[]>({ initial: [], load: () => api.listAttendance(day),
        connect: changed => api.subscribeChanges(['attendance'], changed, `day=eq.${day}`),
        isVisible: () => document.visibilityState === 'visible',
        onVisibility: changed => {
          document.addEventListener('visibilitychange', changed)
          return () => document.removeEventListener('visibilitychange', changed)
        },
      })
      feeds.set(key, shared)
    }
    return shared
  }, [api, me.id, day])
  const data = useSyncExternalStore(feed.subscribe, feed.getSnapshot)
  return useMemo(() => new Map(data.map(a => [a.user_id, a])), [data])
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
