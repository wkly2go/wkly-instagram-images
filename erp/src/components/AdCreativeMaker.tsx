import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ArrowDownToLine, ImagePlus, Loader2, Save, Wand2 } from 'lucide-react'
import type { MarketingAsset, MarketingCampaign } from '../lib/marketing'
import { AD_SIZES, AD_LAYOUTS, drawAdCreative, adFileName, type AdLayout, type AdText } from '../lib/adCreative'

/**
 * 광고 소재 만들기 (대표 지시 2026-11-17 '광고제작 개발도 진행해')
 * 캠페인 문구 + 사진(올린 소재 또는 내 컴퓨터) → 매체 규격별 이미지(1:1 · 4:5 · 9:16 · 1.91:1)를 브라우저에서 그림.
 * 외부 서비스 · 비용 없음. 저장하면 이 캠페인의 소재로 올라가고, 집행은 하지 않는다.
 */
export function AdCreativeMaker({ draft, assets, disabled, onSave }: {
  draft: MarketingCampaign
  assets: MarketingAsset[]
  disabled?: boolean
  onSave: (files: File[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<AdText>(() => fromDraft(draft))
  const [touched, setTouched] = useState(false)
  const [layout, setLayout] = useState<AdLayout>('band')
  const [sizes, setSizes] = useState<string[]>(() => defaultSizes(draft.platform))
  const [photo, setPhoto] = useState<{ key: string; src: string } | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const canvases = useRef<Record<string, HTMLCanvasElement | null>>({})
  const localUrl = useRef('')
  const fileInput = useRef<HTMLInputElement>(null)
  const images = assets.filter(a => a.url && a.mime.startsWith('image/'))

  // 사진 불러오기 — 올린 소재는 서명 주소라 crossOrigin 이 필요(없으면 저장 때 막힘)
  useEffect(() => {
    if (!photo) { setImg(null); return }
    let alive = true
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => { if (alive) { setImg(el); setError('') } }
    el.onerror = () => { if (alive) { setImg(null); setError('사진을 불러오지 못했습니다. 내 컴퓨터에서 다시 골라 주세요.') } }
    el.src = photo.src
    return () => { alive = false }
  }, [photo])

  useEffect(() => () => { if (localUrl.current) URL.revokeObjectURL(localUrl.current) }, [])

  const chosen = useMemo(() => AD_SIZES.filter(s => sizes.includes(s.key)), [sizes])
  const effectiveLayout: AdLayout = img ? layout : 'color'

  useEffect(() => {
    if (!open) return
    let alive = true
    const fontReady = document.fonts?.load ? Promise.all([document.fonts.load("800 64px 'Pretendard Variable'"), document.fonts.load("500 32px 'Pretendard Variable'")]).catch(() => null) : Promise.resolve(null)
    void fontReady.then(() => {
      if (!alive) return
      for (const s of chosen) {
        const c = canvases.current[s.key]
        if (c) drawAdCreative(c, s, effectiveLayout, img, text, draft.brand)
      }
    })
    return () => { alive = false }
  }, [open, chosen, effectiveLayout, img, text, draft.brand])

  const pickLocal = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) { setError('이미지 파일만 고를 수 있습니다.'); return }
    if (localUrl.current) URL.revokeObjectURL(localUrl.current)
    localUrl.current = URL.createObjectURL(f)
    setPhoto({ key: `local:${f.name}`, src: localUrl.current })
  }

  const blobs = async () => {
    const out: File[] = []
    for (const s of chosen) {
      const c = canvases.current[s.key]
      if (!c) continue
      // 인스타그램 게시는 JPG 만 받으므로 사진이 없는 소재도 JPG 로 저장
      const type = 'image/jpeg'
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        try { c.toBlob(resolve, type, 0.9) } catch (err) { reject(err) }
      })
      if (!blob) throw new Error('이미지를 만들지 못했습니다.')
      out.push(new File([blob], adFileName(draft.title, s, effectiveLayout, type), { type }))
    }
    return out
  }

  const run = async (save: boolean) => {
    if (!chosen.length) { setError('규격을 하나 이상 고르세요.'); return }
    if (!text.headline.trim()) { setError('큰 글(제목)을 넣으세요.'); return }
    setSaving(true); setError('')
    try {
      const files = await blobs()
      if (save) await onSave(files)
      else for (const f of files) download(f)
    } catch (err) {
      setError(err instanceof DOMException && err.name === 'SecurityError'
        ? '이 사진은 보안 설정 때문에 저장할 수 없습니다. 같은 사진을 내 컴퓨터에서 골라 주세요.'
        : err instanceof Error ? err.message : '이미지를 만들지 못했습니다.')
    } finally { setSaving(false) }
  }

  const set = (patch: Partial<AdText>) => { setTouched(true); setText(t => ({ ...t, ...patch })) }

  return (
    <details className="acm" open={open} onToggle={e => { const next = e.currentTarget.open; if (next && !touched) setText(fromDraft(draft)); setOpen(next) }}>
      <summary><Wand2 size={14} /> 광고 이미지 만들기 <small>문구와 사진으로 매체 규격 이미지를 바로 만듭니다 · 비용 없음</small></summary>
      {open && <div className="acm-body">
        <div className="acm-controls">
          <fieldset className="acm-group">
            <legend>사진</legend>
            <div className="acm-photos">
              <button type="button" className={`acm-photo acm-photo-none${!photo ? ' on' : ''}`} onClick={() => setPhoto(null)}>사진 없이<br />색 바탕</button>
              {images.map(a => <button type="button" key={a.id} className={`acm-photo${photo?.key === a.id ? ' on' : ''}`} onClick={() => setPhoto({ key: a.id, src: a.url! })} title={a.name}><img src={a.url} alt={a.name} loading="lazy" /></button>)}
              <button type="button" className={`acm-photo acm-photo-none${photo?.key.startsWith('local:') ? ' on' : ''}`} onClick={() => fileInput.current?.click()}><ImagePlus size={16} /><br />내 컴퓨터</button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickLocal} />
            </div>
          </fieldset>
          <fieldset className="acm-group">
            <legend>배치</legend>
            <div className="acm-seg">{AD_LAYOUTS.map(l => <button type="button" key={l.key} className={effectiveLayout === l.key ? 'on' : ''} disabled={!img && l.key !== 'color'} onClick={() => setLayout(l.key)} title={l.hint}>{l.label}</button>)}</div>
          </fieldset>
          <fieldset className="acm-group">
            <legend>규격</legend>
            <div className="acm-sizes">{AD_SIZES.map(s => <label key={s.key}><input type="checkbox" checked={sizes.includes(s.key)} onChange={e => setSizes(v => e.target.checked ? [...v, s.key] : v.filter(k => k !== s.key))} /> {s.label} <small>{s.w}×{s.h}</small></label>)}</div>
          </fieldset>
          <fieldset className="acm-group acm-text">
            <legend>글 <button type="button" className="link-btn" onClick={() => { setTouched(false); setText(fromDraft(draft)) }}>캠페인 문구 다시 가져오기</button></legend>
            <label>작은 글 (위) <input className="input" value={text.kicker} maxLength={40} onChange={e => set({ kicker: e.target.value })} placeholder="예: 성수 팝업 대관" /></label>
            <label>큰 글 (제목) <textarea className="textarea" rows={2} value={text.headline} maxLength={60} onChange={e => set({ headline: e.target.value })} /></label>
            <label>설명 <input className="input" value={text.sub} maxLength={80} onChange={e => set({ sub: e.target.value })} /></label>
            <label>버튼 <input className="input" value={text.cta} maxLength={20} onChange={e => set({ cta: e.target.value })} /></label>
            <small className="t-cap">글은 이미지에만 쓰이고 캠페인 문구는 바뀌지 않습니다. 가격 · 할인 · 성과 수치는 확인된 것만 넣으세요.</small>
          </fieldset>
        </div>
        <div className="acm-previews">
          {chosen.map(s => <figure key={s.key} className="acm-prev"><canvas ref={el => { canvases.current[s.key] = el }} width={s.w} height={s.h} aria-label={`${s.label} 미리보기`} /><figcaption>{s.label}</figcaption></figure>)}
          {!chosen.length && <p className="t-cap">규격을 고르면 미리보기가 나옵니다.</p>}
        </div>
        {error && <p className="acm-error" role="alert">{error}</p>}
        <div className="acm-actions">
          <button type="button" className="md-button" disabled={saving || !chosen.length} onClick={() => void run(false)}><ArrowDownToLine size={14} />내려받기</button>
          <button type="button" className="md-button md-primary" disabled={saving || disabled || !chosen.length} onClick={() => void run(true)}>{saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}이 캠페인 소재로 저장 ({chosen.length}개)</button>
        </div>
      </div>}
    </details>
  )
}

function fromDraft(d: MarketingCampaign): AdText {
  const first = d.primaryText.split('\n').map(s => s.trim()).find(Boolean) ?? ''
  return { kicker: d.brand === 'wkly' ? '더위클리' : 'ARTERIOR', headline: d.headline || first, sub: d.description || (d.headline ? first : ''), cta: d.cta || '문의하기' }
}

function defaultSizes(platform: MarketingCampaign['platform']) {
  return platform === 'google' ? ['ls', 'sq'] : platform === 'naver' ? ['sq', 'ls'] : ['sq', 'pt', 'st']
}

function download(f: File) {
  const url = URL.createObjectURL(f)
  const a = document.createElement('a')
  a.href = url; a.download = f.name
  document.body.append(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
