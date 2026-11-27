// 피그잼 · 피그마 연결 API (2026-11-20 · DB 20261120180000_project_figma · 서버 함수 figma)
//  - 목록 · 내보낸 PDF 읽기는 DB 권한(RLS · 활성 팀원)으로, 연결 · 다시 읽기 · PDF 만들기는 서버 함수 figma 로
//  - PDF 를 프로젝트 드라이브에 올린 뒤 주소만 figma_exports 에 적음
import type { FigmaContent } from './figmaToBoard'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { FigmaKind } from './figma'
export { FIGMA_KIND_LABEL, figmaEmbedUrl, isWide, type FigmaKind } from './figma'

export interface FigmaTokenInfo { token: boolean; set_at: string | null; expires_at: string | null; boards: number }
export interface FigmaFrameImage { id: string; name: string; w: number; h: number; mime: string; data: string }
export interface FigmaOutline { key: string; kind: FigmaKind; title: string; frames: FigmaFrame[]; node: string | null }
export interface FigmaFrame { id: string; name: string; type: string; page: string; w: number; h: number }
export interface ProjectFigma {
  id: string
  project_id: string
  file_key: string
  kind: FigmaKind
  url: string
  title: string
  frames: FigmaFrame[]
  content: string | null
  thumb_path: string | null
  last_modified: string | null
  checked_at: string | null
  sync_error: string | null
  created_by: string | null
  created_at: string
  /** 미리보기 그림 서명 주소 (1시간) */
  thumb_url?: string | null
}
export interface FigmaExport { id: string; figma_id: string; project_id: string; title: string; pages: number; path: string; drive_url: string | null; created_by: string | null; created_at: string }

export interface FigmaApi {
  figmaStatus(): Promise<{ token: boolean }>
  /** 관리 화면: 열쇠 있음 · 넣은 날 · 만료일(90일) · 연결된 보드 수 */
  figmaTokenInfo(): Promise<FigmaTokenInfo | null>
  setFigmaToken(value: string): Promise<void>
  listProjectFigma(projectId: string): Promise<{ files: ProjectFigma[]; exports: FigmaExport[] }>
  /** 모든 프로젝트에 연결한 피그마 (화이트보드 공통 불러오기 · 2026-11-27) */
  listAllFigma(): Promise<ProjectFigma[]>
  linkFigma(projectId: string, url: string): Promise<void>
  refreshFigma(id: string): Promise<void>
  unlinkFigma(id: string): Promise<void>
  exportFigmaPdf(id: string, nodeIds: string[], title: string): Promise<{ id: string; path: string; pages: number; url: string | null }>
  /** 프레임을 PNG(base64)로 · 화이트보드에 불러오기 (한 번에 6개) */
  figmaFrameImages(id: string, nodeIds: string[]): Promise<FigmaFrameImage[]>
  /** 프레임 안 글 · 도형 · 선 · 그림을 수정 가능한 요소로 (한 번에 3개) */
  figmaContent(id: string, nodeIds: string[]): Promise<FigmaContent>
  /** 피그마 주소만으로 프레임 목록 (연결하지 않은 파일도 · 저장 안 함) */
  figmaOutline(url: string): Promise<FigmaOutline>
  /** 피그마 주소로 프레임 안 요소 (한 번에 3개) */
  figmaContentByUrl(url: string, nodeIds: string[]): Promise<FigmaContent>
  figmaExportBlob(path: string): Promise<Blob>
  markFigmaExportDrive(id: string, driveFileId: string, driveUrl: string): Promise<void>
}

export function createSupabaseFigmaApi(sb: SupabaseClient): FigmaApi {
  const call = async <T>(action: string, body: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await sb.functions.invoke('figma', { body: { action, ...body } })
    if (error) {
      let msg = error.message
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* 그대로 */ }
      if (/Failed to send|FunctionsFetchError|not found/i.test(msg)) msg = '피그마 연결 서버를 준비 중입니다. 잠시 뒤 다시 해 주세요.'
      throw new ApiError(msg)
    }
    if (data?.error) throw new ApiError(data.error)
    return data as T
  }
  return {
    async figmaStatus() { return await call<{ token: boolean }>('status') },
    async figmaTokenInfo() {
      const r = await sb.rpc('figma_token_info')
      if (r.error) throw new ApiError(r.error.message)
      return r.data as FigmaTokenInfo | null
    },
    async setFigmaToken(value) {
      const r = await sb.rpc('figma_secret_set', { p_value: value })
      if (r.error) throw new ApiError(r.error.message)
    },
    async listProjectFigma(projectId) {
      const [f, x] = await Promise.all([
        sb.from('project_figma').select('*').eq('project_id', projectId).order('created_at'),
        sb.from('figma_exports').select('id,figma_id,project_id,title,pages,path,drive_url,created_by,created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(30),
      ])
      if (f.error) throw new ApiError(['42P01', 'PGRST205'].includes(f.error.code ?? '') ? '피그잼 연결을 준비 중입니다.' : f.error.message)
      const files = (f.data ?? []) as ProjectFigma[]
      const paths = files.map(r => r.thumb_path).filter((p): p is string => !!p)
      if (paths.length) {
        const s = await sb.storage.from('figma-files').createSignedUrls(paths, 3600)
        const by = new Map((s.data ?? []).map(d => [d.path, d.signedUrl]))
        for (const r of files) r.thumb_url = r.thumb_path ? by.get(r.thumb_path) ?? null : null
      }
      return { files, exports: (x.data ?? []) as FigmaExport[] }
    },
    async listAllFigma() {
      const f = await sb.from('project_figma').select('*').order('created_at', { ascending: false }).limit(200)
      if (f.error) throw new ApiError(['42P01', 'PGRST205'].includes(f.error.code ?? '') ? '피그잼 연결을 준비 중입니다.' : f.error.message)
      return (f.data ?? []) as ProjectFigma[]
    },
    async linkFigma(projectId, url) { await call('link', { project_id: projectId, url }) },
    async refreshFigma(id) { await call('refresh', { id }) },
    async unlinkFigma(id) {
      const r = await sb.from('project_figma').delete().eq('id', id).select('id')
      if (r.error) throw new ApiError(r.error.message)
      if (!r.data?.length) throw new ApiError('연결한 사람이나 관리자만 뗄 수 있습니다.')
    },
    async exportFigmaPdf(id, nodeIds, title) { return await call('export', { id, node_ids: nodeIds, title }) },
    async figmaOutline(url) { const r = await call<FigmaOutline & { ok: boolean }>('outline', { url }); return { key: r.key, kind: r.kind, title: r.title, frames: r.frames ?? [], node: r.node ?? null } },
    async figmaContentByUrl(url, nodeIds) { const r = await call<FigmaContent & { ok: boolean }>('content', { url, node_ids: nodeIds }); return { frames: r.frames ?? [], images: r.images ?? {}, skipped: r.skipped ?? 0 } },
    async figmaContent(id, nodeIds) { const r = await call<FigmaContent & { ok: boolean }>('content', { id, node_ids: nodeIds }); return { frames: r.frames ?? [], images: r.images ?? {}, skipped: r.skipped ?? 0 } },
    async figmaFrameImages(id, nodeIds) { return (await call<{ images: FigmaFrameImage[] }>('images', { id, node_ids: nodeIds })).images },
    async figmaExportBlob(path) {
      const r = await sb.storage.from('figma-files').download(path)
      if (r.error || !r.data) throw new ApiError('PDF 를 받지 못했습니다.')
      return r.data
    },
    async markFigmaExportDrive(id, driveFileId, driveUrl) {
      const r = await sb.from('figma_exports').update({ drive_file_id: driveFileId, drive_url: driveUrl }).eq('id', id)
      if (r.error) throw new ApiError(r.error.message)
    },
  }
}

/** 체험 모드: 자료 없음 */
export function createDemoFigmaApi(): FigmaApi {
  const none = async (): Promise<never> => { throw new ApiError('피그잼 연결은 운영 계정에서만 쓸 수 있습니다.') }
  // 화면 확인용(개발 서버 + VITE_BOARD_HARNESS 일 때만): 시험 도구가 넣은 피그마 자료로 '피그마 불러오기'를 띄움 · 배포 묶음에는 없음
  const fx = import.meta.env?.DEV && import.meta.env?.VITE_BOARD_HARNESS === '1'
    ? (globalThis as { __WKLY_FIGMA_FIXTURE?: { files: ProjectFigma[]; content: FigmaContent } }).__WKLY_FIGMA_FIXTURE : undefined
  if (fx) {
    return {
      async figmaStatus() { return { token: true } }, async figmaTokenInfo() { return null }, setFigmaToken: none,
      async listProjectFigma() { return { files: fx.files, exports: [] } }, async listAllFigma() { return fx.files },
      linkFigma: none, refreshFigma: none, unlinkFigma: none, exportFigmaPdf: none, figmaFrameImages: none,
      async figmaContent() { return fx.content },
      async figmaOutline() { const f = fx.files[0]; return { key: f.file_key, kind: f.kind, title: f.title, frames: f.frames, node: null } },
      async figmaContentByUrl() { return fx.content }, figmaExportBlob: none, markFigmaExportDrive: none,
    }
  }
  return {
    async figmaStatus() { return { token: false } },
    async figmaTokenInfo() { return null },
    setFigmaToken: none,
    async listProjectFigma() { return { files: [], exports: [] } },
    async listAllFigma() { return [] },
    linkFigma: none, refreshFigma: none, unlinkFigma: none, exportFigmaPdf: none, figmaFrameImages: none, figmaContent: none, figmaOutline: none, figmaContentByUrl: none, figmaExportBlob: none, markFigmaExportDrive: none,
  }
}
