// THE WKLY 사내 인트라넷 PC 프로그램 (Electron)
//  - 인트라넷 웹(https://wkly-erp.pages.dev)을 그대로 띄움 → 화면 기능은 웹 배포 때 함께 바뀜
//  - 컴퓨터를 켜면 자동 실행 · 로그인 전에는 창을 닫을 수 없고 맨 위에 고정
//  - 로그인 후 X 를 누르면 트레이(작업 표시줄 오른쪽 아래 / 맥 메뉴 막대)로 숨김 · 알림은 계속
//  - 컴퓨터를 30분 안 쓰거나 화면 잠금 · 절전이면 인트라넷 화면도 잠금
//  - 새 버전을 자동으로 받아 로그인 화면에서 쉬거나 끌 때 설치 (윈도우: electron-updater · 맥: 직접 받아 .app 교체)
const { app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, shell, nativeImage, dialog, WebContentsView, nativeTheme, net, session, desktopCapturer } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { autoUpdater } = require('electron-updater')

// 개발 시험용: 설치본이 아닐 때만 WKLY_APP_URL 로 주소를 바꿀 수 있음
const APP_URL = (!app.isPackaged && process.env.WKLY_APP_URL) || 'https://wkly-erp.pages.dev'
const ORIGIN = new URL(APP_URL).origin
const DOWNLOAD_PAGE = `${APP_URL}/download`
const IDLE_LOCK_SEC = (!app.isPackaged && Number(process.env.WKLY_IDLE_SEC)) || 30 * 60
// 창 아이콘: 윈도우는 여러 크기를 담은 .ico (작업 표시줄 · 제목 막대에서 선명하게)
const ICON = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
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

/**
 * 회의록 AI · 'Meet 소리 함께 녹음' (1.23): 인트라넷이 화면 공유(getDisplayMedia)를 요청하면 화면 1개 + 컴퓨터 소리를 넘김.
 * 윈도우는 컴퓨터에서 나는 소리 전체(loopback = 크롬에서 연 Meet 상대방 목소리 포함), 맥은 Electron 이 컴퓨터 소리를 지원하지 않아 화면만.
 * 영상은 녹음하지 않음 (인트라넷이 소리만 씀).
 */
function allowMeetingAudio() {
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then(sources => {
        if (!sources.length) return callback({})
        callback(process.platform === 'win32' ? { video: sources[0], audio: 'loopback' } : { video: sources[0] })
      })
      .catch(() => callback({}))
  })
}

function start() {
  app.setAppUserModelId('com.thewkly.intranet')
  // 알림음은 클릭 없이도 울리게 · 숨겨져 있어도 실시간 알림이 늦지 않게
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

  app.whenReady().then(() => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true })
    allowMeetingAudio()
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#FFFFFF', // 기기 다크 모드를 따름 (창이 뜰 때 흰 번쩍임 방지)
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
      // 빠른 창(/quick)은 늘 다른 창 위에 (대표 지시 2026-10-23 "빠른 창이 항상 위에")
      const quick = isQuick(url)
      return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, alwaysOnTop: quick, webPreferences: webPrefs() } }
    }
    if (/^https?:|^mailto:|^webcal:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('did-create-window', (w, { url }) => {
    if (!isQuick(url)) return
    w.setAlwaysOnTop(true, 'floating')
    // 맥: 다른 데스크톱 · 전체 화면 앱 위에서도 보이게
    if (isMac) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
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

function isQuick(url) {
  try {
    return sameOrigin(url) && new URL(url).pathname === '/quick'
  } catch {
    return false
  }
}

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
  // 알림 영역 아이콘: 크기에 맞춘 파일(윈도우 16 · 맥 18, 고해상도 화면은 @2x 를 저절로 씀) → 크게 보이거나 흐려지지 않음
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', isMac ? 'tray-mac.png' : 'tray.png'))
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
        label: updateReady ? `새 버전 ${updateVersion || ''} 설치하고 다시 시작` : '새 버전 확인',
        enabled: app.isPackaged,
        click: () => (updateReady ? installUpdate() : isMac ? checkMacUpdate() : autoUpdater.checkForUpdates().catch(() => undefined)),
      },
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
 *  - 맥: 서명이 없어 기본 방식은 안 되므로, 30분마다 latest-mac.yml 을 직접 확인해 새 버전 zip 을 받아 풀어 둠
 *  - 30분마다 · 컴퓨터를 깨울 때 확인, 받아 둔 새 버전은 손대지 않을 때(로그인 화면 1분 · 사용 중 5분 · 3시간 지나면 1분) · 끌 때 ·
 *    인트라넷 위 '지금 다시 시작'을 누를 때 저절로 설치
 */
let macUpdateApp = null // 맥: 풀어 둔 새 .app 경로
let updateVersion = null
const RELEASE_BASE = 'https://github.com/wkly2go/wkly-instagram-images/releases/download'

function sendUpdateState() {
  updateTrayMenu()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update-state', { ready: updateReady, version: updateVersion })
}

function setupUpdates() {
  ipcMain.on('update-install', () => updateReady && installUpdate())
  ipcMain.on('update-query', e => {
    e.returnValue = { ready: updateReady, version: updateVersion }
  })
  if (!app.isPackaged) return
  if (isMac) {
    // 맥: electron-updater 를 쓰지 않고 직접 확인 (서명 없는 앱 · 회사망 프록시에서도 동작하게 Chromium 네트워크 사용)
    ensureInApplications()
    setTimeout(checkMacUpdate, 10_000)
    setInterval(checkMacUpdate, 30 * 60_000)
    powerMonitor.on('resume', () => setTimeout(checkMacUpdate, 15_000))
    return
  }
  // 최신 릴리스 파일 주소를 바로 봄 (GitHub 목록 · API 를 거치지 않아 회사망 · 요청 한도에도 안정적)
  autoUpdater.setFeedURL({ provider: 'generic', url: `https://github.com/wkly2go/wkly-instagram-images/releases/latest/download` })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
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
  setInterval(check, 30 * 60_000)
  powerMonitor.on('resume', () => setTimeout(check, 15_000))
}

/** 맥 업데이트 기록 (문제 확인용): ~/Library/Application Support/WKLY Intranet/update.log */
function updateLog(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'update.log')
    if (fs.existsSync(f) && fs.statSync(f).size > 200_000) fs.renameSync(f, f + '.1')
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* 기록 실패는 무시 */
  }
}

/** 맥: 다운로드 폴더 · 설치 디스크(dmg)에서 바로 실행하면 macOS 가 읽기 전용 위치로 옮겨 실행해 업데이트를 못 함 → 응용 프로그램 폴더로 옮김 */
function ensureInApplications() {
  try {
    if (app.isInApplicationsFolder()) return
    updateLog(`not in Applications: ${process.execPath}`)
    const r = dialog.showMessageBoxSync({
      type: 'info',
      buttons: ['응용 프로그램 폴더로 옮기기', '나중에'],
      defaultId: 0,
      cancelId: 1,
      message: 'WKLY 인트라넷을 응용 프로그램 폴더로 옮길까요?',
      detail: '지금 위치에서는 새 버전이 자동으로 설치되지 않습니다. 옮기면 다시 실행되고, 이후로는 자동 업데이트됩니다.',
    })
    if (r === 0) {
      allowQuit = true
      app.moveToApplicationsFolder({ conflictHandler: () => true })
    }
  } catch (e) {
    updateLog(`move failed: ${e && e.message}`)
  }
}

const newer = (a, b) => {
  const x = String(a).split('.').map(Number)
  const y = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

let macChecking = false
let macFallbackShown = false
async function checkMacUpdate() {
  // 받아 둔 새 버전이 임시 폴더 정리로 사라졌으면 다시 받음
  if (macUpdateApp && !fs.existsSync(macUpdateApp)) {
    macUpdateApp = null
    updateReady = false
  }
  if (macChecking || macUpdateApp) return
  macChecking = true
  try {
    const res = await net.fetch(`https://github.com/wkly2go/wkly-instagram-images/releases/latest/download/latest-mac.yml?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`latest-mac.yml ${res.status}`)
    const m = /^version:\s*['"]?([\d.]+)/m.exec(await res.text())
    const latest = m && m[1]
    if (latest && newer(latest, app.getVersion())) {
      updateLog(`found ${latest} (now ${app.getVersion()})`)
      await prepareMacUpdate(latest)
    }
  } catch (e) {
    updateLog(`check failed: ${e && e.message}`)
  } finally {
    macChecking = false
  }
}

/**
 * 받아 둔 새 버전 자동 설치 (1.23 · 대표 지시 2026-10-21 "자동 설치 되도록"): 입력 중에는 끊지 않음
 *  ① 로그인 · 잠금 화면에서 1분 ② 로그인 중이라도 5분 넘게 손대지 않을 때
 *  ③ 받아 두고 3시간이 지났으면 1분만 손을 떼도 설치 (계속 미뤄지지 않게)
 */
let updateReadyAt = 0
function maybeInstallUpdate() {
  if (!updateReady) return
  if (!updateReadyAt) updateReadyAt = Date.now()
  const idle = powerMonitor.getSystemIdleTime()
  const overdue = Date.now() - updateReadyAt > 3 * 3600_000
  if ((!loggedIn && idle >= 60) || idle >= 5 * 60 || (overdue && idle >= 60)) installUpdate()
}

function installUpdate() {
  allowQuit = true
  if (!isMac) return autoUpdater.quitAndInstall(true, true)
  if (spawnMacSwap(true)) app.quit()
  else {
    // 바꿔 끼울 수 없는 위치 · 권한: 내려받기 페이지를 한 번만 열어 줌 (30초마다 다시 열지 않게)
    allowQuit = false
    if (macFallbackShown) return
    macFallbackShown = true
    updateLog(`swap not possible: ${process.execPath}`)
    shell.openExternal(DOWNLOAD_PAGE)
  }
}

/** 맥: 프로그램이 끝나면 지금 .app 을 새 것으로 바꾸고 다시 실행하는 작업을 띄움 (한 번만) */
let macSwapStarted = false
function spawnMacSwap(relaunch) {
  if (macSwapStarted) return true
  const target = path.resolve(process.execPath, '..', '..', '..')
  if (!macUpdateApp || !fs.existsSync(macUpdateApp) || !target.endsWith('.app')) return false
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
let searchZoom = 0.6 // 검색 칸 화면 배율 (인트라넷에서 조절 가능)
// 구글 결과 화면의 자체 검색창 · 상단 탭 · 머리글을 숨김 (검색어 · 종류는 인트라넷 쪽 막대로 바꿈)
const HIDE_GOOGLE_CSS = `
  #searchform, #sfcnt, form[role="search"], header#gb, #gb, #top_nav, #hdtb, #hdtbMenus, #hdtb-msb, #hdtb-sc, #appbar, #before-appbar,
  div[role="navigation"]:not(#center_col *), #uHMdif, #searchbox, .sfbg, #tophf, #cnt > #searchform, #taw ~ #bottomads, #footcnt, #footer { display: none !important; }
  #main, #cnt, #rcnt, #center_col { margin-top: 0 !important; padding-top: 0 !important; }
  body { padding-top: 4px !important; }
`
const NAVER_CSS = `
  #header, #header_wrap, .header_wrap, #lnb, #lnb_wrap, .lnb_wrap, #nx_search_form, .sch_area, #snb, #sub_pack, #footer, .api_flicking_wrap, .api_subject_bx_header,
  #gnb, .gnb_wrap, .sc_new.sp_nreview_header, #nx_right_related_keywords, .sticky_wrap, .header_sticky,
  .sch_top, .sch_bar, .sch_w, #_sch_form, .lnb_area, .lnb_wrap, #sch_lnb, .u_skip, .api_title_area .btn_more, .fixed_header, .flick_bx.type_lnb { display: none !important; }
  #wrap, #container, #content, #main_pack, .main_pack, #ct { width: auto !important; min-width: 0 !important; max-width: 100% !important; padding-top: 0 !important; margin: 0 !important; }
  #content { padding: 0 8px !important; }
  body { padding-top: 4px !important; overflow-x: hidden !important; }
`
const CHATGPT_CSS = `
  #thread-bottom-container, form:has(#prompt-textarea), [data-testid="composer-footer-actions"], div:has(> form #prompt-textarea) { display: none !important; }
`
// 그 밖의 사이트: 맨 위 머리글 · 검색창만 숨김 (결과 · 본문은 그대로)
const OTHER_CSS = `header, [role="banner"], form[role="search"], .search-form, #search-form, .header-search, #masthead-container, ytd-masthead, #guide, #guide-button, [data-e2e="nav-search"], [data-e2e="top-search"], nav[role="navigation"] { display: none !important; } ytd-app, #page-manager { margin-top: 0 !important; }`
// 아이디가 바뀌어도 되도록: 결과 목록(#search · #rso · #main_pack 등) 위에 있는 요소를 모두 숨기고, 위에 붙은 고정 머리글도 숨김
const TRIM_JS = `(() => {
  const pick = s => document.querySelector(s)
  const res = pick('#search') || pick('#rso') || pick('#islmp') || pick('#islrg') || pick('#center_col') || pick('#main_pack') || pick('#ct_wrap') || pick('#main') || pick('#container') || pick('main')
  const hide = el => { if (el && el.style) el.style.setProperty('display', 'none', 'important') }
  const run = () => {
    if (document.querySelector('iframe[src*="recaptcha"], #captcha-form, .g-recaptcha, [data-sitekey]')) return
    if (res) {
      let node = res
      while (node && node !== document.body) {
        let sib = node.previousElementSibling
        while (sib) { hide(sib); sib = sib.previousElementSibling }
        node = node.parentElement
      }
    }
    for (const el of document.querySelectorAll('header, [role="banner"], form[role="search"], #searchform, #gb, #hdtb, #top_nav, #appbar')) hide(el)
    // 사이트 자체 검색창(모바일 화면 포함): 검색 입력칸을 찾아 그 입력칸이 든 머리 부분을 숨김 (결과가 든 상자는 건드리지 않음)
    for (const inp of document.querySelectorAll('input[type="search"], input[name="q"], input[name="query"], input[name="search_query"], input[name="keyword"], input[name="searchKeyword"], input[name="sword"], input[name="kw"], input[name="searchword"], input[name="stext"]')) {
      let el = inp.closest('form, header, [role="search"], [role="banner"], .search, .sch, .sch_area, .sch_w, .search-bar, .searchbar') || inp.parentElement
      while (el && el !== document.body && el.parentElement && el.parentElement.getBoundingClientRect().height < 180 && !el.parentElement.contains(res)) el = el.parentElement
      if (el && el !== document.body && !el.contains(res)) hide(el)
    }
    for (const el of document.body.querySelectorAll('div, nav, header')) {
      const cs = getComputedStyle(el)
      if ((cs.position === 'fixed' || cs.position === 'sticky') && el.getBoundingClientRect().top < 60 && el.getBoundingClientRect().height < 220 && !el.contains(res)) hide(el)
    }
    document.body.style.paddingTop = '4px'
  }
  run()
  if (!window.__wklyTrim) {
    window.__wklyTrim = new MutationObserver(() => run())
    window.__wklyTrim.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => window.__wklyTrim && window.__wklyTrim.disconnect(), 8000)
  }
})()`
function trimSearchChrome(wc) {
  const u = wc.getURL()
  try {
    // 구글 '비정상 트래픽' 확인 페이지(/sorry): 로봇 확인(체크 · 그림 선택)이 보이도록 아무것도 숨기지 않음
    if (/^https:\/\/(www\.|ipv4\.|ipv6\.)?google\.[a-z.]+\/sorry\//.test(u) || /recaptcha|captcha|challenge/i.test(u)) return
    // ChatGPT: 자체 입력창을 숨기고 인트라넷 상단 검색창으로만 질문 (CSS 한 번만, 스크립트 없음 → 흔들림 없음)
    if (/^https:\/\/([a-z0-9-]+\.)*chatgpt\.com/.test(u)) {
      wc.insertCSS(CHATGPT_CSS)
      return
    }
    if (AI_SITE.test(u) || SHOP_SITE.test(u)) return // AI · 쇼핑 사이트는 손대지 않음 (다시 그려지며 흔들리거나, 화면을 고치면 봇으로 보고 막음)
    wc.insertCSS(FIT_CSS)
    if (/^https:\/\/(www\.)?google\.[a-z.]+\/maps/.test(u) || /^https:\/\/(m\.)?map\.naver\.com/.test(u)) return // 지도는 그대로
    if (/^https:\/\/(www\.)?google\./.test(u)) wc.insertCSS(HIDE_GOOGLE_CSS)
    else if (/^https:\/\/(search|m\.search)\.naver\.com/.test(u)) wc.insertCSS(NAVER_CSS)
    else wc.insertCSS(OTHER_CSS)
    wc.executeJavaScript(TRIM_JS, true).catch(() => undefined)
  } catch {
    /* 페이지가 이미 바뀜 */
  }
}
// 검색 칸은 좁은 세로 창이므로 '휴대폰 크롬'으로 알려 모든 사이트가 반응형(모바일) 화면을 보내게 함
function chromeUserAgent() {
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Mobile Safari/537.36`
}
// AI 사이트(ChatGPT · Perplexity)는 휴대폰 화면으로 열면 앱 설치 배너 · 화면 전환이 반복되며 흔들림 → 일반 PC 크롬으로 접속
const AI_SITE = /^https:\/\/([a-z0-9-]+\.)*(chatgpt\.com|openai\.com|perplexity\.ai)(\/|$)/
function desktopUserAgent() {
  const platform = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'Windows NT 10.0; Win64; x64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
}
// 쇼핑몰 · 결제 사이트는 봇 차단(Akamai 등)이 엄격해, 휴대폰 UA + PC 헤더처럼 정보가 어긋나면 '접근 거부'를 띄움 → PC 크롬으로 일치시켜 접속
const SHOP_SITE = /^https:\/\/([a-z0-9-]+\.)*(coupang\.com|shopping\.naver\.com|smartstore\.naver\.com|brand\.naver\.com|gmarket\.co\.kr|11st\.co\.kr|auction\.co\.kr|ssg\.com|lotteon\.com|kurly\.com|ohou\.se|musinsa\.com|29cm\.co\.kr|wconcept\.co\.kr|kream\.co\.kr|oliveyoung\.co\.kr|kasina\.co\.kr|thehandsome\.com|interpark\.com|melon\.com|yes24\.com|ticketlink\.co\.kr)(\/|$)/
const isDesktopSite = url => AI_SITE.test(url) || SHOP_SITE.test(url)
const uaFor = url => (isDesktopSite(url) ? desktopUserAgent() : chromeUserAgent())
/** 검색 칸이 보내는 모든 요청의 브라우저 정보(UA · 모바일 여부 · 운영체제)를 서로 맞춤 (어긋나면 봇으로 보고 차단) */
let uaHookInstalled = false
function installUaHook(ses) {
  if (uaHookInstalled) return
  uaHookInstalled = true
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    if (!searchView || searchView.webContents.isDestroyed() || details.webContentsId !== searchView.webContents.id) return cb({ requestHeaders: details.requestHeaders })
    const h = details.requestHeaders
    // 페이지 주소 기준 (이미지 · 스크립트 요청도 그 페이지와 같은 정보로)
    const page = searchView.webContents.getURL() || details.url
    const desktopMode = isDesktopSite(details.resourceType === 'mainFrame' ? details.url : page)
    h['User-Agent'] = desktopMode ? desktopUserAgent() : chromeUserAgent()
    h['sec-ch-ua-mobile'] = desktopMode ? '?0' : '?1'
    h['sec-ch-ua-platform'] = desktopMode ? (process.platform === 'darwin' ? '"macOS"' : '"Windows"') : '"Android"'
    cb({ requestHeaders: h })
  })
}
// 모든 사이트 공통: 가로 넘침 금지 · 이미지 · 영상 · 표가 창 폭을 넘지 않게
const FIT_CSS = `
  html, body { overflow-x: hidden !important; max-width: 100vw !important; min-width: 0 !important; }
  img, video, iframe, svg, canvas { max-width: 100% !important; height: auto; }
  table { max-width: 100% !important; }
  pre { white-space: pre-wrap !important; word-break: break-word !important; }
`

let lastPlace = ''
function placeSearch(rect) {
  if (!searchView || !rect) return
  // 인트라넷 창 배율(Cmd +/−)을 반영하고, 창 안으로 자름
  let z = 1
  let cw = Infinity
  let ch = Infinity
  try {
    if (searchOwner && !searchOwner.isDestroyed()) {
      z = searchOwner.webContents.getZoomFactor() || 1
      const [w, h] = searchOwner.getContentSize()
      cw = w
      ch = h
    }
  } catch {
    /* 창이 닫히는 중 */
  }
  const x = Math.max(0, Math.round(rect.x * z))
  const y = Math.max(0, Math.round(rect.y * z))
  const r = { x, y, width: Math.max(0, Math.min(Math.round(rect.width * z), cw - x)), height: Math.max(0, Math.min(Math.round(rect.height * z), ch - y)) }
  // 인트라넷이 0 크기를 보내면(팝업 창 · 잠금 화면) 아예 감춤
  const show = r.width > 0 && r.height > 0
  const key = `${show}:${r.x},${r.y},${r.width},${r.height}`
  if (key === lastPlace) return
  lastPlace = key
  if (typeof searchView.setVisible === 'function') searchView.setVisible(show)
  if (show) searchView.setBounds(r)
}

function closeSearch() {
  lastPlace = ''
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
      lastPlace = '' // 새 검색 칸은 반드시 자리를 다시 잡음
      owner.contentView.addChildView(searchView)
      const wc = searchView.webContents
      // 구글 로그인이 막히지 않도록 일반 크롬과 같은 브라우저 정보로 접속 (로그인은 이 PC에 계속 유지됨)
      wc.setUserAgent(uaFor(url))
      installUaHook(wc.session)
      // 다른 사이트로 옮겨 갈 때(구글 결과 → 쿠팡 등) 페이지 안 브라우저 정보도 맞춤
      wc.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) wc.setUserAgent(uaFor(details.url))
      })
      // 인트라넷 글자 크기와 맞추기 (사이트를 옮겨 다녀도 같은 배율) · 같은 배율이면 다시 넣지 않음 (다시 그려지며 흔들림)
      const fit = () => {
        if (Math.abs(wc.getZoomFactor() - searchZoom) > 0.001) wc.setZoomFactor(searchZoom)
        trimSearchChrome(wc)
      }
      wc.on('did-finish-load', fit)
      wc.on('dom-ready', () => trimSearchChrome(wc))
      wc.on('did-navigate-in-page', (_e, _u, isMainFrame) => isMainFrame && trimSearchChrome(wc))
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
    searchView.webContents.setUserAgent(uaFor(url))
    searchView.webContents.loadURL(url)
  })
  ipcMain.on('search-bounds', (e, rect) => {
    // 검색 칸을 가진 창이 보낸 좌표만 반영 (빠른 창 등 다른 창의 좌표로 옮겨지지 않게)
    if (searchOwner && !searchOwner.isDestroyed() && e.sender !== searchOwner.webContents) return
    placeSearch(rect)
  })
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
