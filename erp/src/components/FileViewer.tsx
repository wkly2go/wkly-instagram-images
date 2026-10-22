import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, ExternalLink, X } from 'lucide-react'
import { previewUrl } from '../lib/gdrive'
import { ImageViewer } from './ImageViewer'

/**
 * 자료를 인트라넷 안에서 보기 (대표 지시 2026-10-22 "자료를 인트라넷에서 볼 수 있게")
 *  - 사진: 확대 보기 · PDF: 브라우저 PDF 보기 · 워드 · 엑셀 · 파워포인트: 오피스 온라인 보기
 *  - 텍스트(txt · md · csv · json): 그대로 · 영상 · 소리: 재생 · 구글 문서 · 드라이브: 미리 보기
 *  - 그 밖(한글 hwp · zip 등)은 볼 수 없어 내려받기 안내
 */
export type ViewKind = 'image' | 'pdf' | 'office' | 'text' | 'video' | 'audio' | 'google' | 'none'
export function viewKind(name: string, mime?: string | null, url?: string | null): ViewKind {
  const m = (mime ?? '').toLowerCase()
  const ext = name.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? ''
  if (url && /^https:\/\/(docs|drive)\.google\.com\//.test(url)) return previewUrl(url) ? 'google' : 'none'
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return 'image'
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext) || /officedocument|msword|ms-excel|ms-powerpoint/.test(m)) return 'office'
  if (m.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'log', 'srt', 'vtt'].includes(ext)) return 'text'
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video'
  if (m.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'ogg', 'aac'].includes(ext)) return 'audio'
  return 'none'
}
export const canView = (name: string, mime?: string | null, url?: string | null) => viewKind(name, mime, url) !== 'none'

export function FileViewer({ name, mime, url, onClose, onDownload }: { name: string; mime?: string | null; url: string; onClose: () => void; onDownload?: () => void }) {
  const kind = viewKind(name, mime, url)
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (kind !== 'text') return
    let alive = true
    fetch(url)
      .then(r => r.text())
      .then(t => alive && setText(t.slice(0, 2_000_000)))
      .catch(() => alive && setText('(내용을 불러오지 못했습니다. 내려받아 열어 주세요.)'))
    return () => {
      alive = false
    }
  }, [kind, url])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (kind === 'image') return <ImageViewer src={url} name={name} onClose={onClose} onDownload={onDownload} />

  const body =
    kind === 'pdf' ? (
      <iframe className="file-view-frame" src={url} title={name} />
    ) : kind === 'office' ? (
      <iframe className="file-view-frame" src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`} title={name} />
    ) : kind === 'google' ? (
      <iframe className="file-view-frame" src={previewUrl(url)!} title={name} allow="autoplay" />
    ) : kind === 'video' ? (
      <video className="file-view-media" src={url} controls autoPlay />
    ) : kind === 'audio' ? (
      <audio src={url} controls autoPlay style={{ width: 'min(560px, 90%)', margin: 'auto' }} />
    ) : kind === 'text' ? (
      <pre className="file-view-text">{text ?? '불러오는 중…'}</pre>
    ) : (
      <div className="file-view-none">
        <b>이 형식은 인트라넷 안에서 바로 볼 수 없습니다.</b>
        <span className="t-cap">한글(hwp) · 압축 파일 등은 내려받아 여세요.</span>
        {onDownload && (
          <button type="button" className="btn btn-blue btn-sm" onClick={onDownload}>
            <Download size={13} /> 내려받기
          </button>
        )}
      </div>
    )

  return createPortal(
    <div className="img-viewer" role="dialog" aria-label={`${name} 보기`}>
      <div className="img-viewer-bar">
        <span className="t-smallb grow truncate">{name}</span>
        {kind === 'office' && <span className="t-cap">오피스 온라인 보기</span>}
        <button type="button" className="icon-btn" onClick={() => window.open(url, '_blank', 'noopener')} aria-label="새 창으로" title="새 창으로 열기">
          <ExternalLink size={16} />
        </button>
        {onDownload && (
          <button type="button" className="icon-btn" onClick={onDownload} aria-label="내려받기" title="내려받기">
            <Download size={16} />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기" title="닫기 (Esc)">
          <X size={18} />
        </button>
      </div>
      <div className="file-view-stage">{body}</div>
    </div>,
    document.body,
  )
}
