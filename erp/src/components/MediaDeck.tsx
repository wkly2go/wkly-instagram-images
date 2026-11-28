// 영상 보기 칸 (2026-11-28 대표 지시 '채팅방 자리에 유튜브와 인스타그램 틱톡을 볼 수 있는 첨부 파일과 같은 디자인의 화면 ·
// 화면 크기는 아이폰 · 아이패드 크기와 맥북 13인치로 변경할 수 있는 스위치'). The look follows the reference device the CEO sent:
// white body, dark screen with a status line, speaker grille, and a key pad (two large keys, two small).
// Videos play only through each platform's own embed player. Nothing is saved on the server; recent links stay in this browser.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ExternalLink, RotateCw, Wifi } from 'lucide-react'
import './MediaDeck.css'
import { useApp } from '../lib/app'
import { DEVICES, mediaInText, parseMedia, PLATFORM_LABEL, type Device, type Media } from '../lib/mediaEmbed'

const RECENT_KEY = 'wkly-media-recent'
const DEVICE_KEY = 'wkly-media-device'

const load = <T,>(k: string, d: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? 'null')
    return v ?? d
  } catch {
    return d
  }
}
const store = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* 저장 못 해도 화면은 그대로 */
  }
}

const clock = () => new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

export default function MediaDeck() {
  const { api, toast } = useApp()
  const [device, setDevice] = useState<Device>(() => {
    const d = load<string>(DEVICE_KEY, 'iphone')
    return d in DEVICES ? (d as Device) : 'iphone'
  })
  const [now, setNow] = useState<Media | null>(null)
  const [recent, setRecent] = useState<Media[]>(() => load<Media[]>(RECENT_KEY, []).filter(m => m && m.embed))
  const [trend, setTrend] = useState<Media[] | null>(null)
  const [text, setText] = useState('')
  const [reload, setReload] = useState(0)
  const [time, setTime] = useState(clock())
  const area = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 300, h: 500 })

  useEffect(() => {
    const t = window.setInterval(() => setTime(clock()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  // screen space = whatever the dock leaves above the key pad
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // '지금 뜨는 영상': links in the two newest trend reports (YouTube ranking + TikTok · Instagram picks)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = (await api.listResearch()).filter(r => ['트렌드·밈', '트렌드'].includes(String(r.kind))).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2)
        const bodies = await Promise.all(list.map(r => api.getResearch(r.id)))
        if (alive) setTrend(mediaInText(bodies.map(b => `${b?.source_url ?? ''}\n${b?.body ?? ''}`).join('\n'), 24))
      } catch {
        if (alive) setTrend([])
      }
    })()
    return () => {
      alive = false
    }
  }, [api])

  const play = (m: Media) => {
    setNow(m)
    setReload(0)
    setRecent(prev => {
      const next = [m, ...prev.filter(x => !(x.platform === m.platform && x.id === m.id))].slice(0, 12)
      store(RECENT_KEY, next)
      return next
    })
  }
  const open = (raw: string) => {
    const m = parseMedia(raw)
    if (!m) return toast('유튜브 · 인스타그램 · 틱톡 게시물 주소를 넣어 주세요.')
    setText('')
    play(m)
  }
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) return open(t)
    } catch {
      /* 클립보드 권한이 없으면 입력 칸으로 */
    }
    setNow(null)
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.md-input')?.focus(), 0)
  }
  const pick = (d: Device) => {
    setDevice(d)
    store(DEVICE_KEY, d)
  }

  const spec = DEVICES[device]
  // 2026-11-28 대표 '여백을 최대한 줄여서 꽉 찬 화면으로': the screen fills the whole space; the page inside keeps the
  // device's width (scaled to fit) and gets as much height as the space allows
  const scale = Math.min(1, box.w > 0 ? box.w / spec.w : 1)
  const sw = Math.round(box.w)
  const sh = Math.round(box.h)

  return (
    <div className="md-deck" data-device={device}>
      <div className="md-body">
        <div className="md-area" ref={area}>
          <div className="md-screen" style={{ width: sw, height: sh }}>
            <div className="md-status">
              <span>{time}</span>
              <span className="md-live">
                <i aria-hidden="true" />
                {now ? PLATFORM_LABEL[now.platform] : '영상 보기'}
              </span>
              <span className="grow" />
              <span className="md-size">{spec.label}</span>
              <Wifi size={12} aria-hidden="true" />
            </div>
            {now ? (
              <div className="md-frame" style={{ width: spec.w, height: Math.max(200, (sh - 24) / scale), transform: `scale(${scale})` }}>
                <iframe
                  key={`${now.platform}:${now.id}:${reload}`}
                  src={now.embed}
                  title={`${PLATFORM_LABEL[now.platform]} 영상`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : (
              <div className="md-home">
                <form
                  className="md-form"
                  onSubmit={e => {
                    e.preventDefault()
                    open(text)
                  }}
                >
                  <input className="md-input" value={text} onChange={e => setText(e.target.value)} placeholder="유튜브 · 인스타그램 · 틱톡 주소 붙여 넣기" aria-label="영상 주소" />
                  <button type="submit">열기</button>
                </form>
                {recent.length > 0 && <MediaList title="최근 본 것" items={recent} onPlay={play} />}
                <MediaList title="지금 뜨는 영상" items={trend ?? []} onPlay={play} empty={trend === null ? '불러오는 중…' : '트렌드 · 밈 리서치에 영상 주소가 아직 없습니다.'} />
              </div>
            )}
          </div>
        </div>
        <div className="md-mid">
          <div className="md-switch" role="radiogroup" aria-label="화면 크기">
            {(Object.keys(DEVICES) as Device[]).map(d => (
              <button key={d} type="button" role="radio" aria-checked={device === d} className={device === d ? 'on' : ''} onClick={() => pick(d)}>
                {DEVICES[d].label}
              </button>
            ))}
          </div>
          <span className="md-grille" aria-hidden="true" />
        </div>
        <div className="md-keys">
          <button type="button" className="md-key big" onClick={() => void paste()} title="복사한 주소를 바로 열기">
            <span className="md-cap"><i className="md-rec" /></span>
            <small>붙여넣기</small>
          </button>
          <button type="button" className="md-key big" onClick={() => setNow(null)} title="멈추고 목록으로" disabled={!now}>
            <span className="md-cap"><i className="md-stop" /></span>
            <small>정지</small>
          </button>
          <button type="button" className="md-key" onClick={() => now && window.open(now.url, '_blank', 'noopener')} title="원래 사이트에서 열기" disabled={!now}>
            <span className="md-cap sm"><ExternalLink size={13} /></span>
          </button>
          <button type="button" className="md-key" onClick={() => setReload(r => r + 1)} title="다시 불러오기" disabled={!now}>
            <span className="md-cap sm"><RotateCw size={13} /></span>
          </button>
        </div>
      </div>
    </div>
  )
}

function MediaList({ title, items, onPlay, empty }: { title: string; items: Media[]; onPlay: (m: Media) => void; empty?: string }) {
  return (
    <section className="md-list">
      <h4>{title}</h4>
      {items.length === 0 && empty && <p className="md-empty">{empty}</p>}
      <div className="md-grid">
        {items.map(m => (
          <button key={`${m.platform}:${m.id}`} type="button" className="md-item" onClick={() => onPlay(m)} title={m.url}>
            {m.thumb ? <img src={m.thumb} alt="" loading="lazy" /> : <span className={`md-ph ${m.platform}`}>{PLATFORM_LABEL[m.platform]}</span>}
            <span className="md-tag">{PLATFORM_LABEL[m.platform]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
