// 게시 도구 (2026-11-27 마케팅 자동화 — '블로그 작성과 배포')
// 네이버 블로그 · 홈페이지는 자동 게시가 없어 사람이 붙여 넣는다 → 서식이 살아 있는 글을 한 번에 복사하고, 게시 전 점검과 미리보기를 보여 준다.
// 여기서는 아무것도 게시하지 않는다. 게시한 뒤 '실제 발행 주소'를 적고 채널 상태를 '발행'으로 바꾸는 것은 지금처럼 사람이 한다.
import { useMemo, useState } from 'react'
import { Check, ClipboardCopy, ExternalLink, TriangleAlert } from 'lucide-react'
import { blocksToHtml, blocksToPlain, boldParts, hashTags, parseBlocks, publishChecks, type Block } from '../lib/publishKit'
import './PublishKit.css'

async function copyRich(html: string, plain: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })])
      return
    }
  } catch { /* 서식 복사를 못 하는 브라우저 → 글만 */ }
  await navigator.clipboard.writeText(plain)
}

export function PublishKit({ channel, title, body, tags }: { channel: string; title: string; body: string; tags: string }) {
  const [copied, setCopied] = useState('')
  const [preview, setPreview] = useState(false)
  const blocks = useMemo(() => parseBlocks(body), [body])
  const checks = useMemo(() => publishChecks(channel, title, body, tags), [channel, title, body, tags])
  if (!body.trim()) return null
  const done = (what: string) => { setCopied(what); window.setTimeout(() => setCopied(c => (c === what ? '' : c)), 2500) }
  const run = (what: string, job: () => Promise<void>) => void job().then(() => done(what)).catch(() => done('복사하지 못했습니다.'))
  const rich = (t: string) => boldParts(t).map((x, n) => (x.bold ? <b key={n}>{x.text}</b> : x.text))
  const naver = channel === '네이버 블로그'
  const photos = blocks.filter((b): b is Extract<Block, { type: 'photo' }> => b.type === 'photo')
  const todo = checks.filter(c => !c.ok).length
  const tagText = hashTags(tags)
  return (
    <section className="pk" aria-label={`${channel} 게시 도구`}>
      <header className="pk-head">
        <strong>{channel} 게시 도구</strong>
        <span className="pk-sub">붙여 넣기만 하면 되게 서식을 살려 복사합니다. 게시는 사람이 합니다.</span>
      </header>
      <div className="pk-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => run('제목을 복사했습니다.', () => navigator.clipboard.writeText(title.trim()))}><ClipboardCopy size={13} /> 제목 복사</button>
        <button type="button" className="btn btn-blue btn-sm" onClick={() => run('본문을 서식과 함께 복사했습니다.', () => copyRich(blocksToHtml(blocks), blocksToPlain(blocks)))}><ClipboardCopy size={13} /> 본문 서식 복사</button>
        {naver && tagText && <button type="button" className="btn btn-outline btn-sm" onClick={() => run('태그를 복사했습니다.', () => navigator.clipboard.writeText(tagText))}><ClipboardCopy size={13} /> 태그 복사</button>}
        {naver && <a className="btn btn-outline btn-sm" href="https://section.blog.naver.com/" target="_blank" rel="noreferrer"><ExternalLink size={13} /> 네이버 블로그 열기</a>}
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={preview} onClick={() => setPreview(p => !p)}>{preview ? '미리보기 닫기' : '게시 모양 미리보기'}</button>
        <span className="pk-copied" role="status">{copied}</span>
      </div>
      <ul className="pk-checks" aria-label={`게시 전 점검 · 고칠 것 ${todo}개`}>
        {checks.map(c => <li key={c.label} className={c.ok ? 'ok' : 'todo'}>{c.ok ? <Check size={13} /> : <TriangleAlert size={13} />}<span>{c.label}</span></li>)}
      </ul>
      {photos.length > 0 && <p className="pk-photos"><b>준비할 사진 {photos.length}장</b> {photos.map(p => p.text).join(' · ')}</p>}
      {preview && (
        <div className="pk-preview">
          <h4>{title.trim() || '(제목 없음)'}</h4>
          {blocks.map((b, i) => {
            if (b.type === 'h') return <h5 key={i}>{rich(b.text)}</h5>
            if (b.type === 'photo') return <p key={i} className="pk-photo-slot">사진 자리: {b.text}</p>
            if (b.type === 'ul') return <ul key={i}>{b.items.map((t, n) => <li key={n}>{rich(t)}</li>)}</ul>
            if (b.type === 'ol') return <ol key={i}>{b.items.map((t, n) => <li key={n}>{rich(t)}</li>)}</ol>
            return <p key={i}>{rich(b.text)}</p>
          })}
        </div>
      )}
    </section>
  )
}
