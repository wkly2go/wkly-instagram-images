import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ExternalLink, Search, X } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { desktop } from '../lib/desktop'

type Engine = 'google' | 'images' | 'news' | 'maps' | 'naver' | SiteGroup
type SiteGroup = 'popup' | 'design' | 'trend' | 'press' | 'social' | 'bid'
/** 업무 사이트 묶음: 탭을 누르면 이 사이트들만 구글로 검색 (site: 조건) */
const SITE_GROUPS: Record<SiteGroup, { label: string; sites: string[] }> = {
  popup: { label: '팝업 · 공간', sites: ['popply.co.kr', 'heypop.kr', 'spacecloud.kr', 'sweetspot.co.kr', 'visitseoul.net', 'coex.co.kr', 'kintex.com', 'mmca.go.kr'] },
  design: { label: '디자인 · 건축', sites: ['designhouse.co.kr', 'vmspace.com', 'dezeen.com', 'archdaily.com', 'designboom.com', 'frameweb.com', 'wallpaper.com', 'ohou.se', 'behance.net', 'pinterest.com'] },
  trend: { label: '마케팅 · 트렌드', sites: ['ditoday.com', 'openads.co.kr', 'the-pr.co.kr', 'mobiinside.co.kr', 'i-boss.co.kr', 'careet.net', '20slab.org', 'hypebeast.com', 'hypebeast.kr', 'fashionbiz.co.kr'] },
  press: { label: '언론', sites: ['mk.co.kr', 'hankyung.com', 'chosun.com', 'mt.co.kr', 'joongang.co.kr', 'donga.com', 'yna.co.kr', 'edaily.co.kr'] },
  social: { label: 'SNS · 블로그', sites: ['instagram.com', 'youtube.com', 'threads.net', 'linkedin.com', 'blog.naver.com', 'tistory.com', 'brunch.co.kr', 'musinsa.com', '29cm.co.kr', 'wconcept.co.kr'] },
  bid: { label: '입찰 · 공공', sites: ['g2b.go.kr', 'lh.or.kr', 'kintex.com', 'coex.co.kr'] },
}
const isGroup = (e: Engine): e is SiteGroup => e in SITE_GROUPS
const ENGINES: [Engine, string][] = [
  ['google', '구글'],
  ['images', '이미지'],
  ['news', '뉴스'],
  ['maps', '지도'],
  ['naver', '네이버'],
]
const urlFor = (e: Engine, q: string) => {
  if (isGroup(e)) return `https://www.google.com/search?q=${encodeURIComponent(`${q} (${SITE_GROUPS[e].sites.map(x => `site:${x}`).join(' OR ')})`)}`
  const s = encodeURIComponent(q)
  if (e === 'images') return `https://www.google.com/search?tbm=isch&q=${s}`
  if (e === 'news') return `https://www.google.com/search?tbm=nws&q=${s}`
  if (e === 'maps') return `https://www.google.com/maps/search/${s}`
  if (e === 'naver') return `https://search.naver.com/search.naver?query=${s}`
  return `https://www.google.com/search?q=${s}`
}

const RECENT = 'wkly-web-recent'
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]
  } catch {
    return []
  }
}
const saveRecent = (list: string[]) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 8)))
  } catch {
    /* 저장 못 해도 검색은 됨 */
  }
}

/** 화면 오른쪽에 붙는 검색 창 (구글은 다른 사이트 안에 넣을 수 없어 별도 창으로 띄움) */
let docked: Window | null = null
function openDocked(url: string) {
  const w = Math.min(760, Math.round(window.screen.availWidth * 0.42))
  const h = window.screen.availHeight
  const left = (window.screen as unknown as { availLeft?: number }).availLeft ?? 0
  const features = `popup=yes,width=${w},height=${h},left=${left + window.screen.availWidth - w},top=0`
  if (docked && !docked.closed) {
    docked.location.href = url
    docked.focus()
    return true
  }
  docked = window.open(url, 'wkly-web', features)
  return !!docked
}

interface Cse {
  search: { cse: { element: { render: (o: object) => void; getElement: (g: string) => { execute: (q: string) => void } | undefined } } }
}
const cseReady = (cx: string) =>
  new Promise<void>((resolve, reject) => {
    const g = (window as unknown as { google?: Cse }).google
    if (g?.search?.cse?.element) return resolve()
    ;(window as unknown as { __gcse: object }).__gcse = { parsetags: 'explicit', callback: () => resolve() }
    const s = document.createElement('script')
    s.src = `https://cse.google.com/cse.js?cx=${encodeURIComponent(cx)}`
    s.async = true
    s.onerror = () => reject(new Error('구글 검색을 불러오지 못했습니다.'))
    document.head.appendChild(s)
  })

/** 검색 창 상태는 화면(탭)을 옮겨도 그대로: 모듈 전역 + 이 창(sessionStorage)에 기억 */
type OpenState = { q: string; engine: Engine } | null
const OPEN_KEY = 'wkly-web-open'
let openState: OpenState = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? 'null') as OpenState
  } catch {
    return null
  }
})()
const openListeners = new Set<() => void>()
function setOpenState(v: OpenState) {
  openState = v
  try {
    if (v) sessionStorage.setItem(OPEN_KEY, JSON.stringify(v))
    else sessionStorage.removeItem(OPEN_KEY)
  } catch {
    /* 저장 불가 */
  }
  for (const l of openListeners) l()
}
const useOpenState = () =>
  useSyncExternalStore(cb => {
    openListeners.add(cb)
    return () => openListeners.delete(cb)
  }, () => openState)
/** PC 프로그램: 검색 칸(WebContentsView)이 이미 떠 있으면 화면을 옮겨도 다시 불러오지 않음 */
let nativeShowing: string | null = null

/**
 * 검색 창이 들어갈 자리(DOM 한 개를 계속 재사용). 화면(탭)이 바뀌어 Shell 이 다시 그려져도
 * 이 요소를 새 .body 안으로 옮기기만 하므로 검색 창(구글 칸 포함)은 그대로 유지된다
 */
export const webSlot: HTMLDivElement | null = typeof document !== 'undefined' ? document.createElement('div') : null
if (webSlot) {
  webSlot.id = 'web-slot'
  webSlot.className = 'web-slot'
}

/** 앱 맨 위에서 한 번만 그리는 검색 창 (페이지가 바뀌어도 다시 만들지 않음) */
export function WebPanelHost() {
  const open = useOpenState()
  if (!open) return null
  return <WebPanel q={open.q} engine={open.engine} onSearch={(v, e) => setOpenState({ q: v, engine: e })} onClose={() => setOpenState(null)} />
}

/** 상단 검색창: Enter 를 누르면 본 화면 오른쪽에 검색 창이 열리고, 다른 탭으로 가도 그대로 남음 */
export function WebSearchBox() {
  const open = useOpenState()
  const [q, setQ] = useState(open?.q ?? '')
  useEffect(() => {
    if (open?.q) setQ(open.q)
  }, [open?.q])
  const setOpen = setOpenState
  const submit = (engine: Engine = open?.engine ?? 'google') => {
    const v = q.trim()
    if (!v) return
    saveRecent([v, ...readRecent().filter(x => x !== v)])
    setOpen({ q: v, engine })
  }
  return (
    <>
      <form
        className="web-search"
        role="search"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <Search size={14} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="구글 · 인터넷 검색" aria-label="구글 · 인터넷 검색" enterKeyHint="search" title="검색어를 넣고 Enter · 결과는 오른쪽 검색 창에" />
      </form>
    </>
  )
}

function WebPanel({ q, engine, onSearch, onClose }: { q: string; engine: Engine; onSearch: (q: string, e: Engine) => void; onClose: () => void }) {
  const { api, me, version } = useApp()
  const { data: cx } = useAsync(() => api.getSearchCx(), [version], null as string | null)
  const [err, setErr] = useState('')
  const [blocked, setBlocked] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const nativeBox = useRef<HTMLDivElement>(null)
  const app = desktop()
  const native = !!app?.searchOpen // PC 프로그램 v1.1+: 구글을 이 창 안에 바로 띄움
  const inline = !native && !!cx && engine === 'google'
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('wkly-web-w')) || (native ? 640 : 420)
    } catch {
      return native ? 640 : 420
    }
  })
  // 검색 창이 열린 동안 인트라넷 상자를 그 폭만큼 넓혀 본 화면 오른쪽에 나란히 (좁은 화면은 덮어서 표시)
  useEffect(() => {
    const el = document.documentElement
    el.style.setProperty('--web-w', `${width}px`)
    el.classList.add('web-open')
    return () => {
      el.classList.remove('web-open')
      el.style.removeProperty('--web-w')
    }
  }, [width])
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const right = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().right
    const move = (ev: PointerEvent) => setWidth(Math.round(Math.min(Math.max(right - ev.clientX, 320), window.innerWidth * 0.6)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWidth(w => {
        try {
          localStorage.setItem('wkly-web-w', String(w))
        } catch {
          /* 저장 불가 */
        }
        return w
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // 팝업 창(.scrim) · 잠금 화면이 떠 있으면 구글 칸을 숨김 (PC 프로그램의 구글 칸은 항상 화면 맨 위에 그려지므로)
  const covered = () => !!document.querySelector('.scrim, .lock-screen')
  const rectOf = () => {
    const r = nativeBox.current?.getBoundingClientRect()
    return r && !covered() ? { x: r.left, y: r.top, width: r.width, height: r.height } : { x: 0, y: 0, width: 0, height: 0 }
  }

  // PC 프로그램: 검색 결과를 패널 안 칸에 띄우고, 크기가 바뀌면 따라감 · 패널을 닫으면 함께 닫힘
  useEffect(() => {
    if (!native) return
    app!.searchZoom?.(zoom)
    const url = urlFor(engine, q)
    if (nativeShowing === url) app!.searchBounds?.(rectOf())
    else {
      nativeShowing = url
      app!.searchOpen!(url, rectOf())
    }
  }, [native, q, engine])
  // 검색 칸 글자 크기 (PC 프로그램 1.5+): 기본 70%, 가− / 가+ 로 조절 · 이 PC에 기억
  const [zoom] = useState(() => {
    try {
      return Number(localStorage.getItem('wkly-web-zoom')) || 0.6
    } catch {
      return 0.6
    }
  })
  useEffect(() => {
    if (!native || !nativeBox.current) return
    const send = () => app!.searchBounds?.(rectOf())
    const ro = new ResizeObserver(send)
    ro.observe(nativeBox.current)
    const mo = new MutationObserver(send) // 팝업 창이 뜨고 닫힐 때 바로 반영
    mo.observe(document.body, { childList: true })
    window.addEventListener('resize', send)
    const t = window.setInterval(send, 800)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', send)
      window.clearInterval(t)
      // 화면을 옮기느라 잠시 사라지는 경우는 닫지 않음 (닫기 버튼 · Esc 로 닫을 때만)
      if (!openState) {
        nativeShowing = null
        app!.searchClose?.()
      }
    }
  }, [native])

  // 결과를 인트라넷 안에 (검색 ID가 있을 때) · 없으면 오른쪽에 구글 창
  useEffect(() => {
    setErr('')
    if (native) return
    if (!inline) {
      setBlocked(!openDocked(urlFor(engine, q)))
      return
    }
    let off = false
    cseReady(cx!)
      .then(() => {
        if (off) return
        const g = (window as unknown as { google: Cse }).google
        if (!g.search.cse.element.getElement('wkly') && box.current) {
          box.current.innerHTML = ''
          g.search.cse.element.render({ div: box.current, tag: 'searchresults-only', gname: 'wkly', attributes: { linkTarget: '_blank', enableHistory: false } })
        }
        g.search.cse.element.getElement('wkly')?.execute(q)
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
    return () => {
      off = true
    }
  }, [q, engine, inline, cx, native])

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const recent = readRecent()
  const slot = webSlot
  return createPortal(
    <aside className={`web-panel${native ? ' is-native' : ''}`} aria-label="인터넷 검색">
      <div className="web-resize" onPointerDown={startDrag} role="separator" aria-orientation="vertical" aria-label="검색 창 폭 조절" title="끌어서 폭 조절" />
      <div className="web-bar">
        {native && (
          <span className="web-nav">
            <button type="button" className="icon-btn sm" onClick={() => app!.searchNav?.('back')} aria-label="뒤로" title="뒤로">
              <ChevronLeft size={14} />
            </button>
            <button type="button" className="icon-btn sm" onClick={() => app!.searchNav?.('forward')} aria-label="앞으로" title="앞으로">
              <ChevronRight size={14} />
            </button>
          </span>
        )}
        <div className="web-tabs grow" role="tablist" aria-label="검색 종류">
          {ENGINES.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={engine === k} className={`web-tab${engine === k ? ' on' : ''}`} onClick={() => onSearch(q, k)}>
              {l}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn sm" onClick={() => (native ? app!.searchNav?.('external') : window.open(urlFor(engine, q), '_blank', 'noopener'))} aria-label="브라우저로 열기" title="브라우저로 열기">
          <ExternalLink size={13} />
        </button>
        <button type="button" className="icon-btn sm" onClick={onClose} aria-label="검색 창 닫기" title="닫기 (Esc)">
          <X size={14} />
        </button>
      </div>
      <div className="web-tabs web-sites" role="tablist" aria-label="업무 사이트만 검색">
        <span className="t-cap" style={{ alignSelf: 'center' }}>
          업무 사이트
        </span>
        {(Object.keys(SITE_GROUPS) as SiteGroup[]).map(k => (
          <button key={k} type="button" role="tab" aria-selected={engine === k} className={`web-tab${engine === k ? ' on' : ''}`} onClick={() => onSearch(q, k)} title={`업무 사이트만: ${SITE_GROUPS[k].sites.join(' · ')}`}>
            {SITE_GROUPS[k].label}
          </button>
        ))}
      </div>
      {native ? (
        <>
          <div className="web-native" ref={nativeBox} />
        </>
      ) : inline ? (
        <div className="web-results" ref={box} />
      ) : (
        <div className="col gap-6 web-note">
          {blocked ? (
            <span className="t-small t-red">브라우저가 새 창을 막았습니다. 주소창 오른쪽의 팝업 차단 아이콘에서 이 사이트를 허용하거나 아래 버튼을 눌러 주세요.</span>
          ) : (
            <span className="t-small">
              <b>‘{q}’</b> {isGroup(engine) ? `${SITE_GROUPS[engine].label} 사이트` : ENGINES.find(e => e[0] === engine)?.[1]} 검색 결과를 화면 오른쪽 창에 열었습니다.
            </span>
          )}
          <button type="button" className="btn btn-blue btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setBlocked(!openDocked(urlFor(engine, q)))}>
            오른쪽 창에서 다시 열기
          </button>
          <span className="t-cap"><b>PC 프로그램</b>(1.1 이상)에서는 구글 결과가 이 창 안에 바로 나옵니다. <a href="/download">내려받기 ›</a></span>
          {engine === 'google' && !cx && <span className="t-cap">구글은 보안 정책상 다른 사이트 안에 넣을 수 없어 오른쪽에 붙는 별도 창으로 엽니다. 위 검색 종류에서 ‘업무 사이트만’을 고르면 팝업 · 디자인 · 트렌드 · 언론 등 정해 둔 사이트에서만 찾습니다.</span>}
        </div>
      )}
      {err && <span className="t-small t-red">{err}</span>}
      {!native && recent.length > 0 && (
        <div className="col gap-2">
          <span className="t-cap">최근 검색</span>
          <div className="chips">
            {recent.map(r => (
              <button key={r} type="button" className="chip" onClick={() => onSearch(r, engine)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
      {!native && me.role === 'admin' && <CxSetting cx={cx} />}
    </aside>,
    slot ?? document.body,
  )
}

/** 관리자: Google 프로그래머블 검색 ID 등록 → 결과를 인트라넷 안에 표시 */
function CxSetting({ cx }: { cx: string | null }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [v, setV] = useState(cx ?? '')
  return (
    <details className="web-setting">
      <summary className="t-cap">검색 결과를 인트라넷 안에 보기 (관리자 설정)</summary>
      <ol className="t-cap">
        <li>
          <a href="https://programmablesearchengine.google.com/controlpanel/create" target="_blank" rel="noreferrer">
            Google 프로그래머블 검색
          </a>
          에서 info@thewklyn.com 으로 로그인 → 새 검색엔진 만들기 → ‘전체 웹 검색’ 선택
        </li>
        <li>만든 뒤 나오는 ‘검색엔진 ID’ (cx) 를 아래에 붙여 넣고 저장</li>
      </ol>
      <div className="row">
        <input className="input grow" value={v} onChange={e => setV(e.target.value.trim())} placeholder="예) 0123456789abcdef0" aria-label="검색엔진 ID" />
        <button type="button" className="btn btn-outline btn-sm" disabled={busy || v === (cx ?? '')} onClick={() => run(() => api.setSearchCx(v || null), v ? '저장했습니다. 다음 검색부터 인트라넷 안에 결과가 나옵니다.' : '해제했습니다.')}>
          저장
        </button>
      </div>
    </details>
  )
}
