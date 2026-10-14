/**
 * 알림음: 새 채팅 · 알림이 오면 크게 울림 (인트라넷 창이 열려 있을 때. 다른 창을 보고 있어도 울림)
 *  - 브라우저 정책상 이 창에서 한 번이라도 클릭 · 키 입력을 한 뒤부터 소리가 남
 *  - 창을 모두 닫았을 때 오는 PC 알림 소리는 윈도우 · 맥 알림 설정의 소리를 따름
 *  - 크기: 크게(기본) · 보통 · 끔. 이 컴퓨터에만 저장
 */
export type SoundLevel = 'loud' | 'normal' | 'off'
const KEY = 'wkly-erp-sound'
const LAST = 'wkly-erp-sound-at'

export function soundLevel(): SoundLevel {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'normal' || v === 'off' ? v : 'loud'
  } catch {
    return 'loud'
  }
}
export function setSoundLevel(v: SoundLevel) {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* noop */
  }
}

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx ??= new AC()
  return ctx
}
// 첫 클릭 · 키 입력 때 소리 장치를 깨워 둠 (그래야 나중에 다른 창을 보고 있어도 울림)
if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = audio()
    if (c && c.state === 'suspended') c.resume().catch(() => undefined)
  }
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true })
}

/** 알림음 울리기. 메인 창 · 빠른 창이 동시에 울리지 않게 1.5초 안 중복은 건너뜀 */
export function playAlert(kind: 'chat' | 'notify' = 'chat', force = false) {
  const level = soundLevel()
  if (level === 'off' && !force) return
  try {
    const now = Date.now()
    if (!force && now - Number(localStorage.getItem(LAST) ?? 0) < 1500) return
    localStorage.setItem(LAST, String(now))
  } catch {
    /* noop */
  }
  const c = audio()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => undefined)
  const loud = level !== 'normal'
  // 최대 음량 + 압축기로 한계까지 끌어올림 (찢어지지 않게)
  const comp = c.createDynamicsCompressor()
  comp.threshold.value = -6
  comp.ratio.value = 12
  const master = c.createGain()
  master.gain.value = loud ? 1 : 0.35
  master.connect(comp).connect(c.destination)
  // 채팅: 높은 '띠리링' 2회 / 알림 · 알람: 더 길게 3회
  const notes = kind === 'chat' ? [1318, 1760, 1318, 1760] : [988, 1318, 1760, 988, 1318, 1760]
  const step = 0.14
  const t0 = c.currentTime + 0.02
  notes.forEach((f, i) => {
    const start = t0 + i * step + (kind === 'notify' ? Math.floor(i / 3) * 0.18 : Math.floor(i / 2) * 0.12)
    for (const [type, mul, vol] of [
      ['square', 1, loud ? 0.55 : 0.4],
      ['triangle', 2, loud ? 0.35 : 0.25],
    ] as const) {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = type
      o.frequency.value = f * mul
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(vol, start + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, start + step * 0.95)
      o.connect(g).connect(master)
      o.start(start)
      o.stop(start + step)
    }
  })
}
