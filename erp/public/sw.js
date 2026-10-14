// THE WKLY 인트라넷 서비스 워커
//   - 설치(PWA)용. 데이터는 항상 서버에서 받으므로 캐시하지 않음.
//   - 웹 푸시: 인트라넷 창을 닫아 둬도 채팅·알림을 PC 알림으로 띄우고, 누르면 해당 화면을 연다.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})

self.addEventListener('push', e => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = { title: 'THE WKLY', body: e.data ? e.data.text() : '' }
  }
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // 지금 그 채팅방을 보고 있으면 띄우지 않음
      if (d.kind === 'chat' && wins.some(w => w.focused && w.visibilityState === 'visible' && w.url.includes(`room=${d.room}`))) return
      await self.registration.showNotification(d.title || 'THE WKLY', {
        body: d.body || '',
        tag: d.tag,
        renotify: !!d.tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        lang: 'ko',
        data: { url: d.url || '/' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // 빠른 기록 창(/quick)보다 본 창을 우선
      const main = wins.find(w => !new URL(w.url).pathname.startsWith('/quick')) || wins[0]
      if (main) {
        await main.focus()
        if ('navigate' in main) await main.navigate(url).catch(() => undefined)
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
