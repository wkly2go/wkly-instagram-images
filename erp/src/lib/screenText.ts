/**
 * 화면 글에서 고르기 목록(select)의 안 고른 항목을 뺀다.
 * innerText 는 select 의 모든 항목을 글로 돌려줘서, 할 일 표처럼 줄마다 프로젝트 고르기가 있으면
 * 비서가 '목록 전체가 펼쳐져 있다'고 읽었다 (2026-11-22 홈 가독성 요청의 원인).
 */
export function dropSelectLists(text: string, selects: { all: string; picked: string }[]): string {
  let out = text
  for (const s of selects) {
    if (!s.all || s.all === s.picked) continue
    const at = out.indexOf(s.all)
    if (at < 0) continue
    out = out.slice(0, at) + s.picked + out.slice(at + s.all.length)
  }
  return out
}
