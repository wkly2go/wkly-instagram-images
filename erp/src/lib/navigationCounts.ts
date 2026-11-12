import type { SupabaseClient } from '@supabase/supabase-js'

export interface NavigationCounts {
  myOpenTasks: number
  pendingToDecide: number
  saved: number
}

function exactCount(result: { count: number | null; error: { message: string } | null }, label: string): number {
  if (result.error) throw new Error(result.error.message || `${label} 건수를 불러오지 못했습니다.`)
  if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error(`${label} 건수를 확인하지 못했습니다. 다시 불러와 주세요.`)
  return result.count
}

/** Count on the server; task bodies, approval text and saved previews stay there. */
export async function readNavigationCounts(sb: SupabaseClient, viewer: { id: string; role: string }): Promise<NavigationCounts> {
  let approvals = sb.from('approvals').select('id', { count: 'exact', head: true }).eq('status', '대기').eq('can_decide', true)
  // requested_by can become null when a former member's profile is removed.
  if (viewer.role !== 'admin') approvals = approvals.or(`requested_by.is.null,requested_by.neq.${viewer.id}`)
  const [tasks, pending, saved] = await Promise.all([
    sb.from('tasks').select('id', { count: 'exact', head: true }).eq('assignee_id', viewer.id).neq('status', '완료'),
    approvals,
    sb.from('saved_items').select('id', { count: 'exact', head: true }).eq('user_id', viewer.id).is('done_at', null),
  ])
  // Keep compatibility with installations that predate saved_items; other failures stay visible.
  const savedTableMissing = saved.error && ['42P01', 'PGRST205'].includes(saved.error.code)
  return {
    myOpenTasks: exactCount(tasks, '내 할 일'),
    pendingToDecide: exactCount(pending, '대기 결제'),
    saved: savedTableMissing ? 0 : exactCount(saved, '나중에 보기'),
  }
}
