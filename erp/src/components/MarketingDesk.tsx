import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, Clipboard, ExternalLink, FileText, ImagePlus, Loader2, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import {
  MARKETING_ASSET_MAX_BYTES, MARKETING_ASSET_MIME_TYPES, MARKETING_BRANDS, MARKETING_GOALS, MARKETING_PLATFORMS,
  buildMarketingAIPrompt, buildMarketingHandoff, buildMarketingHandoffText, buildMarketingUTM,
  defaultMarketingCampaign, generateMarketingCopy, marketingDays, parseMarketingBackup,
  patchMarketingCampaign, validateMarketingCampaign, type MarketingAsset, type MarketingCampaign,
} from '../lib/marketing'
import { ask } from './Ask'
import './MarketingDesk.css'

type Step = 'plan' | 'creative' | 'handoff'
type Backup = ReturnType<typeof parseMarketingBackup>
type ImportJob = Backup['campaigns'][number] & { saved?: MarketingCampaign; uploaded: string[]; assetIds: Record<string, string> }
const money = (value: number | null | undefined) => value == null ? '미정' : `${value.toLocaleString('ko-KR')}원`
const dateLabel = (value: string) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const clone = <T,>(value: T): T => structuredClone(value)
const fileName = (title: string) => (title.trim() || '캠페인').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70)

function download(name: string, body: Blob | string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(typeof body === 'string' ? new Blob([body], { type }) : body)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function FormField({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`md-field${wide ? ' md-wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function CheckRow({ done, children }: { done: boolean; children: ReactNode }) {
  return <li className={done ? 'md-check-done' : ''}><span aria-hidden="true">{done ? <Check size={14} /> : '·'}</span>{children}</li>
}

export function MarketingDesk({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { api, me, toast, profileName } = useApp()
  const canEdit = me.active && me.role === 'admin'
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [draft, setDraft] = useState<MarketingCampaign | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [assets, setAssets] = useState<MarketingAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [assetError, setAssetError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState('')
  const [step, setStep] = useState<Step>('plan')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | MarketingCampaign['status']>('all')
  const [copyFallback, setCopyFallback] = useState('')
  const [importJobs, setImportJobs] = useState<ImportJob[]>([])
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [importDone, setImportDone] = useState(0)
  const imageInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const assetRequest = useRef(0)
  const alive = useRef(true)
  const draftRef = useRef(draft)
  const dirty = !!draft && JSON.stringify(draft) !== savedSnapshot
  const partialImport = importJobs.some(job => !!job.saved)
  const guardRef = useRef({ dirty, busy, partialImport })
  draftRef.current = draft
  guardRef.current = { dirty, busy, partialImport }

  const applySaved = useCallback((campaign: MarketingCampaign) => {
    setDraft(clone(campaign))
    setSavedSnapshot(JSON.stringify(campaign))
    setCampaigns(previous => [campaign, ...previous.filter(item => item.id !== campaign.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }, [])

  const load = useCallback(async (selectId?: string) => {
    setLoading(true)
    setLoadError('')
    try {
      const list = await api.listMarketingCampaigns()
      if (!alive.current) return
      setCampaigns(list)
      const selected = list.find(item => item.id === selectId) ?? list[0] ?? null
      setDraft(selected ? clone(selected) : null)
      setSavedSnapshot(selected ? JSON.stringify(selected) : '')
      setActionError('')
    } catch (error) {
      if (alive.current) setLoadError(friendlyError(error))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    alive.current = true
    void load()
    return () => { alive.current = false; assetRequest.current += 1 }
  }, [load])

  useEffect(() => {
    onDirtyChange?.(dirty || !!busy || partialImport)
  }, [dirty, busy, partialImport, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!guardRef.current.dirty && !guardRef.current.busy && !guardRef.current.partialImport) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onNavigate = (event: Event) => {
      const state = guardRef.current
      if (state.busy) {
        event.preventDefault()
        toast('처리 중입니다. 완료 후 다른 화면으로 이동해 주세요.')
        return
      }
      if (!state.dirty && !state.partialImport) return
      const message = state.partialImport
        ? '일부 백업 항목이 이미 저장되었습니다. 이 화면을 떠나면 현재 가져오기를 이어갈 수 없습니다. 그래도 이동할까요?'
        : '저장하지 않은 변경 내용이 있습니다. 저장하지 않고 다른 화면으로 이동할까요?'
      if (!window.confirm(message)) event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('wkly:before-navigate', onNavigate)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('wkly:before-navigate', onNavigate)
    }
  }, [toast])

  const selectedId = draft?.id
  const isSaved = !!draft && draft.revision > 0
  useEffect(() => {
    const request = ++assetRequest.current
    setAssets([])
    setAssetError('')
    if (!selectedId || !isSaved) { setAssetsLoading(false); return }
    setAssetsLoading(true)
    void api.listMarketingAssets(selectedId).then(list => {
      if (request === assetRequest.current && alive.current) setAssets(list)
    }).catch(error => {
      if (request === assetRequest.current && alive.current) setAssetError(friendlyError(error))
    }).finally(() => {
      if (request === assetRequest.current && alive.current) setAssetsLoading(false)
    })
  }, [api, selectedId, isSaved])

  const validation = useMemo(() => draft ? validateMarketingCampaign(draft, assets, { forHandoff: true }) : { ready: false, errors: [] as string[], warnings: [] as string[] }, [draft, assets])
  const savedCampaign: MarketingCampaign | null = savedSnapshot ? JSON.parse(savedSnapshot) as MarketingCampaign : null
  const reviewFields: (keyof MarketingCampaign)[] = ['title', 'brand', 'goal', 'platform', 'landingUrl', 'sourceUrl', 'audience', 'offer', 'headline', 'primaryText', 'description', 'cta', 'startDate', 'endDate', 'dailyBudget', 'totalBudget', 'textAdConfirmed', 'seasonNote']
  const reviewsLocked = !isSaved || !savedCampaign || !!draft && reviewFields.some(key => draft[key] !== savedCampaign[key])
  const days = draft ? marketingDays(draft) : null
  const filtered = campaigns.filter(item => (filter === 'all' || item.status === filter) && `${item.title} ${item.audience} ${item.offer}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const platform = MARKETING_PLATFORMS.find(item => item.value === draft?.platform)
  const brand = MARKETING_BRANDS.find(item => item.value === draft?.brand)
  const hasCreative = assets.length > 0 || (draft?.platform === 'naver' && draft.textAdConfirmed)
  const reviewCount = draft ? Object.values(draft.reviews).filter(Boolean).length : 0
  const exportReady = !!draft && draft.status === 'ready' && validation.ready && !dirty && isSaved && !assetsLoading && !assetError && !busy

  const change = (patch: Partial<MarketingCampaign>) => {
    if (!canEdit || busy) return
    setDraft(previous => previous ? patchMarketingCampaign(previous, patch) : previous)
    setActionError('')
  }

  const mayLeave = async () => {
    if (busy) return false
    return !dirty || await ask('저장하지 않은 변경 내용이 있습니다. 저장하지 않고 이동할까요?')
  }

  const selectCampaign = async (campaign: MarketingCampaign) => {
    if (draft?.id === campaign.id || !await mayLeave()) return
    setDraft(clone(campaign))
    setSavedSnapshot(JSON.stringify(campaign))
    setActionError('')
    setStep('plan')
    setCopyFallback('')
  }

  const createCampaign = async () => {
    if (!canEdit || !await mayLeave()) return
    setDraft(defaultMarketingCampaign())
    setSavedSnapshot('')
    setAssets([])
    setStep('plan')
    setActionError('')
    setCopyFallback('')
  }

  const saveCurrent = async (ready = false): Promise<MarketingCampaign | null> => {
    if (!draft || !canEdit) return null
    const candidate = { ...draft, status: ready ? 'ready' as const : draft.status }
    const result = validateMarketingCampaign(candidate, assets, { forHandoff: ready || candidate.status === 'ready' })
    if (result.errors.length) { setActionError(result.errors.join('\n')); return null }
    const saved = await api.saveMarketingCampaign(candidate)
    if (alive.current) applySaved(saved)
    return saved
  }

  const save = async (ready = false) => {
    if (busy) return
    setBusy('저장 중')
    setActionError('')
    try {
      const saved = await saveCurrent(ready)
      if (saved) toast(saved.status === 'ready' ? '검토를 마친 캠페인을 준비 완료로 저장했습니다.' : ready ? '변경 내용을 저장했습니다. 검토 항목을 확인한 뒤 준비 완료로 저장해 주세요.' : '캠페인을 저장했습니다.')
    } catch (error) { setActionError(friendlyError(error)) }
    finally { setBusy('') }
  }

  const refreshAssets = async (campaignId: string) => {
    const request = ++assetRequest.current
    const [list, all] = await Promise.all([api.listMarketingAssets(campaignId), api.listMarketingCampaigns()])
    if (!alive.current || request !== assetRequest.current || draftRef.current?.id !== campaignId) return
    const updated = all.find(item => item.id === campaignId)
    setCampaigns(all)
    setAssets(list)
    setAssetError('')
    if (updated) applySaved(updated)
  }

  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!draft || !canEdit || busy || !files.length) return
    const invalid = files.find(file => !MARKETING_ASSET_MIME_TYPES.some(mime => mime === file.type) || file.size <= 0 || file.size > MARKETING_ASSET_MAX_BYTES)
    if (invalid) { setActionError(`${invalid.name}: 8MB 이하의 JPEG·PNG·WebP 이미지만 올릴 수 있습니다.`); return }
    setBusy('소재 올리는 중')
    setActionError('')
    let campaignId = ''
    try {
      const saved = dirty || !isSaved ? await saveCurrent() : draft
      if (!saved) return
      campaignId = saved.id
      for (const file of files) await api.uploadMarketingAsset(saved.id, file)
      toast(`${files.length}개 소재를 올렸습니다. 문구·권리 확인을 다시 해 주세요.`)
    } catch (error) { setActionError(friendlyError(error)) }
    finally {
      if (campaignId) {
        try { await refreshAssets(campaignId) }
        catch (error) { setAssetError(friendlyError(error)) }
      }
      setBusy('')
    }
  }

  const removeAsset = async (asset: MarketingAsset) => {
    if (!canEdit || busy || !await ask(`'${asset.name}' 소재를 이 캠페인에서 삭제할까요?`)) return
    setBusy('소재 삭제 중')
    setActionError('')
    try {
      if (dirty && !await saveCurrent()) return
      await api.deleteMarketingAsset(asset.id)
      await refreshAssets(asset.campaignId)
      toast('소재를 삭제했습니다. 문구·권리 확인을 다시 해 주세요.')
    } catch (error) { setActionError(friendlyError(error)) }
    finally { setBusy('') }
  }

  const copy = async (text: string, message: string) => {
    try { await navigator.clipboard.writeText(text); toast(message); setCopyFallback('') }
    catch { setCopyFallback(text); toast('아래 내용을 선택해 복사해 주세요.') }
  }

  const generateCopy = async () => {
    if (!draft || !canEdit || busy) return
    if ((draft.headline || draft.primaryText) && !await ask('기존 광고 문구를 선택한 브랜드의 문구 예시으로 바꿀까요?')) return
    change(generateMarketingCopy(draft))
    toast('브랜드의 문구 예시를 채웠습니다. 기획에 맞게 수정하고 사실·혜택·표현을 검토해 주세요.')
  }

  const handoff = async (format: 'txt' | 'json') => {
    if (!draft || !exportReady) return
    setBusy('집행자료 확인 중')
    setActionError('')
    try {
      const latest = (await api.listMarketingCampaigns()).find(item => item.id === draft.id)
      if (!latest || latest.revision !== draft.revision) throw new Error('다른 작업에서 캠페인이 변경되었습니다. 새로고침해 최신 내용과 검토 상태를 확인해 주세요.')
      if (format === 'txt') download(`${fileName(draft.title)}_집행자료.txt`, buildMarketingHandoffText(draft, assets))
      else download(`${fileName(draft.title)}_집행자료.json`, JSON.stringify(buildMarketingHandoff(draft, assets), null, 2), 'application/json;charset=utf-8')
      toast('집행자료를 내려받았습니다. 광고 관리자에서 등록 내용을 확인해 주세요.')
    } catch (error) { setActionError(friendlyError(error)) }
    finally { setBusy('') }
  }

  const downloadAsset = async (asset: MarketingAsset) => {
    if (!asset.url) return
    try {
      const response = await fetch(asset.url)
      if (!response.ok) throw new Error('소재 다운로드 주소가 만료되었습니다. 새로고침 후 다시 시도해 주세요.')
      download(asset.name, await response.blob())
    } catch (error) { setActionError(friendlyError(error)) }
  }

  const previewBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !canEdit || busy) return
    if (file.size > 64 * 1024 * 1024) { setActionError('백업 파일은 64MB 이하로 올려 주세요.'); return }
    setBusy('백업 확인 중')
    setActionError('')
    try {
      const backup = parseMarketingBackup(await file.text())
      setImportJobs(backup.campaigns.map(entry => ({ ...entry, uploaded: [], assetIds: Object.fromEntries(entry.assets.map(asset => [asset.sourceId, crypto.randomUUID()])) })))
      setImportWarnings(backup.warnings)
      setImportDone(0)
      if (!backup.campaigns.length) setActionError('백업 파일에 가져올 캠페인이 없습니다.')
    } catch (error) { setActionError(friendlyError(error)) }
    finally { setBusy('') }
  }

  const importBackup = async () => {
    if (!canEdit || busy || !importJobs.length) return
    if (!await mayLeave()) return
    setBusy('백업 가져오는 중')
    setActionError('')
    const queue = importJobs.map(job => ({ ...job, uploaded: [...job.uploaded] }))
    let done = importDone
    let latestId: string | undefined
    try {
      const known = await api.listMarketingCampaigns()
      while (queue.length) {
        const job = queue[0]
        if (!job.saved) {
          job.saved = known.find(item => item.id === job.campaign.id) ?? await api.saveMarketingCampaign(job.campaign)
          setImportJobs(queue.map(item => ({ ...item, uploaded: [...item.uploaded] })))
        }
        latestId = job.saved.id
        for (const asset of job.assets) {
          if (job.uploaded.includes(asset.sourceId)) continue
          const bytes = new Uint8Array(asset.bytes).buffer
          await api.uploadMarketingAsset(job.saved.id, new File([bytes], asset.name, { type: asset.mime }), job.assetIds[asset.sourceId])
          job.uploaded.push(asset.sourceId)
          setImportJobs(queue.map(item => ({ ...item, uploaded: [...item.uploaded] })))
        }
        queue.shift()
        done += 1
        setImportDone(done)
        setImportJobs(queue.map(item => ({ ...item, uploaded: [...item.uploaded] })))
      }
      setImportWarnings([])
      await load(latestId)
      toast(`${done}개 캠페인을 새 초안으로 가져왔습니다. 예산과 소재를 다시 검토해 주세요.`)
    } catch (error) {
      setActionError(`${done}개 캠페인 가져오기 완료. 남은 항목은 아래에서 이어서 가져올 수 있습니다.\n${friendlyError(error)}`)
      try { setCampaigns(await api.listMarketingCampaigns()) } catch { /* 기존 목록을 유지합니다. */ }
    } finally { setBusy('') }
  }

  return (
    <section className="marketing-desk" aria-label="마케팅 데스크">
      <header className="md-head">
        <div><p className="md-eyebrow">WKLY MARKETING DESK</p><h2>캠페인 준비</h2><p>기획부터 소재·예산 검토, 광고 등록 자료까지 한곳에서 준비합니다.</p></div>
        <div className="md-actions">
          <button type="button" className="md-button md-subtle" disabled={!!busy || loading} onClick={async () => { if (await mayLeave()) await load(draft?.id) }} aria-label="캠페인 새로고침"><RefreshCw size={15} /><span>새로고침</span></button>
          {canEdit && <button type="button" className="md-button md-primary" disabled={!!busy || loading || !!loadError} onClick={() => void createCampaign()}><Plus size={16} />새 캠페인</button>}
        </div>
      </header>

      <div className="md-note"><span className="md-note-dot" />{api.mode === 'demo' ? '체험용 작업 공간 · 이 브라우저에 저장' : canEdit ? '회사 공용 작업 공간 · 관리자 작성 · 팀원 조회' : '회사 공용 작업 공간 · 읽기 전용'}<span>광고 등록과 결제는 각 광고 관리자에서 최종 실행합니다.</span></div>

      {loadError && <div className="md-error" role="alert"><strong>공용 캠페인을 불러오지 못했습니다.</strong><p>{loadError}</p><p>저장소 연결과 접근 권한을 확인한 뒤 다시 시도해 주세요.</p><button type="button" className="md-button" disabled={loading} onClick={() => void load(draft?.id)}>다시 불러오기</button></div>}
      {actionError && <div className="md-error" role="alert"><strong>확인이 필요합니다.</strong><p>{actionError}</p><button type="button" className="md-text-button" onClick={() => setActionError('')}>안내 닫기</button></div>}

      <div className="md-library">
        <div className="md-library-head">
          <div className="md-heading"><h3>캠페인</h3><span className="md-count">{campaigns.length}</span></div>
          <div className="md-actions">
            <label className="md-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label="캠페인 검색" placeholder="캠페인 검색" value={search} onChange={event => setSearch(event.target.value)} /></label>
            <select className="md-filter" aria-label="캠페인 상태" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">모든 상태</option><option value="draft">작성 중</option><option value="ready">준비 완료</option></select>
          </div>
        </div>
        {loading ? <div className="md-empty" role="status"><Loader2 size={19} className="md-spin" />캠페인을 불러오는 중입니다.</div> : loadError ? <div className="md-empty">공용 저장소에 연결되면 캠페인 목록을 확인할 수 있습니다.</div> : !campaigns.length ? <div className="md-empty"><FileText size={24} /><strong>첫 캠페인을 준비해 보세요.</strong><span>{canEdit ? '목표와 예산을 정하고, 광고 문구와 이미지를 함께 검토할 수 있습니다.' : '관리자가 저장한 캠페인이 여기에 표시됩니다.'}</span>{canEdit && !loadError && <button type="button" className="md-button" onClick={() => void createCampaign()}><Plus size={14} />캠페인 만들기</button>}</div> : !filtered.length ? <div className="md-empty">검색 조건에 맞는 캠페인이 없습니다.</div> : <div className="md-campaigns" aria-label="저장된 캠페인 목록">{filtered.map(item => <button type="button" key={item.id} className={`md-campaign${draft?.id === item.id ? ' selected' : ''}`} onClick={() => void selectCampaign(item)} disabled={!!busy} aria-pressed={draft?.id === item.id}><span className="md-campaign-top"><span>{MARKETING_BRANDS.find(b => b.value === item.brand)?.label} · {MARKETING_PLATFORMS.find(p => p.value === item.platform)?.label}</span><span className={`md-status ${item.status}`}>{item.status === 'ready' ? '준비 완료' : '작성 중'}</span></span><strong>{item.title || '제목 없는 캠페인'}</strong><span className="md-campaign-bottom"><span>총 계획예산 {money(item.totalBudget)}</span><time dateTime={item.updatedAt}>{dateLabel(item.updatedAt)}</time></span></button>)}</div>}
        {canEdit && <div className="md-import-row"><button type="button" className="md-text-button" disabled={!!busy || !!loadError || importJobs.length > 0} onClick={() => backupInput.current?.click()}><Upload size={13} />기존 마케팅 데스크 백업 가져오기</button><small>캠페인과 이미지를 새 초안으로 추가합니다.</small><input ref={backupInput} className="md-file-input" tabIndex={-1} type="file" accept="application/json,.json" aria-label="마케팅 데스크 백업 파일" onChange={event => void previewBackup(event)} /></div>}
      </div>

      {importJobs.length > 0 && <div className="md-import-preview"><h3>백업 가져오기 확인</h3><p>{importDone > 0 && `${importDone}개 완료 · `}남은 캠페인 {importJobs.length}개 · 이미지 {importJobs.reduce((count, job) => count + job.assets.length - job.uploaded.length, 0)}개</p><p>기존 공용 캠페인은 유지합니다. 가져온 캠페인의 상태와 검토 항목은 다시 확인해야 합니다.</p>{partialImport && <p className="md-warning-text">일부 항목은 이미 저장되었습니다. 이 화면에서 이어서 가져오면 같은 소재를 중복 추가하지 않습니다.</p>}<ul>{importJobs.slice(0, 6).map(job => <li key={job.campaign.id}>{job.campaign.title || '제목 없는 캠페인'} · 이미지 {job.assets.length}개</li>)}</ul>{importJobs.length > 6 && <small>외 {importJobs.length - 6}개</small>}{importWarnings.map((warning, index) => <p className="md-warning" key={index}>{warning}</p>)}<div className="md-actions"><button type="button" className="md-button md-primary" disabled={!!busy} onClick={() => void importBackup()}>{importDone ? '남은 항목 이어서 가져오기' : '새 초안으로 가져오기'}</button><button type="button" className="md-button" disabled={!!busy} onClick={async () => { if (partialImport && !await ask('일부 캠페인과 소재가 이미 저장되었습니다. 이어서 가져오기 기록을 닫을까요? 저장된 항목은 캠페인 목록에 남습니다.')) return; setImportJobs([]); setImportWarnings([]) }}>닫기</button></div></div>}

      {draft && <div className="md-workspace">
        <div className="md-editor">
          <div className="md-editor-head"><div><span className={`md-status ${draft.status}`}>{!isSaved ? '새 초안' : draft.status === 'ready' ? '준비 완료' : '작성 중'}</span><h3>{draft.title || '새 캠페인'}</h3></div><span className={`md-save-state${dirty ? ' unsaved' : ''}`} role="status">{busy ? <><Loader2 size={13} className="md-spin" />{busy}</> : dirty ? '저장하지 않은 변경' : <><Check size={13} />저장됨 · {dateLabel(draft.updatedAt)}</>}</span></div>
          <div className="md-steps" role="tablist" aria-label="캠페인 준비 단계" onKeyDown={event => { const order: Step[] = ['plan', 'creative', 'handoff']; const index = order.indexOf(step); const next = event.key === 'ArrowRight' ? order[(index + 1) % 3] : event.key === 'ArrowLeft' ? order[(index + 2) % 3] : event.key === 'Home' ? order[0] : event.key === 'End' ? order[2] : null; if (next) { event.preventDefault(); setStep(next); document.getElementById(`md-tab-${next}`)?.focus() } }}>{([['plan', '01', '기획·예산'], ['creative', '02', '문구·소재'], ['handoff', '03', '검토·집행자료']] as const).map(([key, number, label]) => <button type="button" key={key} role="tab" id={`md-tab-${key}`} aria-controls={`md-panel-${key}`} aria-selected={step === key} tabIndex={step === key ? 0 : -1} className={step === key ? 'active' : ''} onClick={() => setStep(key)}><span>{number}</span>{label}</button>)}</div>

          <fieldset className="md-fields" aria-label="캠페인 설정" disabled={!canEdit || !!busy}>
            {step === 'plan' && <div id="md-panel-plan" role="tabpanel" aria-labelledby="md-tab-plan">
              <div className="md-section-title"><h4>무엇을, 누구에게 알릴까요?</h4><span>기획</span></div>
              <div className="md-form-grid">
                <FormField label="캠페인 이름" wide><input value={draft.title} onChange={event => change({ title: event.target.value })} placeholder="예: 연말 브랜드 행사 공간 대관" maxLength={160} /></FormField>
                <FormField label="브랜드"><select value={draft.brand} onChange={event => change({ brand: event.target.value as MarketingCampaign['brand'] })}>{MARKETING_BRANDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></FormField>
                <FormField label="광고 매체"><select value={draft.platform} onChange={event => change({ platform: event.target.value as MarketingCampaign['platform'] })}>{MARKETING_PLATFORMS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></FormField>
                <FormField label="광고 목표"><select value={draft.goal} onChange={event => change({ goal: event.target.value as MarketingCampaign['goal'] })}>{MARKETING_GOALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></FormField>
                <FormField label="핵심 고객"><input value={draft.audience} onChange={event => change({ audience: event.target.value })} placeholder="지역 · 관심사 · 담당자의 필요" maxLength={1000} /></FormField>
                <FormField label="핵심 제안·혜택" hint="확인된 서비스와 실제 제공 가능한 혜택만 적어 주세요." wide><textarea value={draft.offer} onChange={event => change({ offer: event.target.value })} rows={3} placeholder="광고에서 가장 먼저 전달할 내용을 적어 주세요." maxLength={2000} /></FormField>
                <FormField label="랜딩 페이지" hint="광고를 누른 고객이 도착할 https:// 주소" wide><input type="url" value={draft.landingUrl} onChange={event => change({ landingUrl: event.target.value })} placeholder="https://" maxLength={2048} /></FormField>
                <FormField label="참고 자료 주소" wide><input type="url" value={draft.sourceUrl} onChange={event => change({ sourceUrl: event.target.value })} placeholder="소개 페이지·자료 링크 (선택)" maxLength={2048} /></FormField>
                <FormField label="시즌·이벤트 메모" hint="시즌 일정과 변경 조건을 적으면 AI 기획 요청과 집행자료에 함께 담깁니다." wide><textarea value={draft.seasonNote} onChange={event => change({ seasonNote: event.target.value })} rows={3} placeholder="예: 연말 대관 문의 집중 · 예약 마감 시 문구 교체" maxLength={3000} /></FormField>
              </div>
              <div className="md-section-title"><h4>기간과 집행 한도를 정하세요</h4><span>계획예산 · 원</span></div>
              <div className="md-form-grid">
                <FormField label="시작일"><input type="date" value={draft.startDate} onChange={event => change({ startDate: event.target.value })} /></FormField>
                <FormField label="종료일"><input type="date" value={draft.endDate} onChange={event => change({ endDate: event.target.value })} /></FormField>
                <FormField label="일 계획예산 (원)"><input type="number" inputMode="numeric" min="1" step="1" value={draft.dailyBudget ?? ''} onChange={event => change({ dailyBudget: event.target.value === '' ? null : Number(event.target.value) })} placeholder="미정" /></FormField>
                <FormField label="총 계획예산 (원)"><input type="number" inputMode="numeric" min="1" step="1" value={draft.totalBudget ?? ''} onChange={event => change({ totalBudget: event.target.value === '' ? null : Number(event.target.value) })} placeholder="집행 한도" /></FormField>
              </div>
              <div className="md-budget"><div><span>집행 기간</span><strong>{days ?? '—'}<small>일</small></strong></div><div><span>일 예산 × 기간</span><strong>{draft.dailyBudget && days ? money(draft.dailyBudget * days) : '미정'}</strong></div><div><span>총 계획예산</span><strong>{money(draft.totalBudget)}</strong></div></div>
              <p className="md-help">계획예산을 저장해도 결제되거나 광고 매체의 예산이 변경되지 않습니다.</p>
            </div>}

            {step === 'creative' && <div id="md-panel-creative" role="tabpanel" aria-labelledby="md-tab-creative">
              <div className="md-section-title"><h4>광고 문구를 다듬으세요</h4><span>소재 제작</span></div>
              <div className="md-copy-tools"><button type="button" className="md-button" onClick={() => void generateCopy()}><FileText size={14} />문구 초안 채우기</button><small>선택한 브랜드·목표에 맞는 고정 문구 예시입니다.</small></div>
              <div className="md-form-grid">
                <FormField label="제목" hint={`${draft.headline.length}자 · 매체의 최종 글자 수 제한은 등록 화면에서 확인하세요.`} wide><input value={draft.headline} onChange={event => change({ headline: event.target.value })} maxLength={300} placeholder="고객의 관심을 끌 핵심 한 문장" /></FormField>
                <FormField label="본문" wide><textarea value={draft.primaryText} onChange={event => change({ primaryText: event.target.value })} rows={5} maxLength={10000} placeholder="대상 고객 · 제안 · 문의 방법을 명확하게 적어 주세요." /></FormField>
                <FormField label="보조 설명" wide><input value={draft.description} onChange={event => change({ description: event.target.value })} maxLength={2000} placeholder="광고 아래 덧붙일 짧은 설명" /></FormField>
                <FormField label="행동 유도 문구"><input value={draft.cta} onChange={event => change({ cta: event.target.value })} maxLength={80} placeholder="예: 대관 문의하기" /></FormField>
              </div>
              <div className="md-section-title"><h4>광고 이미지를 연결하세요</h4><span>{assets.length}개 소재</span></div>
              <div className="md-upload"><ImagePlus size={24} /><div><strong>JPEG · PNG · WebP</strong><p>파일당 최대 8MB · 원본과 캠페인을 함께 보관합니다.</p></div><button type="button" className="md-button" disabled={!!busy || !!assetError} onClick={() => imageInput.current?.click()}><Plus size={15} />이미지 선택</button><input ref={imageInput} className="md-file-input" tabIndex={-1} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="광고 이미지 파일" onChange={event => void uploadImages(event)} /></div>
              {!isSaved && <p className="md-help">이미지를 올리면 현재 기획을 먼저 저장합니다.</p>}
              {draft.platform === 'naver' && <label className="md-review"><input type="checkbox" checked={draft.textAdConfirmed} onChange={event => change({ textAdConfirmed: event.target.checked })} /><span><strong>이미지 없이 텍스트 검색광고로 준비합니다</strong><small>실제 매체 상품의 소재 조건을 확인했습니다.</small></span></label>}
              <p className="md-help">소재를 추가하거나 삭제하면 문구·권리 확인 항목이 해제됩니다.</p>
            </div>}

            {step === 'handoff' && <div id="md-panel-handoff" role="tabpanel" aria-labelledby="md-tab-handoff">
              <div className="md-section-title"><h4>집행 전 확인하세요</h4><span>{reviewCount}/3 확인</span></div>
              {reviewsLocked && <div className="md-review-note"><strong>변경 내용을 먼저 저장해 주세요.</strong><p>저장된 기획·예산·소재를 기준으로 아래 확인 항목을 체크할 수 있습니다.</p></div>}
              <div className="md-reviews">
                <label className="md-review"><input type="checkbox" disabled={reviewsLocked} checked={draft.reviews.content} onChange={event => change({ reviews: { ...draft.reviews, content: event.target.checked } })} /><span><strong>광고 내용과 랜딩 페이지 확인</strong><small>제목·본문·혜택이 사실과 맞고, 연결된 페이지에서 문의할 수 있습니다.</small></span></label>
                <label className="md-review"><input type="checkbox" disabled={reviewsLocked} checked={draft.reviews.rights} onChange={event => change({ reviews: { ...draft.reviews, rights: event.target.checked } })} /><span><strong>이미지·문구 사용 권리 확인</strong><small>사진 속 인물, 공간, 상표와 제공 자료의 광고 사용 권리를 확인했습니다.</small></span></label>
                <label className="md-review"><input type="checkbox" disabled={reviewsLocked} checked={draft.reviews.budget} onChange={event => change({ reviews: { ...draft.reviews, budget: event.target.checked } })} /><span><strong>기간과 계획예산 확인</strong><small>일 예산 {money(draft.dailyBudget)} · 총 계획예산 {money(draft.totalBudget)} · {draft.startDate || '시작일 미정'} ~ {draft.endDate || '종료일 미정'}</small></span></label>
              </div>
            </div>}
          </fieldset>

          {step === 'creative' && <div className="md-assets-section">
            {assetsLoading && <p className="md-help" role="status">소재를 불러오는 중입니다.</p>}
            {assetError && <div className="md-error" role="alert"><p>소재를 불러오지 못했습니다. {assetError}</p><button type="button" className="md-button" disabled={!!busy} onClick={() => void refreshAssets(draft.id).catch(error => setAssetError(friendlyError(error)))}>소재 다시 불러오기</button></div>}
            <div className="md-assets">{assets.map(asset => <article className="md-asset" key={asset.id}>{asset.url ? <img src={asset.url} alt={asset.name} loading="lazy" /> : <div className="md-image-empty"><ImagePlus size={24} /><span>미리보기 없음</span></div>}<div><strong title={asset.name}>{asset.name}</strong><small>{(asset.size / 1024 / 1024).toFixed(1)}MB{asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}</small><div className="md-actions"><button type="button" className="md-text-button" disabled={!asset.url || !!busy} onClick={() => void downloadAsset(asset)}><ArrowDownToLine size={13} />원본 받기</button>{canEdit && <button type="button" className="md-text-button md-danger" disabled={!!busy} onClick={() => void removeAsset(asset)} aria-label={`${asset.name} 삭제`}><Trash2 size={13} />삭제</button>}</div></div></article>)}</div>
          </div>}

          {step === 'handoff' && <div className="md-handoff-section">
            {!validation.ready && <div className="md-needs"><strong>준비를 마치려면 다음 내용을 확인해 주세요.</strong><ul>{validation.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
            {validation.warnings.length > 0 && <div className="md-warning"><strong>매체 등록 시 확인할 내용</strong><ul>{validation.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
            <div className="md-utm"><h4>추적 링크 (UTM)</h4><code>{draft.landingUrl ? (() => { try { return buildMarketingUTM(draft) || '랜딩 페이지 주소를 확인해 주세요.' } catch { return '랜딩 페이지 주소를 확인해 주세요.' } })() : '랜딩 페이지 주소를 입력해 주세요.'}</code><button type="button" className="md-text-button" disabled={!draft.landingUrl} onClick={() => { try { const url = buildMarketingUTM(draft); if (!url) throw new Error('랜딩 페이지 주소를 확인해 주세요.'); void copy(url, '추적 링크를 복사했습니다.') } catch (error) { setActionError(friendlyError(error)) } }}><Clipboard size={13} />링크 복사</button></div>
            <div className="md-handoff"><div><h4>광고 등록 자료 내려받기</h4><p>검토한 문구·예산·일정·추적 링크를 광고 관리자에 옮겨 등록합니다. 이미지는 소재 화면에서 원본을 받으세요.</p>{dirty ? <p className="md-warning-text">변경 내용을 먼저 저장해 주세요.</p> : draft.status !== 'ready' && <p className="md-warning-text">검토 후 ‘준비 완료로 저장’하면 자료를 내려받을 수 있습니다.</p>}</div><div className="md-actions"><button type="button" className="md-button" disabled={!exportReady} onClick={() => handoff('txt')}><ArrowDownToLine size={14} />TXT</button><button type="button" className="md-button" disabled={!exportReady} onClick={() => handoff('json')}><ArrowDownToLine size={14} />JSON</button></div>{platform && <a className="md-manager-link" href={platform.managerUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />{platform.label} 광고 관리자 열기<ArrowRight size={14} /></a>}<small>자료 다운로드와 관리자 열기는 광고를 집행하거나 결제하지 않습니다.</small></div>
          </div>}

          <footer className="md-save-bar"><div>{!canEdit ? <span>관리자만 캠페인을 작성·수정할 수 있습니다.</span> : <span>{isSaved && draft.updatedBy ? `최근 저장 ${profileName(draft.updatedBy)}` : '초안은 작성 중에도 저장할 수 있습니다.'}</span>}</div><div className="md-actions">{step !== 'handoff' && <button type="button" className="md-button" onClick={() => setStep(step === 'plan' ? 'creative' : 'handoff')}>{step === 'plan' ? '문구·소재' : '집행 전 검토'}<ArrowRight size={14} /></button>}{canEdit && <><button type="button" className="md-button" disabled={!!busy || !dirty || !!loadError} onClick={() => void save()}>{busy === '저장 중' ? '저장 중…' : '저장'}</button><button type="button" className="md-button md-primary" disabled={!!busy || reviewsLocked || !validation.ready || !!assetError || assetsLoading || !!loadError || (draft.status === 'ready' && !dirty)} onClick={() => void save(true)}><CheckCircle2 size={15} />준비 완료로 저장</button></>}</div></footer>
        </div>

        <aside className="md-sidebar" aria-label="캠페인 미리보기와 준비 현황">
          <section className="md-preview"><div className="md-section-title"><h4>광고 미리보기</h4><span>구성 예시</span></div><div className="md-preview-brand"><span>{brand?.label?.slice(0, 1) ?? 'W'}</span><div><strong>{brand?.label}</strong><small>{platform?.label} · 광고</small></div></div>{assets[0]?.url ? <img className="md-preview-image" src={assets[0].url} alt="대표 광고 소재 미리보기" /> : <div className="md-preview-placeholder"><ImagePlus size={27} /><span>{draft.platform === 'naver' && draft.textAdConfirmed ? '텍스트 검색광고' : '광고 이미지를 올려 주세요'}</span></div>}<div className="md-preview-copy"><strong>{draft.headline || '광고 제목이 여기에 표시됩니다'}</strong><p>{draft.primaryText || '고객에게 전달할 핵심 내용과 혜택을 적어 주세요.'}</p>{draft.description && <small>{draft.description}</small>}<div className="md-preview-cta">{draft.cta || '문의하기'}<ArrowRight size={13} /></div></div><p className="md-help">실제 광고의 위치·크기·글자 수는 매체 등록 화면에서 확인하세요.</p></section>
          <section className="md-readiness"><div className="md-section-title"><h4>준비 현황</h4><span className={validation.ready ? 'md-good' : ''}>{validation.ready ? '검토 완료' : '확인 필요'}</span></div><ul><CheckRow done={!!draft.title.trim() && !!draft.audience.trim() && !!draft.offer.trim()}>목표·고객·핵심 제안</CheckRow><CheckRow done={!!draft.landingUrl.trim()}>고객이 도착할 페이지</CheckRow><CheckRow done={!!draft.dailyBudget && !!draft.totalBudget && (days ?? 0) > 0}>기간과 계획예산</CheckRow><CheckRow done={!!draft.headline.trim() && !!draft.primaryText.trim() && !!draft.cta.trim()}>광고 문구</CheckRow><CheckRow done={hasCreative && !assetError}>이미지 또는 텍스트 광고 확인</CheckRow><CheckRow done={reviewCount === 3}>내용·권리·예산 검토</CheckRow></ul><button type="button" className="md-text-button" onClick={() => setStep('handoff')}>확인할 내용 보기<ArrowRight size={13} /></button></section>
          <section className="md-ai-brief"><div className="md-section-title"><h4>AI 기획 요청</h4><Clipboard size={15} /></div><p>입력한 목표·고객·예산·시즌 메모를 기획 요청서로 복사합니다.</p><button type="button" className="md-button" disabled={!!busy} onClick={() => void copy(buildMarketingAIPrompt(draft), 'AI 기획 요청을 복사했습니다. 사용하시는 AI에 붙여 넣어 주세요.')}><Clipboard size={14} />기획 요청 복사</button><small>복사한 요청서를 사용하시는 AI에 붙여 넣어 답변을 받을 수 있습니다.</small></section>
        </aside>
      </div>}
      {copyFallback && <div className="md-copy-fallback"><label htmlFor="md-copy-text">복사할 내용</label><textarea id="md-copy-text" readOnly value={copyFallback} rows={8} onFocus={event => event.target.select()} /><button type="button" className="md-text-button" onClick={() => setCopyFallback('')}>닫기</button></div>}
    </section>
  )
}
