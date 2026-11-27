// 한 번에 만들기 (2026-11-20 대표 지시 '실행 버튼 한 번에 광고가 만들어지고 배포까지')
// ① 알릴 내용 한 줄 + (선택) 사진 → '한 번에 만들기'
//    AI 한 번 호출(기획 · 광고 문구 · 블로그 · 인스타 · 유튜브 · 홈페이지 글 · 카드뉴스 장) → 캠페인 저장
//    → 카드뉴스 이미지(표지 = 광고 이미지 · 본문 장 · 마지막 장, 모두 4:5 JPG)를 캠페인 소재로 저장 → 콘텐츠 초안(4채널) 저장
// ② 미리보기 확인 → '승인하고 인스타그램에 게시' 한 번(사용 권리 확인 포함) → 캐러셀로 바로 게시 · 발행 주소 자동 기록
// 블로그 · 유튜브 · 홈페이지는 자동 게시 연결이 없어 글 복사 + 글쓰기 창 열기. 유료 광고 집행 · 결제는 하지 않음(광고 관리자에서 사람이).
// ③ (선택 · 2026-11-27) '릴스 편집도 함께 요청' 을 켜고 촬영 폴더를 고르면 같은 캠페인 말로 영상 편집 요청까지 쌓는다. 게시는 사람이 한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { analysisPicks, pickReference, type AnalysisPick } from '../lib/analysisPicks'
import { coverFile, rankCoverPhotos, type CoverPick } from '../lib/coverPicks'
import { Check, Clapperboard, Copy, ExternalLink, ImagePlus, Loader2, Send, Sparkles, X } from 'lucide-react'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import { AD_SIZES, drawAdCreative } from '../lib/adCreative'
import { approveForInstagram, AUTO_DEFAULT_LINK, autoAdText, autoCampaign, autoCampaignPrompt, autoContentDraft, autoDates, autoReelRequest, MANUAL_POST_URL, parseAutoResult, sourceArticle, type AutoInput, type AutoResult } from '../lib/autoCampaign'
import { CARD_SIZE, drawCardEnd, drawCardSlide } from '../lib/cardNews'
import { newGrowth, type GrowthItem, type GrowthSummary } from '../lib/growth'
import { defaultMarketingCampaign, marketingTodayKST, type MarketingBrand, type MarketingCampaign } from '../lib/marketing'
import { Link } from '../lib/router'
import { VIDEO_SECONDS, VIDEO_TEMPLATES, folderLabel, videoInputProblem, workerState, type VideoSourceFolder, type VideoTemplate } from '../lib/videoEdits'
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

type Made = { r: AutoResult; campaign: MarketingCampaign; item: GrowthItem; images: { name: string; url: string }[]; reel: { ok: boolean; text: string } | null }
type Reel = { on: boolean; loading: boolean; folders: VideoSourceFolder[]; seen: string | null; find: string; folder: string; template: VideoTemplate; seconds: number }

export function AutoCampaignPanel({ onCampaign }: { onCampaign?: (id: string) => void }) {
  const { api, me, toast } = useApp()
  const today = marketingTodayKST()
  // 경쟁사 추적의 '이 주제로 만들기'가 ?topic= 으로 넘김 (2026-11-20)
  const [input, setInput] = useState<AutoInput>(() => ({ topic: (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('topic') ?? '' : '').slice(0, 500), brand: 'wkly', link: '', facts: '', shopUrl: readShop(), ...autoDates(today) }))
  const [photo, setPhoto] = useState<File | null>(null)
  // 프로젝트 사진에서 고르기: 누를 때만 대표 사진을 불러와 알릴 내용과 맞는 순서로 (AI 없음)
  const [covers, setCovers] = useState<{ open: boolean; loading: boolean; all: { projects: Awaited<ReturnType<typeof api.listProjects>>; urls: Record<string, string> } | null; chosen: string; busy: string }>({ open: false, loading: false, all: null, chosen: '', busy: '' })
  const coverList: CoverPick[] = useMemo(() => covers.all ? rankCoverPhotos(input.topic, input.brand, covers.all.projects, covers.all.urls) : [], [covers.all, input.topic, input.brand])
  const openCovers = async () => {
    if (covers.open) { setCovers(c => ({ ...c, open: false })); return }
    setCovers(c => ({ ...c, open: true, loading: !c.all }))
    if (covers.all) return
    const [projects, urls] = await Promise.all([api.listProjects().catch(() => []), api.projectCovers().catch(() => ({}))])
    setCovers(c => ({ ...c, loading: false, all: { projects, urls } }))
  }
  const chooseCover = async (pick: CoverPick) => {
    setCovers(c => ({ ...c, busy: pick.projectId }))
    try {
      const f = await coverFile(pick)
      setPhoto(f); setCovers(c => ({ ...c, chosen: pick.name, busy: '', open: false }))
    } catch (e) { setCovers(c => ({ ...c, busy: '' })); toast(friendlyError(e)) }
  }
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [made, setMade] = useState<Made | null>(null)
  const [publish, setPublish] = useState<{ open: boolean; rights: boolean; busy: string; done: string | null }>({ open: false, rights: false, busy: '', done: null })
  // 분석 → 제작: 최근 분석 자료를 골라 주제 · 참고 자료로 넘김 (고를 때만 불러옴 · AI 없음)
  const [picks, setPicks] = useState<{ open: boolean; loading: boolean; list: AnalysisPick[]; chosen: AnalysisPick | null }>({ open: false, loading: false, list: [], chosen: null })
  const openPicks = async () => {
    if (picks.open) { setPicks(p => ({ ...p, open: false })); return }
    setMine(m => ({ ...m, open: false }))
    setPicks(p => ({ ...p, open: true, loading: !p.list.length }))
    if (picks.list.length) return
    const [research, comp] = await Promise.all([api.listResearch().catch(() => []), api.listCompetitors().catch(() => ({ competitors: [], posts: [] }))])
    const owner = new Map(comp.competitors.filter(c => !c.is_self).map(c => [c.id, c.name]))
    const posts = comp.posts.filter(p => owner.has(p.competitor_id)).map(p => ({ ...p, owner: owner.get(p.competitor_id) }))
    setPicks(p => ({ ...p, loading: false, list: analysisPicks(research, posts, Date.now()) }))
  }
  // 내 글에서 고르기 (2026-11-27 '글 하나를 여러 채널로'): 이미 쓴 콘텐츠 한 편을 원본으로 — 블로그는 그 글 그대로, 나머지 채널 · 카드뉴스를 만듦
  const [mine, setMine] = useState<{ open: boolean; loading: boolean; list: GrowthSummary[]; busy: string }>({ open: false, loading: false, list: [], busy: '' })
  const openMine = async () => {
    if (mine.open) { setMine(m => ({ ...m, open: false })); return }
    setPicks(p => ({ ...p, open: false }))
    setMine(m => ({ ...m, open: true, loading: !m.list.length }))
    if (mine.list.length) return
    const r = await api.listGrowth({ kind: 'content', page: 0, search: '', status: '' }).catch(() => ({ items: [] as GrowthSummary[], hasMore: false }))
    setMine(m => ({ ...m, loading: false, list: r.items }))
  }
  const chooseMine = async (g: GrowthSummary) => {
    setMine(m => ({ ...m, busy: g.id }))
    try {
      const art = sourceArticle(await api.getGrowth(g.id))
      if (!art) { toast('이 콘텐츠에는 300자 넘는 글이 없습니다. 블로그 · 홈페이지 글이 있는 콘텐츠를 골라 주세요.'); setMine(m => ({ ...m, busy: '' })); return }
      setInput(v => ({ ...v, source: art, topic: v.topic.trim() ? v.topic : art.title.slice(0, 500) }))
      setMine(m => ({ ...m, busy: '', open: false }))
    } catch (e) { setMine(m => ({ ...m, busy: '' })); toast(friendlyError(e)) }
  }
  const choose = (p: AnalysisPick) => { setPicks(v => ({ ...v, chosen: p, open: false })); setInput(v => ({ ...v, topic: v.topic.trim() ? v.topic : p.title.slice(0, 500), reference: pickReference(p) })) }
  const unchoose = () => { setPicks(v => ({ ...v, chosen: null })); setInput(v => ({ ...v, reference: '' })) }
  // 릴스 편집도 함께 요청: 켤 때만 촬영 폴더를 불러옴 · 폴더를 골라야 요청함
  const [reel, setReel] = useState<Reel>({ on: false, loading: false, folders: [], seen: null, find: '', folder: '', template: 'cuts', seconds: 20 })
  const toggleReel = async () => {
    if (reel.on) { setReel(v => ({ ...v, on: false })); return }
    setReel(v => ({ ...v, on: true, loading: !v.folders.length }))
    if (reel.folders.length) return
    const [folders, seen] = await Promise.all([api.videoFolders().catch(() => []), api.videoWorkerSeen().catch(() => null)])
    setReel(v => ({ ...v, loading: false, folders, seen }))
  }
  const reelFolders = useMemo(() => {
    const q = reel.find.trim().toLowerCase()
    const list = reel.folders.filter(f => !q || f.path.toLowerCase().includes(q)).slice(0, 40)
    const chosen = reel.folders.find(f => f.path === reel.folder)
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list
  }, [reel.folders, reel.find, reel.folder])
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
      // 5. (선택) 릴스 편집 요청 — 폴더를 골랐을 때만. 실패해도 앞에서 만든 것은 그대로 둔다
      let reelDone: Made['reel'] = null
      if (reel.on && reel.folder) {
        step('릴스 편집을 요청하는 중…')
        const req = autoReelRequest(r, { folder: reel.folder, template: reel.template, seconds: reel.seconds })
        try {
          const problem = videoInputProblem(req)
          if (problem) throw new Error(problem)
          await api.videoRequest(req)
          reelDone = { ok: true, text: workerState(reel.seen) === 'on' ? '릴스 편집을 요청했습니다. 끝나면 알림이 옵니다.' : '릴스 편집 요청을 쌓아 두었습니다. 작업 처리기(맥)가 켜지면 편집합니다.' }
        } catch (e) { reelDone = { ok: false, text: `릴스 편집은 요청하지 못했습니다 — ${friendlyError(e)}` } }
      }
      step(`완료 · AI 비용 ${ai.cost ? `${ai.cost.toFixed(3)}달러` : '확인 중'} · 이미지 ${files.length}장${reelDone?.ok ? ' · 릴스 편집 요청 1건' : ''}`)
      setMade({ r, campaign, item, images, reel: reelDone })
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
        <div><h3><Sparkles size={15} /> 한 번에 만들기</h3><p>알릴 내용 한 줄이면 기획 · 광고 문구 · 카드뉴스 이미지 · 블로그 · 인스타 · 유튜브 · 홈페이지 글까지 만들고, 승인 한 번으로 인스타그램에 게시합니다. 촬영 폴더를 고르면 릴스 편집도 함께 요청합니다.</p></div>
      </header>
      <div className="auto-camp-picks">
        <button type="button" className="btn btn-outline btn-sm" aria-expanded={picks.open} onClick={() => void openPicks()}>분석에서 고르기</button>
        <button type="button" className="btn btn-outline btn-sm" aria-expanded={mine.open} onClick={() => void openMine()}>내 글에서 고르기</button>
        {picks.chosen && <span className="auto-camp-picked"><b>{picks.chosen.group}</b> {picks.chosen.title} <button type="button" className="md-text-button" onClick={unchoose}>빼기</button></span>}
        {input.source && <span className="auto-camp-picked"><b>원본 글</b> {input.source.title} <button type="button" className="md-text-button" onClick={() => setInput(v => ({ ...v, source: undefined }))}>빼기</button></span>}
        {!picks.chosen && !input.source && <small>분석 자료(트렌드 · 팝업 정보 · 경쟁사 인기 글)나 이미 쓴 우리 글을 골라 시작할 수 있습니다.</small>}
        {mine.open && (mine.loading ? <p className="auto-camp-picks-empty">불러오는 중…</p> : mine.list.length === 0 ? <p className="auto-camp-picks-empty">아직 쓴 콘텐츠가 없습니다.</p> : (
          <ul className="auto-camp-pick-list">{mine.list.map(g => (
            <li key={g.id}><button type="button" disabled={!!mine.busy} onClick={() => void chooseMine(g)}><span className="auto-camp-pick-group">{g.status}</span><span className="auto-camp-pick-title">{g.title || '(제목 없음)'}</span><small>{mine.busy === g.id ? '글을 읽는 중…' : `고친 날 ${g.updated_at.slice(0, 10)}`}</small></button></li>
          ))}</ul>
        ))}
        {picks.open && !mine.open && (picks.loading ? <p className="auto-camp-picks-empty">불러오는 중…</p> : picks.list.length === 0 ? <p className="auto-camp-picks-empty">최근 2주 분석 자료가 없습니다.</p> : (
          <ul className="auto-camp-pick-list">{picks.list.map(p => (
            <li key={p.key}><button type="button" onClick={() => choose(p)}><span className="auto-camp-pick-group">{p.group}</span><span className="auto-camp-pick-title">{p.title}</span>{p.source && <small>{p.source}</small>}</button></li>
          ))}</ul>
        ))}
      </div>
      <div className="auto-camp-form">
        <label className="wide"><span>무엇을 알릴까요? *</span><textarea rows={2} maxLength={500} value={input.topic} placeholder="예: 성수 팝업 공간 12월 대관 오픈 — 연말 팝업을 준비하는 브랜드 담당자에게" onChange={e => set({ topic: e.target.value })} /></label>
        <label><span>회사</span><select value={input.brand} onChange={e => set({ brand: e.target.value as MarketingBrand })}><option value="wkly">더위클리</option><option value="arterior">아트리어</option></select></label>
        <label><span>연결 주소</span><input value={input.link} placeholder={AUTO_DEFAULT_LINK[input.brand]} onChange={e => set({ link: e.target.value })} /></label>
        <label><span>시작</span><input type="date" value={input.startDate} onChange={e => set({ startDate: e.target.value })} /></label>
        <label><span>끝</span><input type="date" value={input.endDate} onChange={e => set({ endDate: e.target.value })} /></label>
        <label className="wide"><span>확인된 사실 (선택 · 날짜 · 장소 · 혜택 — 적은 것만 사실로 씀)</span><textarea rows={2} maxLength={1200} value={input.facts} onChange={e => set({ facts: e.target.value })} /></label>
        <label><span>네이버 크리에이터샵 주소 (선택)</span><input value={input.shopUrl ?? ''} placeholder="https://… (블로그 글 끝에 자동으로)" onChange={e => set({ shopUrl: e.target.value })} /></label>
        <label className="auto-camp-photo"><span>표지 사진 (선택)</span>
          <span className="row"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { setPhoto(e.target.files?.[0] ?? null); setCovers(c => ({ ...c, chosen: '' })) }} />{photo ? <small>{covers.chosen ? `프로젝트 사진 · ${covers.chosen}` : photo.name}</small> : <small><ImagePlus size={12} /> 없으면 브랜드 색 표지</small>}</span>
        </label>
        <div className="auto-camp-cover-pick wide">
          <button type="button" className="btn btn-outline btn-sm" aria-expanded={covers.open} onClick={() => void openCovers()}>프로젝트 사진에서 고르기</button>
          {photo && <button type="button" className="md-text-button" onClick={() => { setPhoto(null); setCovers(c => ({ ...c, chosen: '' })) }}>사진 빼기</button>}
          {!covers.open && <small>지난 프로젝트 대표 사진 중 알릴 내용과 맞는 것을 앞에 보여 줍니다.</small>}
          {covers.open && (covers.loading ? <p className="auto-camp-cover-empty">불러오는 중…</p> : coverList.length === 0 ? <p className="auto-camp-cover-empty">대표 사진이 있는 프로젝트가 없습니다. 프로젝트 화면에서 대표 사진을 정하면 여기에 나옵니다.</p> : (
            <ul className="auto-camp-cover-list">{coverList.map((c, i) => (
              <li key={c.projectId}><button type="button" disabled={!!covers.busy} aria-label={`${c.name} 사진을 표지로`} onClick={() => void chooseCover(c)}>
                <img src={c.url} alt="" loading="lazy" />
                <span className="auto-camp-cover-name">{i === 0 && c.score >= 3 && <b>추천 </b>}{c.name}</span>
                <small>{covers.busy === c.projectId ? '가져오는 중…' : c.reasons.join(' · ') || c.place || ' '}</small>
              </button></li>
            ))}</ul>
          ))}
        </div>
        <div className="auto-camp-reel wide">
          <label className="row"><input type="checkbox" checked={reel.on} onChange={() => void toggleReel()} /> <Clapperboard size={14} /> 릴스 편집도 함께 요청 <small>(선택 · 촬영 폴더의 영상으로 자동 편집 · 게시는 직접)</small></label>
          {reel.on && (reel.loading ? <p className="auto-camp-reel-empty">촬영 폴더를 불러오는 중…</p> : reel.folders.length === 0 ? <p className="auto-camp-reel-empty">촬영 폴더가 아직 없습니다. 작업 처리기(맥)가 드라이브의 촬영 폴더를 읽어 오면 여기에 나옵니다.</p> : (
            <div className="auto-camp-reel-grid">
              <label><span>폴더 찾기</span><input value={reel.find} placeholder="이름 일부 (예: 성수)" onChange={e => setReel(v => ({ ...v, find: e.target.value }))} /></label>
              <label className="grow"><span>촬영 폴더 *</span>
                <select value={reel.folder} onChange={e => setReel(v => ({ ...v, folder: e.target.value }))}>
                  <option value="">고르면 릴스 편집을 함께 요청합니다</option>
                  {reelFolders.map(f => { const l = folderLabel(f.path); return <option key={f.path} value={f.path}>{l.name}{l.parent ? ` — ${l.parent}` : ''} · 영상 {f.files}개</option> })}
                </select>
              </label>
              <label><span>편집 방식</span><select value={reel.template} onChange={e => setReel(v => ({ ...v, template: e.target.value as VideoTemplate }))}>{VIDEO_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
              <label><span>길이</span><select value={reel.seconds} onChange={e => setReel(v => ({ ...v, seconds: Number(e.target.value) }))}>{VIDEO_SECONDS.map(n => <option key={n} value={n}>{n}초</option>)}</select></label>
              <small className="auto-camp-reel-help">{VIDEO_TEMPLATES.find(t => t.key === reel.template)!.help} {workerState(reel.seen) === 'on' ? '작업 처리기(맥)가 켜져 있어 몇 분 안에 편집을 시작합니다.' : '작업 처리기(맥)가 꺼져 있으면 켜질 때 편집합니다.'}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="auto-camp-run">
        <Button onClick={() => void run()} disabled={busy || !input.topic.trim()}>{busy ? <><Loader2 size={14} className="spin" /> 만드는 중…</> : <><Sparkles size={14} /> 한 번에 만들기</>}</Button>
        <small>AI 한 번 호출(기존 AI 한도 안) · 광고비 집행은 하지 않습니다.{reel.on && !reel.folder ? ' 촬영 폴더를 고르지 않으면 릴스는 요청하지 않습니다.' : ''}</small>
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
          {made.reel && <p className={`auto-camp-reel-done${made.reel.ok ? '' : ' fail'}`} role="status"><Clapperboard size={14} /> {made.reel.text} <Link to="/ads?tab=video" className="md-text-button">영상 편집에서 보기</Link></p>}
          <div className="auto-camp-channels">
            {(['네이버 블로그', '유튜브', '홈페이지'] as const).map(name => {
              const v = channel(name)
              if (!v || !v.body.trim()) return null
              return (
                <article key={name}>
                  <header><b>{name}</b><span className="row"><button type="button" className="btn btn-outline btn-sm" onClick={() => void copy(`${v.title}\n\n${v.body}`)}><Copy size={12} /> 글 복사</button><a className="btn btn-outline btn-sm" href={MANUAL_POST_URL[name]} target="_blank" rel="noreferrer"><ExternalLink size={12} /> 글쓰기 열기</a></span></header>
                  <strong>{v.title}</strong>
                  <p>{v.body.slice(0, 220)}{v.body.length > 220 ? '…' : ''}</p>
                </article>
              )
            })}
          </div>
          {input.source && <p className="auto-camp-note">블로그는 원본 글을 그대로 씁니다 — <Link to={`/ads?tab=content&item=${input.source.id}`}>{input.source.title}</Link></p>}
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
