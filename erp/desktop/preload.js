// 인트라넷 화면에 PC 프로그램 기능을 알려 줌 (window.wklyDesktop). 인트라넷 주소에서만
const { contextBridge, ipcRenderer } = require('electron')

const info = ipcRenderer.sendSync('app-info')
if (location.origin === info.origin) {
  contextBridge.exposeInMainWorld('wklyDesktop', {
    version: info.version,
    platform: info.platform,
    setAuth: loggedIn => ipcRenderer.send('auth-state', !!loggedIn),
    /** 오른쪽 검색 창: 인트라넷 화면 안 지정한 칸(rect, CSS 픽셀)에 웹 페이지(구글 등)를 띄움 */
    searchOpen: (url, rect) => ipcRenderer.send('search-open', { url: String(url), rect }),
    searchBounds: rect => ipcRenderer.send('search-bounds', rect),
    searchNav: action => ipcRenderer.send('search-nav', String(action)),
    searchClose: () => ipcRenderer.send('search-close'),
    onLock: cb => {
      const handler = () => cb()
      ipcRenderer.on('lock', handler)
      return () => ipcRenderer.removeListener('lock', handler)
    },
  })
}
