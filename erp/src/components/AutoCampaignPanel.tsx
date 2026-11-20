// 한 번에 만들기 (2026-11-20 대표 지시 '실행 버튼 한 번에 광고가 만들어지고 배포까지')
// ① 알릴 내용 한 줄 + (선택) 사진 → '한 번에 만들기'
//    AI 한 번 호출(기획 · 광고 문구 · 블로그 · 인스타 · 유튜브 · 홈페이지 글 · 카드뉴스 장) → 캠페인 저장
//    → 카드뉴스 이미지(표지 = 광고 이미지 · 본문 장 · 마지막 장, 모두 4:5 JPG)를 캠페인 소재로 저장 → 콘텐츠 초안(4채널) 저장
// ② 미리보기 확인 → '승인하고 인스타그램에 게시' 한 번(사용 권리 확인 포함) → 캐러셀로 바로 게시 · 발행 주소 자동 기록
// 블로그 · 유튜브 · 홈페이지는 자동 게시 연결이 없어 글 복사 + 글쓰기 창 열기. 유료 광고 집행 · 결제는 하지 않음(광고 관리자에서 사람이).
import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, ImagePlus, Loader2, Send, Sparkles, X } from 'lucide-react'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import { AD_SIZES, drawAdCreative } from '../lib/adCreative'
import { approveForInstagram, AUTO_DEFAULT_LINK, autoAdText, autoCampaign, autoCampaignPrompt, autoContentDraft, autoDates, MANUAL_POST_URL, parseAutoResult, type AutoInput, type AutoResult } from '../lib/autoCampaign'
import { CARD_SIZE, drawCardEnd, drawCardSlide } from '../lib/cardNews'
import { newGrowth, type GrowthItem } from '../lib/growth'
import { defaultMarketingCampaign, marketingTodayKST, type MarketingBrand, type MarketingCampaign } from '../lib/marketing'
import { Link } from '../lib/router'
import { Button, Modal } from './ui'
import './AutoCampaignPanel.css'

const SHOP_KEY = 'wkly-auto-creator-shop'
const BRAND_NAME: Record<MarketingBrand, string> = { wkly: 'THE WKLY', arterior: 'ARTERIOR' }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const readShop = () => { try { return localStorage.getItem(SHOP_KEY) ?? '' } catch { return '' } }

async function loadImage(file: File): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = URL.createObjectURL(file)
  await img.decode()
  return img
}
async function canvasFile(draw: (c: HTMLCanvasElement) => void, name: string): Promise<File> {
  const c = document.createElement('canvas')
  draw(c)
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.9))
  if (!blob) throw new Error('이미지를 만들지 못했습니다.')
  return new File([blob], name, { type: 'image/jpeg' })
}

type Made = { r: AutoResult; campaign: MarketingCampaign; item: GrowthItem; images: { name: string; url: string }[] }

export function AutoCampaignPanel({ onCampaign }: { onCampaign?: (id: string) => void }) {
  const { api, me, toast } = useApp()
  const today = marketingTodayKST()
  const [input, setInput] = useState<AutoInput>(() => ({ topic: '', brand: 'wkly', link: '', facts: '', shopUrl: readShop(), ...autoDates(today) }))
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [made, setMade] = useState<Made | null>(null)
  const [publish, setPublish] = useState<{ open: boolean; rights: boolean; busy: string; done: string | null }>({ open: false, rights: false, busy: '', done: null })
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), [])
  const set = (p: Partial<AutoInput>) => setInput(v => ({ ...v, ...p }))
  const step = (t: string) => setLog(l => [...l, t])

  const run = async () => {
    if (busy || !input.topic.trim()) return
    setBusy(true); setError(''); setLog([]); setMade(null); setPublish({ open: false, rights: false, busy: '', done: null })
    try { localStorage.setItem(SHOP_KEY, input.shopUrl ?? '') } catch { /* 이 브라우저에만 기억 */ }
    try {
      // 1. AI 한 번 (같은 요청 번호로 결과가 나올 때까지 확인)
      step('AI 가 기획 · 문구 · 채널 글 · 카드뉴스를 쓰는 중…')
      const id = crypto.randomUUID(), prompt = autoCampaignPrompt(input)
      let ai = await api.runGrowthAi({ id, task: 'write', model: 'standard', prompt })
      for (let i = 0; ai.status !== 'completed' && i < 36; i++) { await sleep(5000); ai = await api.runGrowthAi({ id, task: 'write', model: 'standard', prompt }) }
      if (ai.status !== 'completed') throw new Error('AI 결과가 아직 나오지 않았습니다. 잠시 뒤 다시 눌러 주세요(같은 비용이 다시 들지 않게 같은 요청으로 확인합니다).')
      const r = parseAutoResult(ai.text)
      if (!r) throw new Error('AI 답을 읽지 못했습니다. 다시 눌러 주세요.')
      // 2. 캠페인
      step('캠페인을 저장하는 중…')
      const campaign = await api.saveMarketingCampaign(autoCampaign(defaultMarketingCampaign(input.brand), input, r))
      // 3. 카드뉴스 이미지 (표지 · 본문 · 마지막) → 캠페인 소재
      step('카드뉴스 이미지를 만드는 중…')
      const img = photo ? await loadImage(photo) : null
      const brandName = BRAND_NAME[input.brand], link = input.link.trim() || AUTO_DEFAULT_LINK[input.brand]
      const cover = AD_SIZES.find(s => s.key === 'pt') ?? { ...CARD_SIZE }
      const slides = r.slides.slice(0, 7)
      const total = slides.length + 2
      const files: File[] = [await canvasFile(c => drawAdCreative(c, cover, img ? 'overlay' : 'color', img, autoAdText(r), input.brand), '01_표지.jpg')]
      for (const [i, s] of slides.entries()) files.push(await canvasFile(c => drawCardSlide(c, s, i + 2, total, input.brand, brandName), `${String(i + 2).padStart(2, '0')}_${s.title.slice(0, 20).replace(/[\\/:*?"<>|]/g, '_')}.jpg`))
      files.push(await canvasFile(c => drawCardEnd(c, r.cta, link, input.brand, brandName), `${String(total).padStart(2, '0')}_마무리.jpg`))
      const images: Made['images'] = []
      for (const f of files) {
        await api.uploadMarketingAsset(campaign.id, f)
        const u = URL.createObjectURL(f); urls.current.push(u); images.push({ name: f.name, url: u })
      }
      // 4. 콘텐츠 초안 (블로그 · 인스타 · 유튜브 · 홈페이지)
      step('채널별 콘텐츠 초안을 저장하는 중…')
      const item = await api.saveGrowth(crypto.randomUUID(), autoContentDraft(newGrowth('content', me.id), input, r, campaign.id), 0)
      step(`완료 · AI 비용 ${ai.cost ? `${ai.cost.toFixed(3)}달러` : '확인 중'} · 이미지 ${files.length}장`)
      setMade({ r, campaign, item, images })
      onCampaign?.(campaign.id)
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  const doPublish = async () => {
    if (!made || !publish.rights) return
    setPublish(p => ({ ...p, busy: '인스타그램 버전을 승인하는 중…' }))
    try {
      const fresh = await api.getGrowth(made.item.id)
      const approved = await api.saveGrowth(fresh.id, approveForInstagram({ kind: fresh.kind, title: fresh.title, owner_id: fresh.owner_id, status: fresh.status, document: fresh.document, campaign_id: fresh.campaign_id }), fresh.revision)
      setPublish(p => ({ ...p, busy: '게시 내용 확인 중…' }))
      const check = await api.instagramPublish('check', approved.id, approved.revision)
      if (check.issues?.length) throw new Error(check.issues.join(' · '))
      setPublish(p => ({ ...p, busy: '인스타그램에 게시하는 중…' }))
      const res = await api.instagramPublish('publish', approved.id, approved.revision)
      const url = res.item?.document.versions?.find(v => v.channel === '인스타그램')?.publication_url ?? null
      setMade(m => (m && res.item ? { ...m, item: res.item } : m))
      setPublish({ open: false, rights: false, busy: '', done: url ?? '' })
      toast('인스타그램에 게시했습니다.')
    } catch (e) { setPublish(p => ({ ...p, busy: '' })); setError(friendlyError(e)) }
  }

  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('복사했습니다.') } catch { toast('복사가 막혀 있습니다. 글을 직접 골라 복사해 주세요.') } }
  const channel = (name: string) => made?.item.document.versions?.find(v => v.channel === name)

  return (
    <section className="auto-camp" aria-label="한 번에 만들기">
      <header className="auto-camp-head">
        <div><h3><Sparkles size={15} /> 한 번에 만들기</h3><p>알릴 내용 한 줄이면 기획 · 광고 문구 · 카드뉴스 이미지 · 블로그 · 인스타 · 유튜브 · 홈페이지 글까지 만들고, 승인 한 번으로 인스타그램에 게시합니다.</p></div>
      </header>
      <div className="auto-camp-form">
        <label className="wide"><span>무엇을 알릴까요? *</span><textarea rows={2} maxLength={500} value={input.topic} placeholder="예: 성수 팝업 공간 12월 대관 오픈 — 연말 팝업을 준비하는 브랜드 담당자에게" onChange={e => set({ topic: e.target.value })} /></label>
        <label><span>회사</span><select value={input.brand} onChange={e => set({ brand: e.target.value as MarketingBrand })}><option value="wkly">더위클리</option><option value="arterior">아트리어</option></select></label>
        <label><span>연결 주소</span><input value={input.link} placeholder={AUTO_DEFAULT_LINK[input.brand]} onChange={e => set({ link: e.target.value })} /></label>
        <label><span>시작</span><input type="date" value={input.startDate} onChange={e => set({ startDate: e.target.value })} /></label>
        <label><span>끝</span><input type="date" value={input.endDate} onChange={e => set({ endDate: e.target.value })} /></label>
        <label className="wide"><span>확인된 사실 (선택 · 날짜 · 장소 · 혜택 — 적은 것만 사실로 씀)</span><textarea rows={2} maxLength={1200} value={input.facts} onChange={e => set({ facts: e.target.value })} /></label>
        <label><span>네이버 크리에이터샵 주소 (선택)</span><input value={input.shopUrl ?? ''} placeholder="https://… (블로그 글 끝에 자동으로)" onChange={e => set({ shopUrl: e.target.value })} /></label>
        <label className="auto-camp-photo"><span>표지 사진 (선택)</span>
          <span className="row"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />{photo ? <small>{photo.name}</small> : <small><ImagePlus size={12} /> 없으면 브랜드 색 표지</small>}</span>
        </label>
      </div>
      <div className="auto-camp-run">
        <Button onClick={() => void run()} disabled={busy || !input.topic.trim()}>{busy ? <><Loader2 size={14} className="spin" /> 만드는 중…</> : <><Sparkles size={14} /> 한 번에 만들기</>}</Button>
        <small>AI 한 번 호출(기존 AI 한도 안) · 광고비 집행은 하지 않습니다.</small>
      </div>
      {log.length > 0 && <ol className="auto-camp-log" aria-live="polite">{log.map((t, i) => <li key={i}>{i < log.length - 1 || !busy ? <Check size={12} /> : <Loader2 size={12} className="spin" />} {t}</li>)}</ol>}
      {error && <p className="auto-camp-err" role="alert">{error}</p>}

      {made && (
        <div className="auto-camp-result">
          <div className="auto-camp-cards" aria-label="카드뉴스 미리보기">{made.images.map(im => <img key={im.name} src={im.url} alt={im.name} />)}</div>
          <div className="auto-camp-publish">
            {publish.done !== null
              ? <p className="auto-camp-done"><Check size={14} /> 인스타그램에 게시했습니다. {publish.done && <a href={publish.done} target="_blank" rel="noreferrer">게시물 보기</a>}</p>
              : <Button onClick={() => setPublish(p => ({ ...p, open: true }))}><Send size={14} /> 승인하고 인스타그램에 게시</Button>}
            <Link to={`/ads?tab=content&item=${made.item.id}`} className="btn btn-outline btn-sm">콘텐츠에서 다듬기</Link>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onCampaign?.(made.campaign.id)}>캠페인 열기 (광고 집행 자료)</button>
          </div>
          <div className="auto-camp-channels">
            {(['네이버 블로그', '유튜브', '홈페이지'] as const).map(name => {
              const v = channel(name)
              if (!v) return null
              return (
                <article key={name}>
                  <header><b>{name}</b><span className="row"><button type="button" className="btn btn-outline btn-sm" onClick={() => void copy(`${v.title}\n\n${v.body}`)}><Copy size={12} /> 글 복사</button><a className="btn btn-outline btn-sm" href={MANUAL_POST_URL[name]} target="_blank" rel="noreferrer"><ExternalLink size={12} /> 글쓰기 열기</a></span></header>
                  <strong>{v.title}</strong>
                  <p>{v.body.slice(0, 220)}{v.body.length > 220 ? '…' : ''}</p>
                </article>
              )
            })}
          </div>
          <p className="auto-camp-note">블로그 · 유튜브 · 홈페이지는 자동 게시 연결이 없어 글을 붙여 넣은 뒤 ‘콘텐츠에서 다듬기’에 발행 주소를 적어 주세요. 유료 광고는 ‘캠페인 열기’에서 예산을 정하고 광고 관리자에 올립니다.</p>
        </div>
      )}

      {publish.open && made && (
        <Modal title="승인하고 인스타그램에 게시" onClose={() => !publish.busy && setPublish(p => ({ ...p, open: false }))}
          actions={<><Button kind="ghost" disabled={!!publish.busy} onClick={() => setPublish(p => ({ ...p, open: false }))}><X size={13} /> 취소</Button><Button disabled={!publish.rights || !!publish.busy} onClick={() => void doPublish()}>{publish.busy || '지금 게시'}</Button></>}>
          <p>카드뉴스 {made.images.length}장과 아래 글을 회사 인스타그램 계정에 캐러셀로 바로 게시합니다. 게시 뒤에는 인스타그램 앱에서만 지울 수 있습니다.</p>
          <pre className="ig-publish-caption">{`${made.r.instagram.caption}\n\n${made.r.instagram.tags}`}</pre>
          <label className="row"><input type="checkbox" checked={publish.rights} onChange={e => setPublish(p => ({ ...p, rights: e.target.checked }))} /> 이미지 · 문구 사용 권리와 사실 내용을 확인했습니다</label>
        </Modal>
      )}
    </section>
  )
}
