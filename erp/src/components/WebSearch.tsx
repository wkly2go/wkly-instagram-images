import { WeekPanel } from './WeekPanel'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, MonitorDown, PanelRightClose, PanelRightOpen, Search, X } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { desktop } from '../lib/desktop'

type SiteGroup = 'popup' | 'design' | 'trend' | 'press' | 'social' | 'video' | 'shop' | 'estate' | 'expo' | 'gov' | 'bid'
/** 사이트 하나: 주소 · 이름 · (있으면) 그 사이트 자체 검색 주소 */
interface Site {
  host: string
  label: string
  /** 그 사이트의 검색 결과 페이지 (없으면 구글 site: 검색) */
  search?: (s: string) => string
}
const site = (host: string, label: string, search?: (s: string) => string): Site => ({ host, label, search })
/** 업무 사이트 묶음(두 번째 줄). 묶음을 누르면 세 번째 줄에 저장된 사이트가 나오고, 사이트를 누르면 그 사이트에서 바로 검색 */
const SITE_GROUPS: Record<SiteGroup, { label: string; sites: Site[] }> = {
  popup: {
    label: '팝업 · 페스티벌',
    sites: [
      site('popply.co.kr', '팝플리', s => `https://www.popply.co.kr/popup/search?keyword=${s}`),
      site('heypop.kr', '헤이팝'),
      site('sweetspot.co.kr', '스위트스팟'),
      site('spacecloud.kr', '스페이스클라우드', s => `https://www.spacecloud.kr/search?keyword=${s}`),
      site('festivallife.kr', '페스티벌라이프'),
      site('korean.visitkorea.or.kr', '대한민국 구석구석', s => `https://korean.visitkorea.or.kr/search/search_list.do?keyword=${s}`),
      site('visitseoul.net', '비짓서울', s => `https://english.visitseoul.net/search?searchTerm=${s}`),
      site('tickets.interpark.com', '인터파크 티켓', s => `https://tickets.interpark.com/search?keyword=${s}`),
      site('ticket.yes24.com', '예스24 티켓', s => `https://m.ticket.yes24.com/Search/List.aspx?SearchText=${s}`),
      site('ticketlink.co.kr', '티켓링크', s => `https://www.ticketlink.co.kr/search?query=${s}`),
    ],
  },
  design: {
    label: '디자인 · 건축',
    sites: [site('designhouse.co.kr', '디자인하우스', s => `https://finder.designhouse.co.kr/finder?b=www&k=${s}`), site('vmspace.com', 'VMSPACE', s => `https://vmspace.com/common/top_search.html?search_YN=Y&tag=${s}`), site('dezeen.com', 'Dezeen', s => `https://www.dezeen.com/?s=${s}`), site('archdaily.com', 'ArchDaily', s => `https://www.archdaily.com/search/all?q=${s}`), site('designboom.com', 'designboom', s => `https://www.designboom.com/?s=${s}`), site('frameweb.com', 'FRAME'), site('wallpaper.com', 'Wallpaper*'), site('behance.net', 'Behance', s => `https://www.behance.net/search/projects?search=${s}`), site('pinterest.com', 'Pinterest', s => `https://www.pinterest.com/search/pins/?q=${s}`)],
  },
  trend: {
    label: '마케팅 · 트렌드',
    sites: [site('ditoday.com', '디지털인사이트'), site('openads.co.kr', '오픈애즈', s => `https://www.openads.co.kr/search/result?type=contents&keyword=${s}`), site('the-pr.co.kr', '더피알', s => `https://www.the-pr.co.kr/news/articleList.html?sc_area=A&view_type=sm&sc_word=${s}`), site('mobiinside.co.kr', '모비인사이드'), site('i-boss.co.kr', '아이보스'), site('careet.net', '캐릿'), site('20slab.org', '대학내일20대연구소'), site('hypebeast.kr', '하입비스트'), site('fashionbiz.co.kr', '패션비즈')],
  },
  press: {
    label: '언론',
    sites: [site('mk.co.kr', '매일경제'), site('hankyung.com', '한국경제', s => `https://search.hankyung.com/search/total?query=${s}`), site('chosun.com', '조선일보'), site('mt.co.kr', '머니투데이'), site('joongang.co.kr', '중앙일보'), site('donga.com', '동아일보'), site('yna.co.kr', '연합뉴스'), site('edaily.co.kr', '이데일리', s => `https://www.edaily.co.kr/search/index?keyword=${s}`)],
  },
  social: {
    label: 'SNS · 블로그',
    sites: [site('instagram.com', '인스타그램', s => `https://www.instagram.com/explore/search/keyword/?q=${s}`), site('threads.net', '스레드', s => `https://www.threads.net/search?q=${s}`), site('blog.naver.com', '네이버 블로그', s => `https://m.search.naver.com/search.naver?where=m_blog&query=${s}`), site('tistory.com', '티스토리'), site('brunch.co.kr', '브런치', s => `https://brunch.co.kr/search?q=${s}`), site('x.com', 'X', s => `https://x.com/search?q=${s}`)],
  },
  video: {
    label: '영상 · 숏폼',
    sites: [site('youtube.com', '유튜브', s => `https://www.youtube.com/results?search_query=${s}`), site('tiktok.com', '틱톡', s => `https://www.tiktok.com/search?q=${s}`), site('instagram.com/reels', '릴스', s => `https://www.instagram.com/explore/search/keyword/?q=${s}`), site('vimeo.com', 'Vimeo', s => `https://vimeo.com/search?q=${s}`)],
  },
  shop: {
    label: '쇼핑 · 브랜드',
    sites: [site('coupang.com', '쿠팡', s => `https://www.coupang.com/np/search?q=${s}`), site('shopping.naver.com', '네이버 쇼핑', s => `https://search.shopping.naver.com/search/all?query=${s}`), site('gmarket.co.kr', 'G마켓', s => `https://www.gmarket.co.kr/n/search?keyword=${s}`), site('11st.co.kr', '11번가', s => `https://search.11st.co.kr/Search.tmall?kwd=${s}`), site('ohou.se', '오늘의집', s => `https://ohou.se/store/search?query=${s}`), site('kurly.com', '컬리', s => `https://www.kurly.com/search?sword=${s}`), site('musinsa.com', '무신사', s => `https://www.musinsa.com/search/goods?keyword=${s}`), site('29cm.co.kr', '29CM', s => `https://www.29cm.co.kr/search?keyword=${s}`), site('wconcept.co.kr', 'W컨셉', s => `https://www.wconcept.co.kr/Search?kw=${s}`), site('oliveyoung.co.kr', '올리브영', s => `https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=${s}`)],
  },
  estate: {
    label: '부동산',
    sites: [site('m.land.naver.com', '네이버 부동산', s => `https://m.land.naver.com/search/result/${s}`), site('zigbang.com', '직방'), site('dabangapp.com', '다방'), site('hogangnono.com', '호갱노노'), site('kbland.kr', 'KB부동산'), site('disco.re', '디스코'), site('valueupmap.com', '밸류맵'), site('rt.molit.go.kr', '국토부 실거래가'), site('r-one.co.kr', '한국부동산원'), site('seereal.lh.or.kr', '씨리얼 (LH)'), site('eum.go.kr', '토지이음'), site('golmok.seoul.go.kr', '서울 상권분석'), site('sbiz.or.kr', '소상공인 상권정보'), site('data.go.kr', '공공데이터포털', s => `https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=${s}`), site('data.seoul.go.kr', '서울 열린데이터', s => `https://data.seoul.go.kr/dataList/datasetList.do?searchKeyword=${s}`), site('kosis.kr', '통계청 KOSIS', s => `https://kosis.kr/search/search.do?query=${s}`)],
  },
  expo: {
    label: '전시 · 박람회',
    sites: [site('coex.co.kr', '코엑스'), site('kintex.com', '킨텍스'), site('bexco.co.kr', '벡스코'), site('exco.co.kr', '엑스코'), site('sac.or.kr', '예술의전당', s => `https://www.sac.or.kr/site/main/search/search?query=${s}`), site('sejongpac.or.kr', '세종문화회관'), site('mmca.go.kr', '국립현대미술관'), site('sema.seoul.go.kr', '서울시립미술관'), site('ddp.or.kr', 'DDP', s => `https://ddp.or.kr/?menuno=675&keyword=${s}`)],
  },
  gov: {
    label: '공공 · 지자체',
    sites: [site('seoul.go.kr', '서울시', s => `https://newsearch.seoul.go.kr/ksearch/search.do?kwd=${s}`), site('mediahub.seoul.go.kr', '서울시 미디어허브'), site('korea.kr', '정책브리핑'), site('gg.go.kr', '경기도', s => `https://www.gg.go.kr/search.do?kwd=${s}`), site('incheon.go.kr', '인천시'), site('sba.seoul.kr', '서울경제진흥원'), site('kocca.kr', '콘텐츠진흥원', s => `https://portal.kocca.kr/search/portal/search.do?searchTerm=${s}`)],
  },
  bid: {
    label: '입찰 · 공공',
    sites: [site('g2b.go.kr', '나라장터'), site('lh.or.kr', 'LH', s => `https://www.lh.or.kr/search.es?mid=a10813010000&allKeyWord=${s}`), site('sh.co.kr', 'SH'), site('contract.seoul.go.kr', '서울 계약·입찰', s => `https://contract.seoul.go.kr/new1/views/pubBidInfo.do?ps_selectForm=1&ps1_selectSearch=1&ps1_searchTxt=${s}`), site('kintex.com', '킨텍스'), site('coex.co.kr', '코엑스')],
  },
}
/** 세 번째 줄에서 고른 사이트: 'site:' + 주소 */
type SiteKey = `site:${string}`
/** 'url' = 인트라넷에서 누른 링크를 오른쪽 창에 그대로 엶 */
type Engine = 'google' | 'images' | 'youtube' | 'naver' | 'chatgpt' | 'perplexity' | 'url' | SiteGroup | SiteKey
const isGroup = (e: Engine): e is SiteGroup => e in SITE_GROUPS
const isSite = (e: Engine): e is SiteKey => e.startsWith('site:')
const siteOf = (e: SiteKey): Site | undefined => {
  const host = e.slice(5)
  for (const g of Object.values(SITE_GROUPS)) {
    const f = g.sites.find(x => x.host === host)
    if (f) return f
  }
  return undefined
}
/** 사이트가 속한 묶음 (세 번째 줄을 어느 묶음으로 보여 줄지) */
const groupOf = (e: Engine): SiteGroup | null => {
  if (isGroup(e)) return e
  if (isSite(e)) return (Object.keys(SITE_GROUPS) as SiteGroup[]).find(g => SITE_GROUPS[g].sites.some(x => x.host === e.slice(5))) ?? null
  return null
}
const ENGINES: [Engine, string][] = [
  ['google', '구글'],
  ['images', '이미지'],
  ['youtube', '유튜브'],
  ['naver', '네이버'],
  ['chatgpt', 'ChatGPT'],
  ['perplexity', 'Perplexity'],
]
const urlFor = (e: Engine, q: string) => {
  if (e === 'url') return q
  if (isGroup(e)) return `https://www.google.com/search?q=${encodeURIComponent(`${q} (${SITE_GROUPS[e].sites.map(x => `site:${x.host}`).join(' OR ')})`)}`
  const s = encodeURIComponent(q)
  if (isSite(e)) {
    const st = siteOf(e)
    return st?.search ? st.search(s) : `https://www.google.com/search?q=${encodeURIComponent(`${q} site:${e.slice(5)}`)}`
  }
  if (e === 'images') return `https://www.google.com/search?tbm=isch&q=${s}`
  if (e === 'youtube') return `https://www.youtube.com/results?search_query=${s}`
  if (e === 'naver') return `https://m.search.naver.com/search.naver?query=${s}`
  // AI 검색: 검색어를 바로 질문으로 넘김
  if (e === 'chatgpt') return `https://chatgpt.com/?q=${s}`
  if (e === 'perplexity') return `https://www.perplexity.ai/search?q=${s}`
  return `https://www.google.com/search?q=${s}`
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
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
const DOCKED_KEY = 'wkly-web-docked-url'
/** 화면을 새로 고쳐도 같은 검색이면 창을 또 열지 않음 (팝업 창이 계속 늘어나는 오류 방지) */
function alreadyDocked(url: string) {
  try {
    return sessionStorage.getItem(DOCKED_KEY) === url
  } catch {
    return false
  }
}
/** 결과 창을 놓을 화면 좌표: 인트라넷 오른쪽 검색 칸(버튼 줄 아래) 자리에 정확히 겹치게 */
function dockFeatures() {
  const panel = document.querySelector('.web-panel') as HTMLElement | null
  const anchor = (document.querySelector('.web-panel .web-note') as HTMLElement | null) ?? panel
  const sw = window.screen.availWidth
  const sh = window.screen.availHeight
  if (!panel || !anchor || window.innerWidth < 900) {
    // 좁은 화면 · 패널이 없을 때: 화면 오른쪽에 붙임
    const w = Math.min(760, Math.round(sw * 0.42))
    const left = (window.screen as unknown as { availLeft?: number }).availLeft ?? 0
    return `popup=yes,width=${w},height=${sh},left=${left + sw - w},top=0`
  }
  const pr = panel.getBoundingClientRect()
  const ar = anchor.getBoundingClientRect()
  // 브라우저 바깥 틀(주소창 · 탭 줄) 두께를 더해 화면 좌표로 바꿈
  const bx = window.screenX + Math.max(0, window.outerWidth - window.innerWidth)
  const by = window.screenY + Math.max(0, window.outerHeight - window.innerHeight)
  const left = Math.round(bx + pr.left)
  const top = Math.round(by + ar.top)
  const width = Math.round(pr.width)
  // 결과 창 자체 주소 줄(약 70px)만큼 빼서 아래로 넘치지 않게
  const height = Math.max(280, Math.round(pr.bottom - ar.top - 70))
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`
}
function openDocked(url: string) {
  try {
    sessionStorage.setItem(DOCKED_KEY, url)
  } catch {
    /* 저장 불가 */
  }
  // 열려 있던 창은 닫고 새 자리(지금 검색 칸 위치 · 크기)로 다시 엶 (다른 사이트 창은 옮기거나 크기를 바꿀 수 없음)
  if (docked && !docked.closed) docked.close()
  docked = window.open(url, 'wkly-web', dockFeatures())
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
/** 검색 창은 오른쪽에 붙어 있음 (닫기는 내용만 비움). '인터넷 창 숨기기'를 누르면 null — 이 PC에 기억, 검색 · 링크를 누르면 다시 보임 */
const DOCKED: OpenState = { q: '', engine: 'google' }
const HIDE_KEY = 'wkly-web-hidden'
/** 첫 줄 사이트를 누르면 검색어와 상관없이 그 사이트 첫 화면으로 바로 이동 (대표 지시 2026-10-20) */
const HOME: Partial<Record<Engine, string>> = {
  google: 'https://www.google.com/',
  images: 'https://images.google.com/',
  youtube: 'https://www.youtube.com/',
  naver: 'https://m.naver.com/',
  chatgpt: 'https://chatgpt.com/',
  perplexity: 'https://www.perplexity.ai/',
}
/** 숨김 여부: 직접 고른 값이 없으면 1500px 미만 화면은 처음부터 숨김 (가운데 작업 공간 확보 · 2026-10-22 UI 개선) */
const readHidden = () => {
  try {
    const v = localStorage.getItem(HIDE_KEY)
    if (v === '1') return true
    if (v === '0') return false
    return typeof window !== 'undefined' && window.innerWidth < 1500
  } catch {
    return false
  }
}
// 처음 열 때는 오른쪽에 주간 일정표 (예전 검색 화면은 되살리지 않음 · 2026-10-23)
let openState: OpenState = readHidden() ? null : DOCKED
const openListeners = new Set<() => void>()
function setOpenState(v: OpenState) {
  openState = v
  try {
    if (v) localStorage.setItem(HIDE_KEY, '0')
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
/** 인터넷 창 숨기기 (본 화면을 넓게) / 다시 보이기 */
function hidePanel() {
  setOpenState(null)
  try {
    localStorage.setItem(HIDE_KEY, '1')
  } catch {
    /* 저장 불가: 이번만 숨김 */
  }
}
const showPanel = () => setOpenState(DOCKED)

/** 오른쪽 창을 쓸 수 있는 화면: 마우스로 쓰는 넓은 화면 (휴대폰 · 태블릿은 새 탭으로) */
const panelUsable = () => typeof window !== 'undefined' && window.innerWidth >= 900 && !window.matchMedia?.('(pointer: coarse)').matches
const isWebUrl = (u: string) => /^https?:\/\//i.test(u)
/** 링크를 오른쪽 창에서 엶 (대표 지시 2026-10-20 "링크를 클릭하면 오른쪽 창에서 열리게") · 못 쓰는 화면이면 새 탭 */
export function openLink(url: string) {
  if (isWebUrl(url) && panelUsable()) setOpenState({ q: url, engine: 'url' })
  else window.open(url, '_blank', 'noopener')
}
/** 인트라넷 안의 바깥 링크(<a href="https://…">) 클릭을 가로채 오른쪽 창으로. Ctrl · ⌘ · Shift 클릭은 원래대로 새 탭 */
function onLinkClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a || a.hasAttribute('download') || a.dataset.external !== undefined || a.closest('.web-panel')) return
  if (!isWebUrl(a.href) || new URL(a.href).origin === window.location.origin) return
  if (!panelUsable()) return
  e.preventDefault()
  setOpenState({ q: a.href, engine: 'url' })
}

/**
 * 글자 크기 (대표 지시 2026-10-21 "상부 폰트 크기 조절이 모든 폰트 크기를 조절, 기본은 10")
 *  - 가− / 가+ 가 인트라넷 모든 글자(--fs-k)와 PC 프로그램 검색 칸 배율을 함께 바꿈 · 기본 10 (8~16) · 이 PC에 기억
 */
const FONT_KEY = 'wkly-font-size-v2' // 2026-10-23 기본 글자를 키우며 새 키로 (예전 배율은 초기화)
const FONT_BASE = 10
const NATIVE_BASE = 0.6
let fontSize = (() => {
  try {
    const v = Number(localStorage.getItem(FONT_KEY))
    return v >= 8 && v <= 16 ? v : FONT_BASE
  } catch {
    return FONT_BASE
  }
})()
const nativeZoom = () => Math.min(1.5, Math.max(0.5, Math.round(NATIVE_BASE * (fontSize / FONT_BASE) * 100) / 100))
const applyFont = () => {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--fs-k', String(fontSize / FONT_BASE))
}
applyFont()
let zoomState = nativeZoom()
const zoomListeners = new Set<() => void>()
function stepZoom(d: number) {
  fontSize = Math.min(16, Math.max(8, fontSize + d))
  try {
    localStorage.setItem(FONT_KEY, String(fontSize))
  } catch {
    /* 저장 불가 */
  }
  applyFont()
  zoomState = nativeZoom()
  desktop()?.searchZoom?.(zoomState)
  for (const l of zoomListeners) l()
}
const useZoom = () =>
  useSyncExternalStore(cb => {
    zoomListeners.add(cb)
    return () => zoomListeners.delete(cb)
  }, () => fontSize)
/** PC 프로그램: 검색 칸(WebContentsView)이 이미 떠 있으면 화면을 옮겨도 다시 불러오지 않음 */
let nativeShowing: string | null = null
/**
 * PC 프로그램의 웹 칸(하나뿐)을 드라이브 탭이 잠시 빌려 씀 (대표 지시 2026-10-20 "내 드라이브를 누르면 아래에").
 * 드라이브 탭이 쓰는 동안 인터넷 창은 칸을 건드리지 않고, 돌려받으면 열려 있던 페이지를 다시 띄움
 */
let nativeOwner: 'panel' | 'drive' = 'panel'
let nativeEpoch = 0
const epochListeners = new Set<() => void>()
const useNativeEpoch = () =>
  useSyncExternalStore(cb => {
    epochListeners.add(cb)
    return () => epochListeners.delete(cb)
  }, () => nativeEpoch)
type Rect = { x: number; y: number; width: number; height: number }
const NONE: Rect = { x: 0, y: 0, width: 0, height: 0 }
/**
 * PC 프로그램의 웹 칸(구글 등)은 인트라넷 화면 맨 위에 그려지므로, 칸 자리가 다른 화면(결과 칸 · 팝업 등)에
 * 가려지거나 창 밖으로 밀리면 겹쳐 보임 (2026-10-29 "겹치는 오류"). 실제로 보이는 자리만 보내고,
 * 다른 요소가 덮고 있으면 숨김
 */
export function visibleRect(box: Element, clip?: Element | null): Rect {
  const r = box.getBoundingClientRect()
  const c = clip?.getBoundingClientRect()
  const left = Math.max(r.left, c?.left ?? r.left, 0)
  const top = Math.max(r.top, c?.top ?? r.top, 0)
  const right = Math.min(r.right, c?.right ?? r.right, window.innerWidth)
  const bottom = Math.min(r.bottom, c?.bottom ?? r.bottom, window.innerHeight)
  if (right - left < 40 || bottom - top < 40) return NONE
  // 가운데 · 네 모서리 근처가 모두 이 칸이어야 보여 줌 (하나라도 다른 화면이 덮으면 숨김)
  const pts: [number, number][] = [
    [(left + right) / 2, (top + bottom) / 2],
    [left + 6, top + 6],
    [right - 6, top + 6],
    [left + 6, bottom - 6],
    [right - 6, bottom - 6],
  ]
  for (const [x, y] of pts) {
    const el = document.elementFromPoint(x, y)
    if (!el || !(box === el || box.contains(el))) return NONE
  }
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
}

/** 드라이브 탭: 웹 칸을 이 자리(rect)에 이 주소로 */
export function claimNative(url: string, rect: Rect) {
  const app = desktop()
  if (!app?.searchOpen) return false
  nativeOwner = 'drive'
  nativeShowing = url
  app.searchOpen(url, rect)
  return true
}
export function moveNative(rect: Rect) {
  if (nativeOwner === 'drive') desktop()?.searchBounds?.(rect)
}
/** 드라이브 탭을 떠날 때: 칸을 닫고 인터넷 창에 돌려줌 */
export function releaseNative() {
  if (nativeOwner !== 'drive') return
  nativeOwner = 'panel'
  nativeShowing = null
  desktop()?.searchClose?.()
  nativeEpoch++
  for (const l of epochListeners) l()
}

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
  useEffect(() => {
    document.addEventListener('click', onLinkClick, true)
    return () => document.removeEventListener('click', onLinkClick, true)
  }, [])
  if (!open) return null
  return <WebPanel q={open.q} engine={open.engine} onSearch={(v, e) => setOpenState({ q: v, engine: e })} onClose={() => setOpenState({ q: '', engine: open.engine })} />
}

/** 상단 검색창: Enter 를 누르면 본 화면 오른쪽에 검색 창이 열리고, 다른 탭으로 가도 그대로 남음 */
/** 통합 검색창(Ctrl K)에서 '구글 · 인터넷 검색' 을 고를 때 */
export function runWebSearch(q: string) {
  const v = q.trim()
  if (!v) return
  saveRecent([v, ...readRecent().filter(x => x !== v)])
  setOpenState({ q: v, engine: 'google' })
}

/**
 * 상단 오른쪽 아이콘들을 펼침 메뉴 하나로 (2026-10-28 "상부 아이콘들은 탭다운 방식으로")
 *  - 오른쪽 칸(주간 일정표 · 인터넷) 보이기/숨기기 · 글자 크기 · PC 프로그램 내려받기
 */
export function TopMenu({ showDownload }: { showDownload: boolean }) {
  const open = useOpenState()
  const zoom = useZoom()
  const [on, setOn] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!on) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOn(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOn(false)
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', esc)
    }
  }, [on])
  return (
    <div className="top-menu" ref={ref}>
      <button type="button" className="top-menu-btn" onClick={() => setOn(v => !v)} aria-expanded={on} aria-haspopup="menu" title="화면 · 글자 크기 · 프로그램">
        보기 <ChevronDown size={13} />
      </button>
      {on && (
        <div className="top-menu-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => (open ? hidePanel() : showPanel(), setOn(false))}>
            {open ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />} {open ? '오른쪽 칸 숨기기 (본 화면 넓게)' : '오른쪽 칸 보이기 (주간 일정표 · 인터넷)'}
          </button>
          <div className="top-menu-row" role="group" aria-label="글자 크기">
            <span className="grow">글자 크기 {zoom}</span>
            <button type="button" className="icon-btn sm" onClick={() => stepZoom(-1)} aria-label="글자 작게">
              가−
            </button>
            <button type="button" className="icon-btn sm" onClick={() => stepZoom(1)} aria-label="글자 크게">
              가+
            </button>
          </div>
          {showDownload && (
            <a href="/download" role="menuitem" onClick={() => setOn(false)}>
              <MonitorDown size={14} /> PC 프로그램 내려받기
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/** 상단 바: 검색 입력칸은 통합 검색창으로 합치고, 인터넷 창 이동 · 숨기기 버튼만 (2026-10-23) */
export function WebSearchBox({ inputHidden = false }: { inputHidden?: boolean } = {}) {
  const open = useOpenState()
  const [q, setQ] = useState(open?.engine === 'url' ? '' : open?.q ?? '')
  useEffect(() => {
    if (open?.q && open.engine !== 'url') setQ(open.q)
  }, [open?.q, open?.engine])
  const setOpen = setOpenState
  const submit = (engine: Engine = open?.engine && open.engine !== 'url' ? open.engine : 'google') => {
    const v = q.trim()
    if (!v) return
    saveRecent([v, ...readRecent().filter(x => x !== v)])
    setOpen({ q: v, engine })
  }
  const app = desktop()
  const zoom = useZoom()
  return (
    <>
      {!inputHidden && <form
        className="web-search"
        role="search"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <Search size={14} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={open?.engine === 'url' ? '구글 · 인터넷 검색 (오른쪽은 누른 링크)' : open?.engine === 'chatgpt' ? 'ChatGPT 에 질문 (Enter)' : open?.engine === 'perplexity' ? 'Perplexity 에 질문 (Enter)' : '구글 · 인터넷 검색'} aria-label="구글 · 인터넷 검색" enterKeyHint="search" title="검색어를 넣고 Enter · 결과는 오른쪽 검색 창에" />
      </form>}
      {app?.searchNav && (
        <span className="web-nav" role="group" aria-label="인터넷 창 이동">
          <button type="button" className="icon-btn sm" onClick={() => app.searchNav?.('back')} aria-label="뒤로" title="인터넷 창 뒤로">
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="icon-btn sm" onClick={() => app.searchNav?.('forward')} aria-label="앞으로" title="인터넷 창 앞으로">
            <ChevronRight size={14} />
          </button>
        </span>
      )}
      <button type="button" className="quick-btn pc-only web-toggle" onClick={open ? hidePanel : showPanel} aria-pressed={!open} title={open ? '인터넷 창 숨기기 (본 화면 넓게)' : '인터넷 창 보이기'} aria-label={open ? '인터넷 창 숨기기' : '인터넷 창 보이기'}>
        {open ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
      </button>
      <span className="web-zoom" role="group" aria-label="글자 크기" title={`글자 크기 ${zoom} (기본 10) · 인트라넷 모든 글자와 검색 창에 적용`}>
        <button type="button" className="icon-btn sm" onClick={() => stepZoom(-1)} aria-label="글자 작게">
          가−
        </button>
        <button type="button" className="icon-btn sm" onClick={() => stepZoom(1)} aria-label="글자 크게">
          가+
        </button>
      </span>
    </>
  )
}

function WebPanel({ q, engine, onSearch, onClose }: { q: string; engine: Engine; onSearch: (q: string, e: Engine) => void; onClose: () => void }) {
  const [lastGroup, setLastGroup] = useState<SiteGroup | null>(() => groupOf(engine) ?? 'popup')
  // 세 번째 줄(상세 사이트)은 두 번째 줄 · 언론 칸을 눌렀을 때만 펼치고, 사이트로 이동하면 접음
  const [sitesOpen, setSitesOpen] = useState<SiteGroup | null>(null)
  // 링크를 열어 둔 상태면 검색어가 없는 것으로 봄
  const term = engine === 'url' ? '' : q
  // 패널 안 검색창 (대표 지시 2026-10-28 "검색창이 사라졌어")
  const [box2, setBox2] = useState(term)
  useEffect(() => setBox2(engine === 'url' ? '' : q), [q, engine])
  // 첫 화면을 열어 둔 검색 종류는 켜진 것으로 표시
  const homeOf = engine === 'url' ? (Object.keys(HOME) as Engine[]).find(k => HOME[k] === q) : undefined
  const pickGroup = (k: SiteGroup) => {
    setSitesOpen(sitesOpen === k ? null : k)
    if (term) onSearch(term, k)
    else setLastGroup(k)
  }
  // 프로젝트를 열면 오른쪽 칸에 그 프로젝트 자료를 먼저 보여 줌 (인터넷 ↔ 프로젝트 자료 전환)
  useEffect(() => {
    const g = groupOf(engine)
    if (g) setLastGroup(g)
  }, [engine])
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
  const covered = () => !!document.querySelector('.scrim, .lock-screen, .notif-panel, .img-viewer')
  const rectOf = () => {
    const box = nativeBox.current
    if (!box || covered()) return { x: 0, y: 0, width: 0, height: 0 }
    return visibleRect(box, box.closest('.web-panel'))
  }

  // PC 프로그램: 검색 결과를 패널 안 칸에 띄우고, 크기가 바뀌면 따라감 · 패널을 닫으면 함께 닫힘
  const epoch = useNativeEpoch()
  useEffect(() => {
    if (!native || nativeOwner !== 'panel') return
    app!.searchZoom?.(nativeZoom())
    if (!q) {
      if (nativeShowing) {
        nativeShowing = null
        app!.searchClose?.()
      }
      return
    }
    const url = urlFor(engine, q)
    if (nativeShowing === url) app!.searchBounds?.(rectOf())
    else {
      nativeShowing = url
      app!.searchOpen!(url, rectOf())
    }
  }, [native, q, engine, epoch])
  // 결과 칸은 검색어가 있을 때만 그려지므로, 검색어가 생길 때마다 감시를 다시 건다 (창 크기 · 배치 변화를 계속 따라감)
  useEffect(() => {
    if (!native || !q || !nativeBox.current) return
    const send = () => nativeOwner === 'panel' && app!.searchBounds?.(rectOf())
    const ro = new ResizeObserver(send)
    ro.observe(nativeBox.current)
    const panel = nativeBox.current.closest('.web-panel')
    if (panel) ro.observe(panel)
    send()
    const mo = new MutationObserver(send) // 팝업 창이 뜨고 닫힐 때 바로 반영
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', send)
    const t = window.setInterval(send, 800)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', send)
      window.clearInterval(t)
      // 화면을 옮기느라 잠시 사라지는 경우는 닫지 않음 (닫기 버튼 · Esc 로 닫을 때만)
      if (!openState?.q && nativeOwner === 'panel') {
        nativeShowing = null
        app!.searchClose?.()
      }
    }
  }, [native, !!q])

  // 결과를 인트라넷 안에 (검색 ID가 있을 때) · 없으면 오른쪽에 구글 창
  useEffect(() => {
    setErr('')
    if (native || !q) return
    if (!inline) {
      const url = urlFor(engine, q)
      if (!docked && alreadyDocked(url)) return // 새로 고침 뒤: 이미 열어 둔 창이 있음
      setBlocked(!openDocked(url))
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
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.scrim') && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const recent = readRecent()
  const slot = webSlot
  const shownGroup = groupOf(engine) ?? lastGroup
  return createPortal(
    <aside className={`web-panel${native ? ' is-native' : ''}${q ? ' has-q' : ''}`} aria-label="인터넷 검색">
      <div className="web-resize" onPointerDown={startDrag} role="separator" aria-orientation="vertical" aria-label="검색 창 폭 조절" title="끌어서 폭 조절" />
      <div className="web-bar">
        <div className="web-tabs grow" role="tablist" aria-label="검색 종류">
          {ENGINES.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={engine === k || homeOf === k} className={`web-tab${engine === k || homeOf === k ? ' on' : ''}`} title={`${l} 바로 가기`} onClick={() => onSearch(HOME[k]!, 'url')}>
              {l}
            </button>
          ))}
        </div>
        {q && (
          <button type="button" className="chip week-back" onClick={onClose} title="검색을 닫고 주간 일정표로 (Esc)">
            주간 일정표
          </button>
        )}
        <button type="button" className="icon-btn sm" onClick={() => (native ? app!.searchNav?.('external') : window.open(urlFor(engine, q), '_blank', 'noopener'))} aria-label="브라우저로 열기" title="브라우저로 열기">
          <ExternalLink size={13} />
        </button>
        <button type="button" className="icon-btn sm web-hide" onClick={hidePanel} aria-label="인터넷 창 숨기기" title="인터넷 창 숨기기 (본 화면 넓게) · 위쪽 '인터넷 창'으로 다시 열기">
          <PanelRightClose size={13} />
        </button>
        <button type="button" className="icon-btn sm web-close" onClick={onClose} aria-label="검색 창 닫기" title="닫기">
          <X size={14} />
        </button>
      </div>
      <form
        className="web-search web-panel-search"
        role="search"
        onSubmit={e => {
          e.preventDefault()
          const v = box2.trim()
          if (!v) return
          saveRecent([v, ...readRecent().filter(x => x !== v)])
          onSearch(v, engine === 'url' || !engine ? 'google' : engine)
        }}
      >
        <Search size={14} />
        <input value={box2} onChange={e => setBox2(e.target.value)} placeholder={engine === 'chatgpt' ? 'ChatGPT 에 질문 (Enter)' : engine === 'perplexity' ? 'Perplexity 에 질문 (Enter)' : '구글 · 인터넷 검색 (Enter)'} aria-label="인터넷 검색" enterKeyHint="search" />
        {box2 && (
          <button type="button" className="icon-btn sm" onClick={() => setBox2('')} aria-label="검색어 지우기">
            <X size={12} />
          </button>
        )}
      </form>
      {q && <div className="web-sites" role="group" aria-label="업무 사이트만 검색">
        <div className="web-tabs" role="tablist">
          {(Object.keys(SITE_GROUPS) as SiteGroup[]).filter(k => k !== 'press').map(k => (
            <button key={k} type="button" role="tab" aria-selected={engine === k} className={`web-tab${shownGroup === k ? ' on' : ''}${sitesOpen === k ? ' open' : ''}`} onClick={() => pickGroup(k)} aria-expanded={sitesOpen === k} title={`업무 사이트만: ${SITE_GROUPS[k].sites.map(x => x.label).join(' · ')}`}>
              {SITE_GROUPS[k].label}
            </button>
          ))}
        </div>
      </div>}
      {q && sitesOpen && (
        <div className="web-sites web-shops" role="tablist" aria-label={`${SITE_GROUPS[sitesOpen].label} 사이트에서 바로 검색`}>
          <div className="web-tabs">
            {SITE_GROUPS[sitesOpen].sites.map(st => (
              <button key={st.host} type="button" role="tab" aria-selected={engine === `site:${st.host}`} className={`web-tab${engine === `site:${st.host}` ? ' on' : ''}`} onClick={() => {
                  onSearch(term, `site:${st.host}`)
                  setSitesOpen(null)
                }} title={st.search ? `${st.label}에서 바로 검색` : `구글로 ${st.host} 안에서만 검색`}>
                {st.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!q ? (
        <WeekPanel />
      ) : native ? (
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
              {engine === 'url' ? (
                <>
                  <b>{hostOf(q)}</b> 링크를 이 자리에 맞춰 별도 창으로 열었습니다.
                </>
              ) : (
                <>
              <b>‘{q}’</b> {isGroup(engine) ? `${SITE_GROUPS[engine].label} 사이트` : isSite(engine) ? (siteOf(engine)?.label ?? engine.slice(5)) : ENGINES.find(e => e[0] === engine)?.[1]} 검색 결과를 이 자리에 맞춰 별도 창으로 열었습니다.
                </>
              )}
            </span>
          )}
          <button type="button" className="btn btn-blue btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setBlocked(!openDocked(urlFor(engine, q)))}>
            이 자리에 다시 열기
          </button>
          <span className="t-cap">웹 브라우저에서는 사이트 보안 정책 때문에 결과가 이 자리에 겹친 별도 창으로 열립니다. 인트라넷 창 크기를 바꾼 뒤에는 '이 자리에 다시 열기'를 눌러 주세요. <b>PC 프로그램</b>에서는 이 칸 안에 바로 나옵니다. <a href="/download">내려받기 ›</a></span>
          {engine === 'google' && !cx && <span className="t-cap">구글은 보안 정책상 다른 사이트 안에 넣을 수 없어 오른쪽에 붙는 별도 창으로 엽니다. 위 검색 종류에서 ‘업무 사이트만’을 고르면 팝업 · 디자인 · 트렌드 · 언론 등 정해 둔 사이트에서만 찾습니다.</span>}
        </div>
      )}
      {err && <span className="t-small t-red">{err}</span>}
      {q && !native && recent.length > 0 && (
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
      {q && !native && me.role === 'admin' && <CxSetting cx={cx} />}
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
