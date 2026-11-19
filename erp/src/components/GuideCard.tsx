// 사용 안내 카드 (2026-11-19 대표 지시 '비서는 인트라넷 사용 설명 · 필요하면 영상이나 이미지로') — 채팅 글의 [[안내:id]] 와 사용법 화면에서 씀
import { useState } from 'react'
import { Link } from '../lib/router'
import type { Guide } from '../lib/guides'

export function GuideCard({ g, open: start = false }: { g: Guide; open?: boolean }) {
  const [open, setOpen] = useState(start)
  const [play, setPlay] = useState(false)
  const base = `/manual/guide/${g.id}`
  return (
    <section className="guide-card" aria-label={`사용 안내 · ${g.title}`}>
      <header className="guide-card-h">
        <b className="tx-em">사용 안내 · {g.title}</b>
        <Link to={g.path} className="guide-go">이 화면 열기 ›</Link>
      </header>
      <ol className="guide-steps">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {(g.image || g.video) && (
        <div className="guide-media">
          {g.video && play ? (
            <video src={`${base}.webm`} controls autoPlay muted playsInline poster={g.image ? `${base}.jpg` : undefined} />
          ) : g.image && open ? (
            <a href={`${base}.jpg`} target="_blank" rel="noreferrer"><img src={`${base}.jpg`} alt={`${g.title} 화면`} loading="lazy" decoding="async" /></a>
          ) : null}
          <div className="row wrap guide-media-btns">
            {g.image && !play && <button type="button" className="link-btn" onClick={() => setOpen(v => !v)}>{open ? '화면 사진 접기' : '화면 사진 보기'}</button>}
            {g.video && <button type="button" className="link-btn" onClick={() => setPlay(v => !v)}>{play ? '영상 닫기' : '따라 하기 영상 보기'}</button>}
          </div>
        </div>
      )}
    </section>
  )
}
