// 피그잼 · 피그마 연결 — 화면 쪽 순수 함수 (시험: tests/figma.test.ts · 서버 쪽 같은 규칙은 supabase/functions/figma/parse.ts)
export type FigmaKind = 'board' | 'design' | 'slides'
/** 인트라넷 안에서 보기 (피그마 공식 보여 주기 · 보는 사람이 피그마에 로그인돼 있고 권한이 있어야 보임) */
export const figmaEmbedUrl = (url: string) => `https://www.figma.com/embed?embed_host=wkly-erp&url=${encodeURIComponent(url)}`
/** 16:9 에 가까운지 (서버 parse.ts isWide 와 같음) */
export const isWide = (w: number, h: number) => w > 0 && h > 0 && Math.abs(w / h - 16 / 9) < 0.02
export const FIGMA_KIND_LABEL: Record<FigmaKind, string> = { board: '피그잼', design: '피그마', slides: '피그마 슬라이드' }
