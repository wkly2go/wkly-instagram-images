// "빠른 기록 창 띄우기"
// 크롬/엣지(PC): Document Picture-in-Picture — 다른 프로그램 위에 항상 떠 있는 작은 창
// 그 외: 작은 팝업 창(/quick)

interface DocumentPictureInPicture {
  requestWindow(opts: { width: number; height: number }): Promise<Window>
  window: Window | null
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture
  }
}

export const QUICK_SIZE = { width: 360, height: 580 }

export function supportsPip(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window
}

/** 현재 문서의 스타일을 PiP 창으로 복사 */
function copyStyles(target: Document) {
  for (const node of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
    target.head.appendChild(node.cloneNode(true))
  }
  target.documentElement.lang = 'ko'
  target.title = '빠른 기록 · THE WKLY'
}

export async function openPipWindow(): Promise<Window | null> {
  if (!supportsPip()) return null
  const dpip = window.documentPictureInPicture!
  if (dpip.window) {
    dpip.window.focus()
    return dpip.window
  }
  const w = await dpip.requestWindow(QUICK_SIZE)
  copyStyles(w.document)
  w.document.body.className = 'pip-body'
  return w
}

export function openQuickPopup() {
  const left = window.screenX + window.outerWidth - QUICK_SIZE.width - 24
  const top = window.screenY + 80
  window.open('/quick', 'wkly-quick', `popup,width=${QUICK_SIZE.width},height=${QUICK_SIZE.height},left=${left},top=${top}`)
}
