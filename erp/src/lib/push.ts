import { useCallback, useEffect, useState } from 'react'
import type { Api } from './api'

/**
 * 웹 푸시: 인트라넷 창을 닫아 둬도 채팅·알림이 PC 알림으로 온다.
 * 브라우저(크롬·엣지)가 백그라운드에서 켜져 있어야 받을 수 있다 (앱으로 설치 + 로그인 시 자동 시작 권장).
 */
const ON_KEY = 'wkly-erp-push-on'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext

/** 이 브라우저에서 푸시를 받고 있는지 (켜져 있으면 화면 안 PC 알림은 중복이라 띄우지 않음) */
export function pushOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === '1'
  } catch {
    return false
  }
}
function setPushOn(on: boolean) {
  try {
    if (on) localStorage.setItem(ON_KEY, '1')
    else localStorage.removeItem(ON_KEY)
  } catch {
    /* noop */
  }
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'))
  return navigator.serviceWorker.ready.then(() => reg)
}

/** 구독을 서버에 저장 (로그인한 사람 앞으로) */
async function save(api: Api, sub: PushSubscription) {
  const j = sub.toJSON()
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error('구독 정보가 올바르지 않습니다.')
  await api.pushSubscribe({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, userAgent: navigator.userAgent })
}

/** 알림 켜기: 권한 요청 → 구독 → 서버 저장 */
export async function enablePush(api: Api): Promise<void> {
  if (!pushSupported()) throw new Error('이 브라우저는 PC 푸시 알림을 지원하지 않습니다. 크롬이나 엣지에서 열어 주세요.')
  const key = await api.pushPublicKey()
  if (!key) throw new Error('체험 모드에서는 PC 푸시 알림을 쓸 수 없습니다.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('알림이 차단돼 있습니다. 주소창 왼쪽 자물쇠 › 알림 › 허용으로 바꿔 주세요.')
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  // 서버 키가 바뀌었으면 다시 구독
  const cur = sub?.options.applicationServerKey
  if (sub && cur && btoa(String.fromCharCode(...new Uint8Array(cur))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) })
  await save(api, sub)
  setPushOn(true)
}

export async function disablePush(api: Api): Promise<void> {
  setPushOn(false)
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

/** 로그인할 때마다 구독 주인을 현재 사람으로 맞춤 (같은 PC 를 여럿이 쓰는 경우 포함) */
export async function syncPush(api: Api): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) {
    setPushOn(false)
    return false
  }
  await save(api, sub)
  setPushOn(true)
  return true
}

export type PushState = 'unsupported' | 'demo' | 'off' | 'on' | 'denied'

/** 알림 켜기 버튼용 상태 */
export function usePush(api: Api) {
  const [state, setState] = useState<PushState>(() =>
    !pushSupported() ? 'unsupported' : api.mode === 'demo' ? 'demo' : Notification.permission === 'denied' ? 'denied' : pushOn() ? 'on' : 'off',
  )
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (state === 'unsupported' || state === 'demo') return
    syncPush(api)
      .then(ok => setState(ok ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off'))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])
  const enable = useCallback(async () => {
    setBusy(true)
    try {
      await enablePush(api)
      setState('on')
    } finally {
      setBusy(false)
      if (pushSupported() && Notification.permission === 'denied') setState('denied')
    }
  }, [api])
  const disable = useCallback(async () => {
    setBusy(true)
    try {
      await disablePush(api)
      setState('off')
    } finally {
      setBusy(false)
    }
  }, [api])
  return { state, busy, enable, disable }
}

/** 앱 설치 (크롬·엣지): 설치 버튼을 누를 수 있으면 prompt 를 돌려줌 */
interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferred = e as InstallEvent
    listeners.forEach(f => f())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach(f => f())
  })
}
export const isInstalledApp = () => typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches

export function useInstall() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const f = () => setTick(t => t + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])
  const install = async () => {
    if (!deferred) return false
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    setTick(t => t + 1)
    return outcome === 'accepted'
  }
  return { canInstall: !!deferred, installed: isInstalledApp(), install }
}
