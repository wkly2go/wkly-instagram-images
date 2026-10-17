// THE WKLY 사내 인트라넷 PC 프로그램 (Electron)
//  - 인트라넷 웹(https://wkly-erp.pages.dev)을 그대로 띄움 → 화면 기능은 웹 배포 때 함께 바뀜
//  - 컴퓨터를 켜면 자동 실행 · 로그인 전에는 창을 닫을 수 없고 맨 위에 고정
//  - 로그인 후 X 를 누르면 트레이(작업 표시줄 오른쪽 아래 / 맥 메뉴 막대)로 숨김 · 알림은 계속
//  - 컴퓨터를 30분 안 쓰거나 화면 잠금 · 절전이면 인트라넷 화면도 잠금
//  - 윈도우는 새 버전을 자동으로 받아 로그인 화면일 때 조용히 설치 (맥은 내려받기 안내)
const { app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, shell, nativeImage, dialog, WebContentsView } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { autoUpdater } = require('electron-updater')

// 개발 시험용: 설치본이 아닐 때만 WKLY_APP_URL 로 주소를 바꿀 수 있음
const APP_URL = (!app.isPackaged && process.env.WKLY_APP_URL) || 'https://wkly-erp.pages.dev'
const ORIGIN = new URL(APP_URL).origin
const DOWNLOAD_PAGE = `${APP_URL}/download`
const IDLE_LOCK_SEC = (!app.isPackaged && Number(process.env.WKLY_IDLE_SEC)) || 30 * 60
const ICON = path.join(__dirname, 'build', 'icon.png')
const isMac = process.platform === 'darwin'

let win = null
let tray = null
let loggedIn = false
let allowQuit = false // 시스템 종료 · 업데이트 설치 · 로그인 후 '종료'
let updateReady = false
let hiddenHintShown = false

// 같은 프로그램은 하나만
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  start()
}

function start() {
  app.setAppUserModelId('com.thewkly.intranet')
  // 알림음은 클릭 없이도 울리게 · 숨겨져 있어도 실시간 알림이 늦지 않게
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

  app.whenReady().then(() => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true })
    createWindow()
    createTray()
    watchIdle()
    setupUpdates()
  })

  app.on('activate', () => showWindow()) // 맥: 독 아이콘 클릭
  app.on('before-quit', e => {
    if (allowQuit || loggedIn) {
      allowQuit = true
      if (isMac && updateReady) spawnMacSwap(false) // 맥: 끌 때 받아 둔 새 버전으로 바꿈 (다시 켜지는 않음)
      return
    }
    // 로그인 전에는 종료하지 않음 (Cmd+Q 등)
    e.preventDefault()
    showWindow()
  })
  // 시스템 종료 · 로그아웃은 막지 않음
  powerMonitor.on('shutdown', () => {
    allowQuit = true
    app.quit()
  })
  app.on('window-all-closed', () => {
    /* 트레이에서 계속 실행 */
  })

  ipcMain.on('auth-state', (_e, v) => {
    loggedIn = !!v
    enforceLoginState()
    maybeInstallUpdate()
  })
  setupSearchView()
  ipcMain.on('app-info', e => {
    e.returnValue = { version: app.getVersion(), platform: process.platform, origin: ORIGIN, deviceId: deviceId() }
  })
}

// 이 컴퓨터의 기기 ID (출근 인정 회사 PC 확인용). 설치 후 처음 한 번 만들어 보관
let cachedDeviceId = null
function deviceId() {
  if (cachedDeviceId) return cachedDeviceId
  const file = path.join(app.getPath('userData'), 'device.json')
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')).id
    if (typeof v === 'string' && v.length >= 8) return (cachedDeviceId = v)
  } catch {}
  cachedDeviceId = crypto.randomUUID()
  try {
    fs.writeFileSync(file, JSON.stringify({ id: cachedDeviceId, created: new Date().toISOString() }))
  } catch {}
  return cachedDeviceId
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    title: 'WKLY 인트라넷',
    icon: ICON,
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    show: false,
    webPreferences: webPrefs(),
  })
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} WKLYDesktop/${app.getVersion()}`)
  win.loadURL(APP_URL)
  win.once('ready-to-show', () => {
    win.show()
    enforceLoginState()
  })

  win.on('close', e => {
    if (allowQuit) return
    e.preventDefault()
    if (!loggedIn) {
      // 로그인 전에는 닫을 수 없음
      showWindow()
      return
    }
    win.hide()
    if (!hiddenHintShown && tray && process.platform === 'win32') {
      hiddenHintShown = true
      tray.displayBalloon({ title: 'WKLY 인트라넷', content: '인트라넷은 계속 실행 중입니다. 오른쪽 아래 아이콘을 누르면 다시 열립니다.', iconType: 'info' })
    }
  })
  // 윈도우 시스템 종료 · 로그아웃
  win.on('session-end', () => {
    allowQuit = true
  })

  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'))
  })
}

function webPrefs() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    backgroundThrottling: false,
  }
}

/** 인트라넷 주소 밖 링크는 기본 브라우저로, 빠른 창은 프로그램 안 새 창으로 */
function wireContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, webPreferences: webPrefs() } }
    }
    if (/^https?:|^mailto:|^webcal:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (!sameOrigin(url) && !url.startsWith('file:')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
}
// 본창 · 빠른 창 모두
let creatingSearch = false // 검색 창은 외부 사이트를 그 안에서 열어야 하므로 제외
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'window' && !creatingSearch) wireContents(contents)
})

function sameOrigin(url) {
  try {
    return new URL(url).origin === ORIGIN
  } catch {
    return false
  }
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 로그인 전(또는 잠금 중): 맨 위 고정 · 최소화 불가 / 로그인 후: 보통 창 */
function enforceLoginState() {
  if (!win) return
  if (!loggedIn) {
    win.setAlwaysOnTop(true, 'floating')
    win.setMinimizable(false)
    showWindow()
  } else {
    win.setAlwaysOnTop(false)
    win.setMinimizable(true)
  }
  updateTrayMenu()
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png'))
  if (isMac) img = img.resize({ width: 18, height: 18 })
  tray = new Tray(img)
  tray.setToolTip('WKLY 인트라넷')
  tray.on('click', () => showWindow())
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '인트라넷 열기', click: () => showWindow() },
      { label: '다시 불러오기', click: () => win && win.loadURL(APP_URL) },
      { type: 'separator' },
      { label: `버전 ${app.getVersion()}`, enabled: false },
      {
        label: loggedIn ? '종료' : '종료 (로그인 후 가능)',
        enabled: loggedIn,
        click: () => {
          allowQuit = true
          app.quit()
        },
      },
    ]),
  )
}

/** 컴퓨터를 30분 안 쓰거나 화면 잠금 · 절전 → 인트라넷 잠금 */
function sendLock() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('lock')
}
function watchIdle() {
  setInterval(() => {
    if (loggedIn && powerMonitor.getSystemIdleTime() >= IDLE_LOCK_SEC) sendLock()
    maybeInstallUpdate()
  }, 30_000)
  powerMonitor.on('lock-screen', () => loggedIn && sendLock())
  powerMonitor.on('suspend', () => loggedIn && sendLock())
}

/**
 * 자동 업데이트 (GitHub 릴리스)
 *  - 윈도우: 새 버전을 저절로 받아 둠 (electron-updater)
 *  - 맥: 서명이 없어 기본 방식은 안 되므로, 새 버전 zip 을 직접 받아 풀어 둠
 *  - 받아 둔 새 버전은 ① 로그인 · 잠금 화면에서 1분 넘게 손대지 않을 때 ② 프로그램을 끌 때 ③ 인트라넷 위 '지금 다시 시작'을 누를 때 설치
 */
let macUpdateApp = null // 맥: 풀어 둔 새 .app 경로
let updateVersion = null
const RELEASE_BASE = 'https://github.com/wkly2go/wkly-instagram-images/releases/download'

function sendUpdateState() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update-state', { ready: updateReady, version: updateVersion })
}

function setupUpdates() {
  ipcMain.on('update-install', () => updateReady && installUpdate())
  ipcMain.on('update-query', e => {
    e.returnValue = { ready: updateReady, version: updateVersion }
  })
  if (!app.isPackaged) return
  autoUpdater.autoDownload = !isMac
  autoUpdater.autoInstallOnAppQuit = !isMac
  autoUpdater.on('update-available', info => {
    if (isMac) prepareMacUpdate(info.version).catch(() => undefined)
  })
  autoUpdater.on('update-downloaded', info => {
    updateVersion = info.version
    updateReady = true
    sendUpdateState()
    maybeInstallUpdate()
  })
  autoUpdater.on('error', () => {
    /* 네트워크 오류 등: 다음 확인 때 다시 */
  })
  const check = () => autoUpdater.checkForUpdates().catch(() => undefined)
  setTimeout(check, 10_000)
  setInterval(check, 60 * 60_000)
}

/** 맥: 새 버전 zip 을 받아 임시 폴더에 풀어 둠 */
async function prepareMacUpdate(version) {
  if (macUpdateApp || !/^\d+\.\d+\.\d+$/.test(version)) return
  const { execFile } = require('child_process')
  const run = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, err => (err ? fail(err) : ok())))
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), `wkly-update-${version}-`))
  const zip = path.join(dir, 'update.zip')
  const res = await fetch(`${RELEASE_BASE}/v${version}/WKLY-Intranet.zip`, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download ${res.status}`)
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
  await run('/usr/bin/ditto', ['-x', '-k', zip, dir])
  const name = fs.readdirSync(dir).find(f => f.endsWith('.app'))
  if (!name) throw new Error('no app in zip')
  macUpdateApp = path.join(dir, name)
  updateVersion = version
  updateReady = true
  sendUpdateState()
  maybeInstallUpdate()
}

/** 받아 둔 새 버전은 로그인 · 잠금 화면에서 1분 넘게 손대지 않을 때 설치 (입력 중에 끊지 않음) */
function maybeInstallUpdate() {
  if (updateReady && !loggedIn && powerMonitor.getSystemIdleTime() >= 60) installUpdate()
}

function installUpdate() {
  allowQuit = true
  if (!isMac) return autoUpdater.quitAndInstall(true, true)
  if (spawnMacSwap(true)) app.quit()
  else shell.openExternal(DOWNLOAD_PAGE)
}

/** 맥: 프로그램이 끝나면 지금 .app 을 새 것으로 바꾸고 다시 실행하는 작업을 띄움 (한 번만) */
let macSwapStarted = false
function spawnMacSwap(relaunch) {
  if (macSwapStarted) return true
  const target = path.resolve(process.execPath, '..', '..', '..')
  if (!macUpdateApp || !target.endsWith('.app')) return false
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK)
  } catch {
    return false
  }
  const q = v => `'${String(v).replace(/'/g, `'\\''`)}'`
  const script = [
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
    `rm -rf ${q(target + '.old')} && mv ${q(target)} ${q(target + '.old')}`,
    `if /usr/bin/ditto ${q(macUpdateApp)} ${q(target)}; then rm -rf ${q(target + '.old')}; else rm -rf ${q(target)}; mv ${q(target + '.old')} ${q(target)}; fi`,
    `/usr/bin/xattr -dr com.apple.quarantine ${q(target)} 2>/dev/null`,
    relaunch ? `open ${q(target)}` : ':',
  ].join('\n')
  const { spawn } = require('child_process')
  spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref()
  macSwapStarted = true
  return true
}

/**
 * 인트라넷 안 구글 검색 창 (v1.1)
 *  - 구글은 다른 사이트 안(iframe)에 넣을 수 없지만, PC 프로그램은 화면 위에 별도 웹 화면(WebContentsView)을 겹쳐 띄울 수 있음
 *  - 인트라넷이 알려 준 칸(검색 패널 아래 영역)에 정확히 맞춰 놓고, 창 크기가 바뀌면 인트라넷이 다시 알려 줌
 *  - 검색 창 안 링크는 그 창 안에서 열림 (새 창 링크도 같은 창으로)
 */
let searchView = null
let searchOwner = null
const ALLOWED = /^https:\/\//
let searchZoom = 0.7 // 검색 칸 화면 배율 (인트라넷에서 조절 가능)
function chromeUserAgent(ua) {
  const platform = (ua.match(/\(([^)]+)\)/) || [])[1] || 'Windows NT 10.0; Win64; x64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
}

function placeSearch(rect) {
  if (!searchView || !rect) return
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) }
  searchView.setBounds(r)
}

function closeSearch() {
  if (!searchView) return
  try {
    searchOwner && !searchOwner.isDestroyed() && searchOwner.contentView.removeChildView(searchView)
    searchView.webContents.close()
  } catch {
    /* 이미 닫힘 */
  }
  searchView = null
  searchOwner = null
}

function setupSearchView() {
  ipcMain.on('search-open', (e, { url, rect }) => {
    const owner = BrowserWindow.fromWebContents(e.sender)
    if (!owner || !ALLOWED.test(url)) return
    if (searchView && searchOwner !== owner) closeSearch()
    if (!searchView) {
      creatingSearch = true
      try {
        searchView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } })
      } finally {
        creatingSearch = false
      }
      searchOwner = owner
      owner.contentView.addChildView(searchView)
      const wc = searchView.webContents
      // 구글 로그인이 막히지 않도록 일반 크롬과 같은 브라우저 정보로 접속 (로그인은 이 PC에 계속 유지됨)
      wc.setUserAgent(chromeUserAgent(wc.getUserAgent()))
      // 인트라넷 글자 크기와 맞추기 (사이트를 옮겨 다녀도 같은 배율)
      const fit = () => wc.setZoomFactor(searchZoom)
      wc.on('did-finish-load', fit)
      wc.on('did-navigate-in-page', fit)
      wc.setWindowOpenHandler(({ url: u }) => {
        if (ALLOWED.test(u)) wc.loadURL(u)
        return { action: 'deny' }
      })
      owner.once('closed', () => {
        searchView = null
        searchOwner = null
      })
    }
    placeSearch(rect)
    searchView.webContents.loadURL(url)
  })
  ipcMain.on('search-bounds', (_e, rect) => placeSearch(rect))
  ipcMain.on('search-nav', (_e, action) => {
    if (!searchView) return
    const wc = searchView.webContents
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (action === 'external') shell.openExternal(wc.getURL())
  })
  ipcMain.on('search-close', () => closeSearch())
  ipcMain.on('search-zoom', (_e, z) => {
    const v = Number(z)
    if (!(v >= 0.5 && v <= 1.5)) return
    searchZoom = v
    if (searchView) searchView.webContents.setZoomFactor(v)
  })
}
