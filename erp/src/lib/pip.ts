// "빠른 창"
// 기본: 작은 독립 창(/quick) — 전체 ERP 창을 닫아도 계속 쓸 수 있음. 로그인도 이 창에서 가능
// 빠른 창의 '항상 위' 버튼: 크롬/엣지(PC) Document Picture-in-Picture — 다른 프로그램 위에 항상 떠 있는 창

interface DocumentPictureInPicture {
  requestWindow(opts: { width: number; height: number }): Promise<Window>
  window: Window | null
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture
  }
}

export const QUICK_SIZE = { width: 380, height: 620 }

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

export const QUICK_WINDOW = 'wkly-quick'

/** 지금 창이 독립 빠른 창인지 (빠른 창에서 전체 메뉴로 들어간 경우 '빠른 창으로' 버튼 표시) */
export const inQuickWindow = () => window.name === QUICK_WINDOW

export function openQuickPopup() {
  const left = window.screenX + window.outerWidth - QUICK_SIZE.width - 24
  const top = window.screenY + 80
  window.open('/quick', QUICK_WINDOW, `popup,width=${QUICK_SIZE.width},height=${QUICK_SIZE.height},left=${left},top=${top}`)
}
