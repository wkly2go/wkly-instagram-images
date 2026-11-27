// 영상 편집 요청 (2026-11-27 대표 지시 '인트라넷에서 명령을 내려 완성 · 폰으로도 · 완전 자동' · DB 20261127160000_video_edit_jobs)
//  - 요청 · 목록 · 취소는 DB(활성 팀원 RLS · RPC), 편집은 항상 켜 둔 맥의 작업 처리기(erp/tools/video-worker)가 함
//  - 원본 영상은 올리지 않는다 — 드라이브에 동기화된 촬영 폴더를 고름. 미리보기만 보관함 video-edits
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { MarketingFlow } from './marketingFlow'

import type { VideoEditInput, VideoEditJob, VideoSourceFolder } from './videoEdits'
export * from './videoEdits'

export interface VideoEditsApi {
  videoJobs(): Promise<VideoEditJob[]>
  videoFolders(): Promise<VideoSourceFolder[]>
  videoWorkerSeen(): Promise<string | null>
  videoRequest(input: VideoEditInput): Promise<void>
  videoCancel(id: string): Promise<void>
  videoPreviewUrl(path: string): Promise<string>
  /** 마케팅 자동화 한 화면 흐름 숫자 (DB 함수 marketing_flow) */
  marketingFlow(): Promise<MarketingFlow | null>
}

export function createSupabaseVideoEditsApi(sb: SupabaseClient): VideoEditsApi {
  const fail = (e: { message: string } | null) => { if (e) throw new ApiError(e.message) }
  return {
    async videoJobs() {
      const r = await sb.from('video_edit_jobs').select('*').order('created_at', { ascending: false }).limit(40)
      fail(r.error); return (r.data ?? []) as VideoEditJob[]
    },
    async videoFolders() {
      const r = await sb.from('video_source_folders').select('path,files,bytes,newest_at').order('newest_at', { ascending: false, nullsFirst: false }).limit(400)
      fail(r.error); return (r.data ?? []) as VideoSourceFolder[]
    },
    async videoWorkerSeen() { const r = await sb.rpc('video_worker_seen'); fail(r.error); return (r.data as string | null) ?? null },
    async videoRequest(input) {
      const r = await sb.from('video_edit_jobs').insert({ title: input.title.trim(), source_folder: input.source_folder, template: input.template, instructions: input.instructions.trim() || null, target_seconds: input.target_seconds, parent_id: input.parent_id ?? null })
      fail(r.error)
    },
    async videoCancel(id) { const r = await sb.rpc('video_edit_cancel', { p_id: id }); fail(r.error) },
    async marketingFlow() { const r = await sb.rpc('marketing_flow'); fail(r.error); return (r.data as MarketingFlow | null) ?? null },
    async videoPreviewUrl(path) {
      const r = await sb.storage.from('video-edits').createSignedUrl(path, 3600)
      if (r.error || !r.data) throw new ApiError(r.error?.message ?? '미리보기를 열지 못했습니다.')
      return r.data.signedUrl
    },
  }
}

/** 체험 모드에는 자료를 두지 않는다. 화면 확인은 VITE_VIDEO_HARNESS=1 npx vite (지어낸 [시험] 자료 · 배포에는 없음) */
export function createDemoVideoEditsApi(): VideoEditsApi {
  const harness = import.meta.env.DEV && import.meta.env.VITE_VIDEO_HARNESS === '1'
  const now = Date.now()
  let jobs: VideoEditJob[] = harness ? [
    { id: 'v2', created_at: new Date(now - 4 * 60_000).toISOString(), created_by: null, title: '[시험] 성수 팝업 둘러보기', source_folder: '#WKLY_2026/01. 매거진 촬영본/[시험] 11월/성수/4주차_시험 팝업/원본', template: 'walkthrough', instructions: '입구 간판부터 시작', target_seconds: 30, status: '편집 중', parent_id: null, claimed_at: new Date(now - 3 * 60_000).toISOString(), finished_at: null, plan: null, result_path: null, preview_path: null, duration_seconds: null, error: null },
    { id: 'v1', created_at: new Date(now - 3 * 3600_000).toISOString(), created_by: null, title: '[시험] 한남 팝업 빠른 컷', source_folder: '#WKLY_2026/01. 매거진 촬영본/[시험] 11월/한남/3주차_시험 팝업/원본', template: 'cuts', instructions: null, target_seconds: 20, status: '완료', parent_id: null, claimed_at: null, finished_at: new Date(now - 3 * 3600_000 + 7 * 60_000).toISOString(), plan: { by: 'claude', title_caption: '[시험] 한남 팝업', note: '[시험] 밝고 흔들림 적은 장면 위주', segments: [{ clip: 1, start: 2, duration: 2.5, caption: '' }, { clip: 3, start: 0.5, duration: 2, caption: '[시험] 포토존' }, { clip: 4, start: 6, duration: 3, caption: '' }] }, result_path: '#WKLY_2026/01. 매거진 촬영본/[시험] 11월/한남/3주차_시험 팝업/원본/편집본/[시험] 한남 팝업 빠른 컷_261127-1203.mp4', preview_path: null, duration_seconds: 19.5, error: null },
    { id: 'v0', created_at: new Date(now - 26 * 3600_000).toISOString(), created_by: null, title: '[시험] 빈 폴더 요청', source_folder: '#WKLY_2026/03. 영상 제작/[시험] 빈 폴더', template: 'detail', instructions: null, target_seconds: 15, status: '실패', parent_id: null, claimed_at: null, finished_at: new Date(now - 26 * 3600_000 + 60_000).toISOString(), plan: null, result_path: null, preview_path: null, duration_seconds: null, error: '폴더에 영상 파일이 없습니다.' },
  ] : []
  const folders: VideoSourceFolder[] = harness ? [
    { path: '#WKLY_2026/01. 매거진 촬영본/[시험] 11월/성수/4주차_시험 팝업/원본', files: 14, bytes: 2_100_000_000, newest_at: new Date(now - 86400_000).toISOString() },
    { path: '#WKLY_2026/01. 매거진 촬영본/[시험] 11월/한남/3주차_시험 팝업/원본', files: 9, bytes: 1_300_000_000, newest_at: new Date(now - 8 * 86400_000).toISOString() },
  ] : []
  return {
    async videoJobs() { return jobs },
    async videoFolders() { return folders },
    async videoWorkerSeen() { return harness ? new Date(now - 40_000).toISOString() : null },
    async videoRequest(input) {
      jobs = [{ id: `v${jobs.length + 3}`, created_at: new Date().toISOString(), created_by: null, title: input.title.trim(), source_folder: input.source_folder, template: input.template, instructions: input.instructions.trim() || null, target_seconds: input.target_seconds, status: '대기', parent_id: input.parent_id ?? null, claimed_at: null, finished_at: null, plan: null, result_path: null, preview_path: null, duration_seconds: null, error: null }, ...jobs]
    },
    async videoCancel(id) { jobs = jobs.map(j => (j.id === id && j.status === '대기' ? { ...j, status: '취소' } : j)) },
    async marketingFlow() {
      if (!harness) return null
      return { at: new Date(now).toISOString(),
        analyze: { competitor_posts_7d: 2, competitors: 7, research_7d: { '트렌드·밈': 14, '팝업 정보': 13 }, latest_trend: null },
        create: { campaigns_14d: 1, campaign_status: { draft: 2 }, ai_drafts: 0, video: { 완료: 2 } },
        publish: { content_status: { '작성 중': 2 }, content_14d: 2 },
        ads: { settings: { mode: 'suggest', monthly_cap: 0, daily_cap: 0, kill_switch: false }, proposals: 0, meta_drafts: {} },
        inquiries: { total_30d: 79, new: 13, from_ads_30d: 18, tagged_30d: 30, direct_30d: 12 },
        deals: { linked_90d: 1, by_status: { 문의: 1 } },
        by_campaign: [{ campaign: '(꼬리표 없음)', source: '–', inquiries: 31, direct: 12, projects: 1, won: 0 }, { campaign: '[시험] report26h1', source: 'meta', inquiries: 18, direct: 0, projects: 0, won: 0 }] }
    },
    async videoPreviewUrl() { throw new ApiError('체험 모드에는 미리보기가 없습니다.') },
  }
}
