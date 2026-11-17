// 프로젝트 대표 사진 고르기 (2026-11-17) — 순수 함수만 (시험: tests/project-cover.test.ts)
const COVER_SKIP = /(계약|견적|통장|사업자|영수증|계산서|증빙|명함|신분|등록증|서류|청구|세금|작성법|해치|슬랙|slack|kakaotalk|카톡|캡처|capture|screenshot|스크린샷|logo|로고|아이콘|icon|qr)/i
const COVER_MIME = /^image\/(jpeg|png|webp|heic|heif)$/
export function coverRank(path: string, name: string): number {
  const s = `${path}/${name}`
  if (/(준공|완공|시공\s*사진|촬영|포트폴리오|portfolio)/i.test(s)) return 0
  if (/(투시도|렌더|render|조감|perspective)/i.test(s) || (/성과물/.test(path) && /(3d|시안|그래픽|이미지)/i.test(s))) return 1
  if (/(현장\s*사진|현장일보)/.test(path) && !/상권/.test(path)) return 2
  if (/(컨셉|concept|시안|무드|레퍼런스|reference)/i.test(s)) return 3
  return 4
}
export type CoverFile = { id: string; name: string; path: string | null; mime_type: string | null; size: number | null; modified_at: string | null }
export function pickCover(files: CoverFile[]): CoverFile | null {
  const ok = files.filter(f => COVER_MIME.test(f.mime_type ?? '') && !COVER_SKIP.test(`${f.path ?? ''}/${f.name}`) && (f.size ?? 0) >= 60_000)
  ok.sort((a, b) => coverRank(a.path ?? '', a.name) - coverRank(b.path ?? '', b.name) || (b.modified_at ?? '').localeCompare(a.modified_at ?? '') || (b.size ?? 0) - (a.size ?? 0))
  return ok[0] ?? null
}
