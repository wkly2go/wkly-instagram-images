import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { RouterProvider } from './lib/router'
import { UpdateBanner } from './lib/update'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <App />
      <UpdateBanner />
    </RouterProvider>
  </StrictMode>,
)

// PWA: 오프라인 캐시 없이 설치만 가능하게
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined))
}
