import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Pencil, RefreshCw } from 'lucide-react'
import { useApp } from '../lib/app'
import { driveIdOf, kindOfUrl, previewUrl, serverDriveToken } from '../lib/gdrive'
import { DriveDownload } from './DrivePreview'
import { DrivePreview } from './DrivePreview'
import { useOpenDoc } from './DriveFiles'

/**
 * 보고 · 결재 본문 속 구글 문서 · 드라이브 링크를 전문으로 바로 보여 줌
 * (대표 지시 2026-10-21 "AI 보고할 때 URL 형태로 보고하면 내용 파악이 어려워 전문을 보고할 수 있도록")
 *  - 링크(…/d/<id>) 와 'Drive <id>' 처럼 id 만 적힌 것도 찾음 · 첫 문서는 펼친 채로
 *  - 2026-11-21 대표 지시 '문서를 바로 확인할 수 있는 시스템으로': 구글 미리보기 틀은 브라우저가 구글 로그인 쿠키를 막으면
 *    'Google 계정에 로그인하십시오'만 보였다 → 회사 계정 서버 열쇠(api.driveAccessToken · DrivePreview 와 같음)로 직접 받아 보여 줌.
 *    구글 문서는 HTML 로 받아 글 그대로(스크립트 없는 격리 틀 · 글자 크기 조절) · 시트 · 슬라이드 · PDF 등은 DrivePreview
 *  - 같은 날 '구글로 보내지 말고 인트라넷에서 해결': 구글 미리보기 틀 · 원문(구글) 열기 단추를 없앰. 못 받으면 인트라넷 안에서 다시 시도 · 내려받기
 */
const URL_RE = /https:\/\/(?:docs|drive)\.google\.com\/[^\s)\]"'<>]+/g
const ID_RE = /\b(?:Drive|Doc|문서|드라이브)\s*[:(]?\s*([A-Za-z0-9_-]{25,})/g

export function docLinksIn(...texts: (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const t of texts) {
    if (!t) continue
    for (const m of t.matchAll(URL_RE)) out.push(m[0].replace(/[.,;]+$/, ''))
    for (const m of t.matchAll(ID_RE)) out.push(`https://drive.google.com/file/d/${m[1]}/view`)
  }
  const seen = new Set<string>()
  return out.filter(u => {
    const k = u.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? u
    if (seen.has(k) || !previewUrl(u)) return false
    seen.add(k)
    return true
  })
}

/** 전문 글자 크기 (대표 지시 2026-10-21 "보고 자료의 구글 닥스 폰트가 너무 작아서 못 읽겠어") · 기본 150% · 이 PC에 기억 */
const ZOOM_KEY = 'wkly-doc-zoom'
const readZoom = () => {
  try {
    return Number(localStorage.getItem(ZOOM_KEY)) || 1.5
  } catch {
    return 1.5
  }
}

export function DocFullText({ texts }: { texts: (string | null | undefined)[] }) {
  const links = docLinksIn(...texts)
  if (!links.length) return null
  return (
    <div className="col gap-6">
      {links.map((u, i) => (
        <DocBlock key={u} url={u} first={i === 0} />
      ))}
    </div>
  )
}

function DocBlock({ url, first }: { url: string; first: boolean }) {
  const [open, setOpen] = useState(first)
  const [zoom, setZoom] = useState(readZoom)
  const step = (d: number) =>
    setZoom(z => {
      const v = Math.round(Math.min(2.5, Math.max(1, z + d)) * 10) / 10
      try {
        localStorage.setItem(ZOOM_KEY, String(v))
      } catch {
        /* 기억 못 해도 이번 화면에서는 적용 */
      }
      return v
    })
  const openDoc = useOpenDoc()
  return (
    <div className="doc-full">
      <div className="doc-full-bar">
        <button type="button" className="link-btn row grow" style={{ gap: 4 }} onClick={() => setOpen(v => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileText size={14} /> {kindOfUrl(url).label.replace(/^구글\s*/, '')} 전문 {open ? '접기' : '보기'}
        </button>
        {open && (
          <>
            <button type="button" className="icon-btn sm" onClick={() => step(-0.1)} aria-label="글자 작게" title="글자 작게">
              가−
            </button>
            <span className="t-cap">{Math.round(zoom * 100)}%</span>
            <button type="button" className="icon-btn sm" onClick={() => step(0.1)} aria-label="글자 크게" title="글자 크게">
              가+
            </button>
          </>
        )}
        <button type="button" className="icon-btn sm" onClick={() => openDoc(url)} aria-label="편집" title="인트라넷 안에서 편집">
          <Pencil size={13} />
        </button>
      </div>
      {open && <div className="doc-full-view">
          <DocContent url={url} zoom={zoom} />
        </div>}
    </div>
  )
}

/** 구글 문서 → HTML 글 그대로 · 그 밖의 파일 → DrivePreview (둘 다 회사 계정 서버 열쇠 · 구글 화면으로 보내지 않음) */
export function DocContent({ url, zoom = 1, className = 'doc-full-frame' }: { url: string; zoom?: number; className?: string }) {
  const { api } = useApp()
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'html'; html: string } | { kind: 'file' } | { kind: 'fail'; why: string }>({ kind: 'loading' })
  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    void (async () => {
      const id = driveIdOf(url)
      if (!id) return alive && setState({ kind: 'fail', why: '문서 주소를 알아보지 못했습니다.' })
      const token = await serverDriveToken(() => api.driveAccessToken()).catch(() => null)
      if (!token) return alive && setState({ kind: 'fail', why: '회사 구글 연결을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' })
      const h = { Authorization: `Bearer ${token}` }
      const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=mimeType&supportsAllDrives=true`, { headers: h }).then(r => (r.ok ? r.json() : null)).catch(() => null) as { mimeType?: string } | null
      if (!meta?.mimeType) return alive && setState({ kind: 'fail', why: '회사 계정에 이 문서를 볼 권한이 없거나 문서가 지워졌습니다. 문서 주인에게 info@ 계정 공유를 부탁해 주세요.' })
      if (meta.mimeType !== 'application/vnd.google-apps.document') return alive && setState({ kind: 'file' })
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=text/html`, { headers: h }).catch(() => null)
      if (!r?.ok) return alive && setState({ kind: 'file' })
      const html = await r.text()
      if (alive) setState({ kind: 'html', html: docHtml(html) })
    })()
    return () => { alive = false }
  }, [api, url, tick])
  if (state.kind === 'loading') return <div className={`${className} center t-cap`}>문서를 불러오는 중…</div>
  if (state.kind === 'html') return <iframe className={className} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={state.html} title="문서 전문" style={{ zoom }} />
  if (state.kind === 'file') return <DrivePreview url={url} name="문서" className={className} />
  return (
    <div className={`${className} center col doc-full-fail`}>
      <p className="t-cap">{state.why}</p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setTick(t => t + 1)}><RefreshCw size={13} /> 다시 시도</button>
        <DriveDownload url={url} />
      </div>
    </div>
  )
}

/** 구글 문서 HTML: 링크는 새 창으로 · 읽기 편한 바탕 (스크립트는 격리 틀이 막음) */
export function docHtml(raw: string): string {
  const base = '<base target="_blank"><style>body{margin:0 auto;padding:16px 20px;max-width:860px;background:#fff;color:#1f1f1f;font-family:Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.6}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}</style>'
  return /<head[^>]*>/i.test(raw) ? raw.replace(/<head[^>]*>/i, m => m + base) : base + raw
}
