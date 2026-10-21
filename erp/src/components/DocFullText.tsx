import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, FileText, Pencil } from 'lucide-react'
import { kindOfUrl, previewUrl } from '../lib/gdrive'
import { useOpenDoc } from './DriveFiles'
import { openLink } from './WebSearch'

/**
 * 보고 · 결재 본문 속 구글 문서 · 드라이브 링크를 전문으로 바로 보여 줌
 * (대표 지시 2026-10-21 "AI 보고할 때 URL 형태로 보고하면 내용 파악이 어려워 전문을 보고할 수 있도록")
 *  - 링크(…/d/<id>) 와 'Drive <id>' 처럼 id 만 적힌 것도 찾음 · 첫 문서는 펼친 채로
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
  const src = previewUrl(url)!
  return (
    <div className="doc-full">
      <div className="doc-full-bar">
        <button type="button" className="link-btn row grow" style={{ gap: 4 }} onClick={() => setOpen(v => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileText size={14} /> {kindOfUrl(url).label} 전문 {open ? '접기' : '보기'}
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
        <button type="button" className="icon-btn sm" onClick={() => openLink(url)} aria-label="원문 열기" title="원문 열기">
          <ExternalLink size={13} />
        </button>
      </div>
      {open && <div className="doc-full-view">
          <iframe className="doc-full-frame" src={src} title="문서 전문" loading="lazy" style={{ zoom }} />
        </div>}
    </div>
  )
}
