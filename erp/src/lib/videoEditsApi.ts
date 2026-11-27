// 영상 편집 요청 (2026-11-27 대표 지시 '인트라넷에서 명령을 내려 완성 · 폰으로도 · 완전 자동' · DB 20261127160000_video_edit_jobs)
//  - 요청 · 목록 · 취소는 DB(활성 팀원 RLS · RPC), 편집은 항상 켜 둔 맥의 작업 처리기(erp/tools/video-worker)가 함
//  - 원본 영상은 올리지 않는다 — 드라이브에 동기화된 촬영 폴더를 고름. 미리보기만 보관함 video-edits
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { CreativeSource } from './creativeReport'
import type { FlowTrend, MarketingCalendar, MarketingFlow } from './marketingFlow'

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
  /** 마케팅 대시보드 추이 (DB 함수 marketing_flow_trend) */
  marketingTrend(): Promise<FlowTrend | null>
  /** 주간 달력 (DB 함수 marketing_calendar). weekStart 는 월요일 날짜 · 없으면 이번 주 */
  marketingCalendar(weekStart?: string): Promise<MarketingCalendar | null>
  /** 콘텐츠 게시 예정일 정하기 · 지우기 (표 growth_schedule) */
  setContentPlan(itemId: string, date: string | null): Promise<void>
  /** 소재별 성과 자료 (DB 함수 marketing_creative_report · 건수만) */
  marketingCreatives(): Promise<CreativeSource | null>
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
    async marketingTrend() { const r = await sb.rpc('marketing_flow_trend'); fail(r.error); return (r.data as FlowTrend | null) ?? null },
    async marketingCalendar(weekStart) { const r = await sb.rpc('marketing_calendar', { p_start: weekStart ?? null }); fail(r.error); return (r.data as MarketingCalendar | null) ?? null },
    async marketingCreatives() { const r = await sb.rpc('marketing_creative_report'); fail(r.error); return (r.data as CreativeSource | null) ?? null },
    async setContentPlan(itemId, date) {
      const r = date ? await sb.from('growth_schedule').upsert({ item_id: itemId, planned_on: date, set_at: new Date().toISOString() }) : await sb.from('growth_schedule').delete().eq('item_id', itemId)
      fail(r.error)
    },
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
  const plans = new Map<string, string>()
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
    async marketingCalendar(weekStart) {
      if (!harness) return null
      const k = new Date(now + 9 * 3600_000); const dow = (k.getUTCDay() + 6) % 7
      const monday = new Date(k.getTime() - dow * 86_400_000).toISOString().slice(0, 10)
      const start = weekStart ?? monday
      const day = (i: number) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
      const all = [
        { id: 'w1', type: 'content' as const, title: '[시험] 연말 팝업 준비 체크리스트', status: '작성 중', channels: ['인스타그램', '네이버 블로그'], at: 1 },
        { id: 'w2', type: 'content' as const, title: '[시험] 성수 팝업 상권 리포트', status: '발행 기록', channels: ['네이버 블로그', '홈페이지'], at: 2 },
        { id: 'w3', type: 'video' as const, title: '[시험] 팝업 빠른 컷', status: '완료', channels: ['영상'], at: 3 },
        { id: 'w4', type: 'content' as const, title: '[시험] 브랜드 인터뷰 · 서면', status: '검수 중', channels: ['인스타그램'], at: 4 },
      ]
      const items = all.filter(x => start === monday || plans.has(x.id)).map(x => ({ ...x, day: plans.get(x.id) ?? day(x.at), planned: plans.has(x.id) })).filter(x => x.day >= start && x.day <= day(6))
      return { week_start: start, items, unplanned: all.filter(x => x.type === 'content' && x.status !== '발행 기록' && !plans.has(x.id)).map(({ id, title, status }) => ({ id, title, status })) }
    },
    async setContentPlan(itemId, date) { if (date) plans.set(itemId, date); else plans.delete(itemId) },
    async marketingCreatives() {
      if (!harness) return null
      return {
        days: 180, untagged: { inquiries: 49, direct: 12, projects: 1, won: 0 },
        contents: [
          { id: 'w2', title: '[시험] 성수 팝업 상권 리포트', status: '발행 기록', updated_at: new Date(now - 2 * 86_400_000).toISOString(), channels: [{ channel: '네이버 블로그', status: '발행', url: 'https://example.com/1' }, { channel: '홈페이지', status: '발행', url: 'https://example.com/2' }] },
          { id: 'w5', title: '[시험] 팝업 철거 체크리스트', status: '발행 기록', updated_at: new Date(now - 9 * 86_400_000).toISOString(), channels: [{ channel: '네이버 블로그', status: '발행', url: 'https://example.com/3' }] },
        ],
        campaigns: [{ id: 'harness-campaign-1', title: '[시험] 팝업 대행 문의 2주', platform: 'meta', status: 'ready' }],
        tags: [
          { campaign: '성수-팝업-상권-리포트', source: 'naver_blog', inquiries: 9, direct: 3, projects: 2, won: 1, last_at: new Date(now - 86_400_000).toISOString() },
          { campaign: '성수-팝업-상권-리포트', source: 'instagram', inquiries: 4, direct: 0, projects: 0, won: 0, last_at: new Date(now - 86_400_000).toISOString() },
          { campaign: 'harness-campaign-1', source: 'meta', inquiries: 7, direct: 2, projects: 1, won: 0, last_at: new Date(now - 86_400_000).toISOString() },
          { campaign: '[시험] report26h1', source: 'website', inquiries: 12, direct: 0, projects: 0, won: 0, last_at: new Date(now - 86_400_000).toISOString() },
        ],
      }
    },
    async marketingTrend() {
      if (!harness) return null
      const shape = [2, 3, 1, 4, 2, 0, 1, 3, 5, 4, 2, 1, 0, 2, 3, 6, 9, 5, 3, 2, 1, 2, 4, 3, 2, 1, 3, 4, 2, 3]
      return {
        daily: shape.map((v, i) => ({ d: new Date(now - (29 - i) * 86_400_000).toISOString().slice(0, 10), total: v, direct: Math.round(v / 4), ads: Math.round(v / 3) })),
        prev: { total: 61, direct: 9, ads: 22, tagged: 19 },
        by_source: [{ source: '직접 · 출처 모름', inquiries: 49, projects: 1 }, { source: '[시험] meta', inquiries: 18, projects: 0 }, { source: '[시험] naver', inquiries: 8, projects: 0 }, { source: '[시험] instagram', inquiries: 4, projects: 0 }],
        by_kind: [{ kind: '리포트 신청', inquiries: 52 }, { kind: '구독', inquiries: 15 }, { kind: '문의', inquiries: 12 }],
        week_start: (() => { const k = new Date(now + 9 * 3600_000); const dow = (k.getUTCDay() + 6) % 7; return new Date(k.getTime() - dow * 86_400_000).toISOString().slice(0, 10) })(),
        week: [
          { id: 'w1', type: 'content', title: '[시험] 연말 팝업 준비 체크리스트', status: '작성 중', at: new Date(now - 3 * 86_400_000).toISOString(), channels: ['인스타그램', '블로그'] },
          { id: 'w2', type: 'content', title: '[시험] 성수 팝업 상권 리포트', status: '발행 기록', at: new Date(now - 2 * 86_400_000).toISOString(), channels: ['블로그', '뉴스레터', '홈페이지'] },
          { id: 'w3', type: 'video', title: '[시험] 팝업 빠른 컷', status: '완료', at: new Date(now - 86_400_000).toISOString(), channels: ['영상'] },
          { id: 'w4', type: 'content', title: '[시험] 브랜드 인터뷰 · 서면', status: '검수 중', at: new Date(now).toISOString(), channels: ['인스타그램'] },
        ],
      }
    },
    async videoPreviewUrl() { throw new ApiError('체험 모드에는 미리보기가 없습니다.') },
  }
}
