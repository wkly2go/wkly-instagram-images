// Media deck rules (2026-11-28 대표 지시 '채팅방 자리에 유튜브 · 인스타그램 · 틱톡을 볼 수 있는 화면 · 아이폰 크기 · 아이패드 · 맥북 13인치 스위치').
// Turns a pasted link into an official embed address. Only the platforms' own embed players are used.

export type Platform = 'youtube' | 'instagram' | 'tiktok'
export type Media = { platform: Platform; id: string; url: string; embed: string; thumb: string | null; title?: string }

export const PLATFORM_LABEL: Record<Platform, string> = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' }

/** Screen sizes in CSS points (portrait iPhone / iPad, landscape MacBook 13). */
export const DEVICES = {
  iphone: { label: 'iPhone', w: 393, h: 852 },
  ipad: { label: 'iPad', w: 820, h: 1180 },
  mac: { label: 'MacBook 13', w: 1470, h: 956 },
} as const
export type Device = keyof typeof DEVICES

const YT_ID = /^[A-Za-z0-9_-]{11}$/

/** Parse a YouTube, Instagram or TikTok link. Returns null for anything else. */
export function parseMedia(raw: string): Media | null {
  const text = raw.trim()
  if (!text) return null
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    let id = ''
    if (host === 'youtu.be') id = parts[0] ?? ''
    else if (parts[0] === 'watch') id = u.searchParams.get('v') ?? ''
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? ''
    if (!YT_ID.test(id)) return null
    return { platform: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0`, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` }
  }

  if (host === 'instagram.com') {
    const i = parts.findIndex(p => p === 'p' || p === 'reel' || p === 'reels' || p === 'tv')
    const id = i >= 0 ? parts[i + 1] ?? '' : ''
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(id)) return null
    const kind = parts[i] === 'p' ? 'p' : 'reel'
    return { platform: 'instagram', id, url: `https://www.instagram.com/${kind}/${id}/`, embed: `https://www.instagram.com/${kind}/${id}/embed/`, thumb: null }
  }

  if (host === 'tiktok.com') {
    const i = parts.indexOf('video')
    const id = i >= 0 ? parts[i + 1] ?? '' : parts[0] === 'embed' ? parts.at(-1) ?? '' : ''
    if (!/^\d{8,25}$/.test(id)) return null
    const user = parts[0]?.startsWith('@') ? parts[0] : '@'
    return { platform: 'tiktok', id, url: `https://www.tiktok.com/${user}/video/${id}`, embed: `https://www.tiktok.com/player/v1/${id}?music_info=1&description=1`, thumb: null }
  }
  return null
}

/** Every supported link in a text (trend reports), first occurrence only, in order. */
export function mediaInText(text: string, limit = 30): Media[] {
  const out: Media[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"'|]+/g)) {
    const media = parseMedia(m[0])
    if (!media) continue
    const key = `${media.platform}:${media.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(media)
    if (out.length >= limit) break
  }
  return out
}

/** Fit a device screen into the space available (scale ≤ 1). */
export function fitScale(device: Device, boxW: number, boxH: number): number {
  const d = DEVICES[device]
  if (boxW <= 0 || boxH <= 0) return 1
  return Math.min(1, boxW / d.w, boxH / d.h)
}
