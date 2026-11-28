import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RouterProvider } from './lib/router'
import { UpdateBanner } from './lib/update'
import './styles.css'
import './usability.css'
// 디자인 v8 (2026-11-16 · Houzz Pro 스타일). 이 줄을 빼면 v7 로 돌아감
import './refresh.css'
import './type.css'
import './mono.css'
import { startStackTables } from './lib/stackTables'
import { startFoldLong } from './lib/foldLong'
import { startFoldCards } from './lib/foldCards'

const start = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary area="인트라넷" full>
        <RouterProvider>
          <App />
          <UpdateBanner />
        </RouterProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
// 외부 협업방 (/c/<초대 링크> · 2026-11-17): 로그인 · 인트라넷 화면 없이 그 방 하나만 (src/pages/GuestRoom.tsx)
const guest = /^\/c(\/|$)/.test(window.location.pathname)
// 인터뷰지 (/i/<토큰> · 2026-11-19): 브랜드 담당자가 로그인 없이 답하는 화면 하나만 (src/pages/InterviewFormPage.tsx)
const interviewForm = /^\/i\//.test(window.location.pathname)
// 설계 화면 시험용 자료는 개발 서버에서 따로 켰을 때만 (운영 · 체험 모드 배포에는 들어가지 않음 · src/dev/designHarness.ts)
if (interviewForm) void import('./pages/InterviewFormPage').then(m => m.mountInterviewForm(document.getElementById('root')!))
else if (guest)
  void (async () => {
    if (import.meta.env.DEV && import.meta.env.VITE_COLLAB_HARNESS) (await import('./dev/collabHarness')).installGuestHarness()
    ;(await import('./pages/GuestRoom')).mountGuestRoom(document.getElementById('root')!)
  })()
else if (import.meta.env.DEV && import.meta.env.VITE_DESIGN_HARNESS) void import('./dev/designHarness').then(m => { m.installDesignHarness(); start() })
else if (import.meta.env.DEV && import.meta.env.VITE_COLLAB_HARNESS) void import('./dev/collabHarness').then(m => { m.installCollabHarness(); start() })
else start()

// PWA: 오프라인 캐시 없이 설치만 가능하게
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined))
}

// 채팅 영역 밖에 파일을 떨어뜨려도 브라우저가 파일을 열어 인트라넷 화면이 바뀌지 않게
for (const ev of ['dragover', 'drop'] as const)
  window.addEventListener(ev, e => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })

// 휴대폰: 모든 기록지 표를 위아래 카드로 (칸 이름 붙이기) · 긴 글은 접고 '더 보기' 로 펼침 (외부 협업방 화면에는 쓰지 않음)
if (!guest) {
  startStackTables()
  startFoldLong()
  startFoldCards()
}
