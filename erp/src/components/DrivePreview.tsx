// 드라이브 파일을 인트라넷 창 안에서 바로 보기 (2026-11-19 대표 지시 '현재 창에서 볼 수 있게 만들어')
// 예전엔 drive.google.com/file/d/<id>/preview 를 틀에 넣어, 브라우저가 구글 로그인 쿠키를 막으면 'Google 계정에 로그인하십시오'만 보였다.
// 이제 회사 계정 서버 토큰(api.driveAccessToken · 드라이브 권한만)으로 파일을 받아 이 브라우저 안에서만 보여 준다(어디에도 저장 안 함).
//  - PDF · 사진 · 영상 · 소리 · 글: 원본 그대로 / 구글 문서 · 시트 · 슬라이드: PDF 로 바꿔서
//  - 워드 · 엑셀 · 한글 등이나 60MB 넘는 파일: 구글 미리보기(로그인 필요할 수 있음) + 새 창 · 내려받기 안내
import { useEffect, useState } from 'react'
import { useApp } from '../lib/app'
import { driveIdOf, previewUrl, serverDriveToken } from '../lib/gdrive'

const MAX = 60 * 1024 * 1024
const GOOGLE_EXPORT = /^application\/vnd\.google-apps\.(document|spreadsheet|presentation|drawing)$/
type Shown = { kind: 'pdf' | 'image' | 'video' | 'audio' | 'text'; url: string; text?: string } | { kind: 'fallback'; reason: string } | { kind: 'loading' }

const kindOf = (mime: string): 'pdf' | 'image' | 'video' | 'audio' | 'text' | null =>
  mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('text/') || mime === 'application/json' ? 'text' : null

/** 받은 파일 (내려받기 단추가 같은 것을 씀) */
export type DriveBlob = { blob: Blob; name: string }

export function DrivePreview({ url, name, className, onLoaded }: { url: string; name: string; className?: string; onLoaded?: (b: DriveBlob | null) => void }) {
  const { api } = useApp()
  const [shown, setShown] = useState<Shown>({ kind: 'loading' })
  useEffect(() => {
    const id = driveIdOf(url)
    let alive = true
    let objectUrl: string | null = null
    const fail = (reason: string) => { if (alive) { setShown({ kind: 'fallback', reason }); onLoaded?.(null) } }
    void (async () => {
      if (!id) return fail('드라이브 파일 주소가 아닙니다.')
      const token = await serverDriveToken(() => api.driveAccessToken()).catch(() => null)
      if (!token) return fail('회사 구글 계정 연결을 확인하지 못했습니다.')
      const h = { Authorization: `Bearer ${token}` }
      const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=mimeType,size,name&supportsAllDrives=true`, { headers: h }).catch(() => null)
      if (!metaRes?.ok) return fail('파일 정보를 받지 못했습니다.')
      const meta = (await metaRes.json()) as { mimeType: string; size?: string; name?: string }
      const exportPdf = GOOGLE_EXPORT.test(meta.mimeType)
      const kind = exportPdf ? 'pdf' : kindOf(meta.mimeType)
      if (!kind) return fail('이 형식(워드 · 엑셀 · 한글 · 압축 등)은 인트라넷 안에서 바로 열 수 없습니다.')
      if (Number(meta.size ?? 0) > MAX) return fail('파일이 커서(60MB 넘음) 새 창이나 내려받기로 열어 주세요.')
      const src = exportPdf
        ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=application/pdf`
        : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`
      const r = await fetch(src, { headers: h }).catch(() => null)
      if (!r?.ok) return fail('파일을 받지 못했습니다.')
      const blob = await r.blob()
      if (!alive) return
      const typed = exportPdf ? new Blob([blob], { type: 'application/pdf' }) : blob
      objectUrl = URL.createObjectURL(typed)
      onLoaded?.({ blob: typed, name: exportPdf ? `${meta.name ?? name}.pdf` : meta.name ?? name })
      setShown(kind === 'text' ? { kind, url: objectUrl, text: (await typed.text()).slice(0, 2_000_000) } : { kind, url: objectUrl })
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const cls = className ?? 'fv-frame'
  if (shown.kind === 'loading') return <div className={`${cls} center t-cap`}>불러오는 중…</div>
  if (shown.kind === 'pdf') return <iframe className={cls} src={shown.url} title={`${name} 보기`} />
  if (shown.kind === 'image') return <div className={`${cls} center`}><img src={shown.url} alt={name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></div>
  if (shown.kind === 'video') return <video className={cls} src={shown.url} controls autoPlay />
  if (shown.kind === 'audio') return <div className={`${cls} center`}><audio src={shown.url} controls autoPlay style={{ width: 'min(560px, 90%)' }} /></div>
  if (shown.kind === 'text') return <pre className={`${cls} file-view-text`}>{shown.text}</pre>
  const g = previewUrl(url)
  const reason = shown.kind === 'fallback' ? shown.reason : ''
  return (
    <div className={`${cls} col`} style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="t-cap" style={{ padding: '8px 12px' }}>{reason} 아래 구글 미리보기가 로그인을 물으면 위의 [새 창]으로 열어 주세요.</div>
      {g && <iframe style={{ flex: 1, border: 0, width: '100%' }} src={g} title={`${name} 구글 미리보기`} allow="autoplay" />}
    </div>
  )
}

/** 받아 둔 파일을 이름 그대로 내려받기 */
export function saveBlob(b: DriveBlob) {
  const u = URL.createObjectURL(b.blob)
  const a = document.createElement('a')
  a.href = u
  a.download = b.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(u), 10_000)
}
