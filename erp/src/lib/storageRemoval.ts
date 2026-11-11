import type { SupabaseClient } from '@supabase/supabase-js'

type RemovalResult = { error: { message: string } | null }

function isMissingObject(error: { message: string; status?: number; statusCode?: string; code?: string }): boolean {
  return error.status === 404 || error.statusCode === '404'
    || ['NoSuchKey', 'NoSuchObject', 'not_found'].includes(error.code ?? '')
    || error.message === 'Object not found'
}

/** 0건 삭제를 성공으로 오인하지 않는다. 기존 사용자 권한으로 파일 부재까지 확인한다. */
export async function removeStoredObject(sb: SupabaseClient, bucket: string, path: string): Promise<RemovalResult> {
  if (!bucket || !path) return { error: { message: '정리할 파일 경로를 확인하지 못했습니다.' } }
  try {
    const storage = sb.storage.from(bucket)
    const removed = await storage.remove([path])
    if (removed.error) return { error: removed.error }
    if (removed.data?.some(file => file.name === path)) return { error: null }

    const checked = await storage.info(path)
    if (checked.data) return { error: { message: '파일이 저장소에 남아 있어 정리를 완료하지 못했습니다.' } }
    if (checked.error) return isMissingObject(checked.error) ? { error: null } : { error: checked.error }
    return { error: { message: '파일이 삭제되었는지 확인하지 못했습니다.' } }
  } catch (error) {
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return { error: { message: error.message } }
    return { error: { message: '파일 정리 중 연결 오류가 발생했습니다.' } }
  }
}
