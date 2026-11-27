// 영상 편집 요청의 순수 규칙 · 형식 (화면과 시험이 함께 씀 · 서버 호출 없음)
export type VideoTemplate = 'cuts' | 'walkthrough' | 'detail'
export type VideoJobStatus = '대기' | '편집 중' | '완료' | '실패' | '취소'
export interface VideoPlanSegment { clip: number; start: number; duration: number; caption: string }
export interface VideoPlan { by?: 'claude' | 'rule'; title_caption?: string; note?: string; segments?: VideoPlanSegment[]; clips?: string[] }
export interface VideoEditJob {
  id: string; created_at: string; created_by: string | null; title: string; source_folder: string
  template: VideoTemplate; instructions: string | null; target_seconds: number; status: VideoJobStatus
  parent_id: string | null; claimed_at: string | null; finished_at: string | null
  plan: VideoPlan | null; result_path: string | null; preview_path: string | null; duration_seconds: number | null; error: string | null
}
export interface VideoSourceFolder { path: string; files: number; bytes: number | null; newest_at: string | null }
export interface VideoEditInput { title: string; source_folder: string; template: VideoTemplate; instructions: string; target_seconds: number; parent_id?: string | null }

export const VIDEO_TEMPLATES: { key: VideoTemplate; label: string; help: string }[] = [
  { key: 'cuts', label: '빠른 컷', help: '한 장면 1.5~3초로 빠르게 넘깁니다. 팝업 소개에 맞습니다.' },
  { key: 'walkthrough', label: '공간 걸어 보기', help: '입구에서 안쪽으로 흐름이 이어지게 3~5초씩 보여 줍니다.' },
  { key: 'detail', label: '디테일', help: '소품 · 마감 · 굿즈를 가까이 찍은 장면 위주입니다.' },
]
export const VIDEO_SECONDS = [15, 20, 30, 45, 60]

/** 작업 처리기가 5분 안에 다녀갔으면 켜져 있는 것으로 본다 */
export function workerState(seenAt: string | null, now = Date.now()): 'on' | 'off' | 'never' {
  if (!seenAt) return 'never'
  return now - new Date(seenAt).getTime() < 5 * 60_000 ? 'on' : 'off'
}

/** 촬영 폴더 길을 화면용으로: 맨 끝 폴더 이름 + 그 앞 길 */
export function folderLabel(path: string): { name: string; parent: string } {
  const parts = path.split('/').filter(Boolean)
  const name = parts.pop() ?? path
  // '원본' 처럼 뜻 없는 끝 폴더면 한 단계 위 이름을 함께
  const generic = /^(원본|raw|video|영상|촬영본)$/i.test(name) && parts.length > 0
  return { name: generic ? `${parts[parts.length - 1]} / ${name}` : name, parent: (generic ? parts.slice(0, -1) : parts).slice(-3).join(' › ') }
}

export function videoInputProblem(input: VideoEditInput): string | null {
  if (!input.title.trim()) return '제목을 적어 주세요.'
  if (input.title.trim().length > 120) return '제목은 120자까지입니다.'
  if (!input.source_folder) return '촬영 폴더를 골라 주세요.'
  if (input.instructions.length > 2000) return '지시는 2,000자까지입니다.'
  return null
}
