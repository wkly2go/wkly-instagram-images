// 화이트보드 글꼴 (2026-11-27 대표 지시 '무료 폰트 기본 설치해' · '우리가 자주 사용하는 폰트들을 모두 설치해')
// 회사 피그마 파일에 쓰인 글꼴(조사: Pretendard 40 · Noto Sans KR 39 · Gmarket Sans 2 · Belgiano Serif 7(유료라 제외))을 화이트보드에서 그대로 보이게.
// 화이트보드(Excalidraw)는 글꼴 목록이 정해져 있어, 그 이름에 우리 글꼴을 겹쳐 씀:
//   Helvetica(2)        → Pretendard 보통   (기본 글꼴 · Noto Sans KR 도 여기로 — Pretendard 한글은 Noto/본고딕 바탕이라 모양이 거의 같음)
//   Liberation Sans(9)  → Pretendard 굵게   (피그마 굵기 600 이상)
//   Lilita One(7)       → G마켓 산스
// Pretendard 는 OFL(무료 · 재배포 허용)이라 public/fonts/board 에 같이 넣음 · G마켓 산스는 무료 글꼴이지만 파일은 넣지 않고 공개 CDN 에서 받음.
// 영문 · 숫자도 Pretendard 로 (피그마와 같게).

export const BOARD_FONT = { regular: 2, bold: 9, display: 7 } as const

// 화이트보드가 같은 이름의 자기 글꼴을 등록하므로, 편집기가 뜬 뒤 그 글꼴을 빼고 우리 글꼴을 넣는다
const FACES: [family: string, url: string][] = [
  ['Helvetica', '/fonts/board/Pretendard-Regular.woff2'],
  ['Liberation Sans', '/fonts/board/Pretendard-Bold.woff2'],
  ['Lilita One', 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.1/GmarketSansMedium.woff'],
]
let faces: FontFace[] | null = null

/** 우리 글꼴을 글꼴 목록 맨 뒤로 (화이트보드가 뜬 뒤 · 피그마를 붙이기 전에 부름) · 받기까지 기다림(최대 4초) */
export async function installBoardFonts(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return
  if (!faces) faces = FACES.map(([f, u]) => new FontFace(f, `url(${u})`, { weight: '100 900', display: 'swap' }))
  // 같은 이름의 화이트보드 원래 글꼴은 빼고(겹치면 브라우저가 그쪽을 고름 · 시험에서 확인) 우리 글꼴만 둠
  const names = new Set(FACES.map(([f]) => f))
  const ours = new Set(faces)
  for (const f of [...document.fonts]) if (!ours.has(f) && names.has(f.family.replace(/^["']|["']$/g, ''))) document.fonts.delete(f)
  for (const f of faces) if (!document.fonts.has(f)) document.fonts.add(f)
  try {
    await Promise.race([Promise.allSettled(faces.slice(0, 2).map(f => f.load())), new Promise(r => setTimeout(r, 4000))])
    void faces[2].load().catch(() => undefined)
  } catch { /* 글꼴을 못 받아도 보드는 열림 */ }
}

/** 피그마 글꼴 → 화이트보드 글꼴 번호 */
export function figmaFontId(family?: string, weight?: number): number {
  const f = (family ?? '').toLowerCase()
  if (/gmarket|g마켓/.test(f)) return BOARD_FONT.display
  if ((weight ?? 400) >= 600) return BOARD_FONT.bold
  return BOARD_FONT.regular
}

/** 피그마로 내보낼 SVG 의 글꼴 이름을 피그마 쪽 이름으로 (피그마에 그 글꼴이 있으면 그대로 · Noto Sans KR 은 피그마 기본 제공) */
export function svgFontsForFigma(svg: string): string {
  return svg
    .replace(/font-family="Helvetica[^"]*"/g, 'font-family="Pretendard, Noto Sans KR, sans-serif"')
    .replace(/font-family="Liberation Sans[^"]*"/g, 'font-family="Pretendard, Noto Sans KR, sans-serif" font-weight="700"')
    .replace(/font-family="Lilita One[^"]*"/g, 'font-family="Gmarket Sans, Pretendard, sans-serif"')
}
