// 설치(PWA)용 최소 서비스 워커. 데이터는 항상 서버에서 받으므로 캐시하지 않음.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
