// 인트라넷 화면에 PC 프로그램 기능을 알려 줌 (window.wklyDesktop). 인트라넷 주소에서만
const { contextBridge, ipcRenderer } = require('electron')

const info = ipcRenderer.sendSync('app-info')
if (location.origin === info.origin) {
  contextBridge.exposeInMainWorld('wklyDesktop', {
    version: info.version,
    platform: info.platform,
    setAuth: loggedIn => ipcRenderer.send('auth-state', !!loggedIn),
    onLock: cb => {
      const handler = () => cb()
      ipcRenderer.on('lock', handler)
      return () => ipcRenderer.removeListener('lock', handler)
    },
  })
}
