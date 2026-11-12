import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignedUrlCache } from './signedUrlCache'
import { ApiError, type Api } from './api'
import type { Profile } from './types'
import { patchMarketingCampaign, validateMarketingCampaign, marketingImageSignatureMatches, MARKETING_ASSET_MAX_BYTES, MARKETING_ASSET_MIME_TYPES, type MarketingAsset, type MarketingCampaign } from './marketing'

type MarketingApi = Pick<Api, 'listMarketingCampaigns' | 'saveMarketingCampaign' | 'listMarketingAssets' | 'uploadMarketingAsset' | 'deleteMarketingAsset'>
type CampaignRow = { id: string; document: MarketingCampaign; revision: number; created_at: string; updated_at: string; created_by: string; updated_by: string }
type AssetRow = { id: string; campaign_id: string; name: string; mime: string; size: number; path: string; created_at: string }
const BUCKET = 'marketing-assets'

function fail(error: { message: string; code?: string } | null): void {
  if (!error) return
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? '')) {
    throw new ApiError('캠페인 공용 저장소가 아직 준비되지 않았습니다. 관리자에게 광고 준비 기능의 DB 적용 상태를 확인해 주세요.')
  }
  throw new ApiError(error.message)
}

function campaignFromRow(row: CampaignRow): MarketingCampaign {
  return { ...row.document, id: row.id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
}

function assetFromRow(row: AssetRow): MarketingAsset {
  return { id: row.id, campaignId: row.campaign_id, name: row.name, mime: row.mime, size: Number(row.size), path: row.path, createdAt: row.created_at }
}

function verifyExistingAsset(asset: MarketingAsset, campaignId: string, file: File): MarketingAsset {
  if (asset.campaignId !== campaignId || asset.name !== file.name.slice(0, 255) || asset.mime !== file.type || asset.size !== file.size) {
    throw new ApiError('같은 소재 ID에 다른 파일이 저장되어 있습니다. 목록을 새로 불러와 확인해 주세요.')
  }
  return asset
}

function campaignDocument(c: MarketingCampaign) {
  const { id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, createdBy: _createdBy, updatedBy: _updatedBy, ...document } = c
  return document
}

async function checkImage(file: File): Promise<void> {
  if (!(MARKETING_ASSET_MIME_TYPES as readonly string[]).includes(file.type) || file.size < 1 || file.size > MARKETING_ASSET_MAX_BYTES) throw new ApiError('JPEG · PNG · WebP 이미지를 8MB 이하로 올려 주세요.')
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (!marketingImageSignatureMatches(b, file.type)) throw new ApiError('파일 내용과 이미지 형식이 맞지 않습니다. 원본 이미지로 다시 올려 주세요.')
  if (typeof createImageBitmap === 'function') {
    try {
      const image = await createImageBitmap(file)
      if (!image.width || !image.height) throw new Error('empty image')
      image.close()
    } catch {
      throw new ApiError('이미지를 읽을 수 없습니다. 다른 이미지로 다시 올려 주세요.')
    }
  }
}

function validateSave(c: MarketingCampaign, assets: MarketingAsset[]) {
  if (!c.title.trim()) throw new ApiError('캠페인 이름을 적어 주세요.')
  const check = validateMarketingCampaign(c, assets, { forHandoff: c.status === 'ready' })
  if (check.errors.length) throw new ApiError(check.errors.join('\n'))
}

export function createSupabaseMarketingApi(sb: SupabaseClient, signedUrls: SignedUrlCache): MarketingApi {
  async function listAssets(campaignId: string, includeUrls = true): Promise<MarketingAsset[]> {
    const result = await sb.from('marketing_assets').select('id,campaign_id,name,mime,size,path,created_at').eq('campaign_id', campaignId).is('deleted_at', null).order('created_at')
    fail(result.error)
    const rows = (result.data ?? []) as AssetRow[]
    if (!rows.length) return []
    if (!includeUrls) return rows.map(assetFromRow)
    const urls = await signedUrls.getMany(rows.map(row => ({ bucket: BUCKET, path: row.path })), async missing => {
      const signed = await sb.storage.from(BUCKET).createSignedUrls(missing.map(r => r.path), 3600)
      fail(signed.error)
      const byPath = new Map((signed.data ?? []).map(r => [r.path, r]))
      return missing.map(request => {
        const item = byPath.get(request.path)
        if (!item?.signedUrl || item.error) throw new ApiError('소재 파일을 열 수 없습니다. 파일 저장소 권한과 연결을 확인해 주세요.')
        return item.signedUrl
      })
    })
    return rows.map((row, i) => ({ ...assetFromRow(row), url: urls[i] }))
  }

  return {
    async listMarketingCampaigns() {
      const rows: MarketingCampaign[] = []
      for (let offset = 0; ; offset += 1000) {
        const result = await sb.from('marketing_campaigns').select('*').order('updated_at', { ascending: false }).order('id').range(offset, offset + 999)
        fail(result.error)
        const part = (result.data ?? []) as CampaignRow[]
        rows.push(...part.map(campaignFromRow))
        if (part.length < 1000) return rows
      }
    },
    async saveMarketingCampaign(c) {
      const assets = c.revision ? await listAssets(c.id, false) : []
      validateSave(c, assets)
      const result = await sb.rpc('marketing_save_campaign', { p_id: c.id, p_document: campaignDocument(c), p_expected_revision: c.revision })
      fail(result.error)
      if (!result.data) throw new ApiError('캠페인 저장 결과를 확인하지 못했습니다. 목록을 새로 불러와 주세요.')
      return campaignFromRow(result.data as CampaignRow)
    },
    listMarketingAssets: listAssets,
    async uploadMarketingAsset(campaignId, file, assetId) {
      await checkImage(file)
      const id = assetId ?? crypto.randomUUID()
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('소재 ID를 확인해 주세요.')
      const existing = await sb.from('marketing_assets').select('*').eq('id', id).maybeSingle()
      fail(existing.error)
      if (existing.data) return verifyExistingAsset(assetFromRow(existing.data as AssetRow), campaignId, file)
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
      const path = `${campaignId}/${id}.${ext}`
      const uploaded = await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' })
      if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) fail(uploaded.error)
      const recorded = await sb.rpc('marketing_add_asset', { p_id: id, p_campaign_id: campaignId, p_name: file.name.slice(0, 255), p_mime: file.type, p_size: file.size, p_path: path })
      if (recorded.error) {
        // A lost response may follow a committed metadata insert. Check before cleanup.
        const reconciled = await sb.from('marketing_assets').select('*').eq('id', id).maybeSingle()
        if (reconciled.data) return verifyExistingAsset(assetFromRow(reconciled.data as AssetRow), campaignId, file)
        if (!reconciled.error && recorded.error.code && !uploaded.error) {
          const cleanup = await sb.storage.from(BUCKET).remove([path])
          if (cleanup.error) throw new ApiError(`소재 기록에 실패했습니다. 같은 파일로 다시 시도해 주세요. ${recorded.error.message}`)
        }
        fail(recorded.error)
      }
      const row = recorded.data as AssetRow | null
      if (!row) throw new ApiError('소재 저장 결과를 확인하지 못했습니다. 목록을 새로 불러와 주세요.')
      // Metadata is committed already; signed URL failures must not undo a successful upload.
      return assetFromRow(row)
    },
    async deleteMarketingAsset(id) {
      // Archive the metadata first. A failed storage removal leaves a private orphan,
      // never a visible campaign attachment pointing to a missing file. Retrying is safe.
      const archived = await sb.rpc('marketing_archive_asset', { p_id: id })
      fail(archived.error)
      if (!archived.data) throw new ApiError('삭제할 소재를 찾을 수 없습니다.')
      signedUrls.invalidate(BUCKET, String(archived.data))
      const removed = await sb.storage.from(BUCKET).remove([String(archived.data)])
      if (removed.error) throw new ApiError('소재 연결은 해제됐지만 파일 정리가 끝나지 않았습니다. 다시 시도하거나 관리자에게 알려 주세요.')
    },
  }
}

type DemoAsset = MarketingAsset & { blob: Blob }
let demoDb: Promise<IDBDatabase> | undefined
function openDemoDb(): Promise<IDBDatabase> {
  if (!demoDb) demoDb = new Promise((resolve, reject) => {
    const request = indexedDB.open('wkly-erp-marketing-demo-v1', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('campaigns', { keyPath: 'id' })
      request.result.createObjectStore('assets', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { demoDb = undefined; reject(new ApiError('체험용 저장소를 열지 못했습니다. 브라우저 저장 권한을 확인해 주세요.')) }
    request.onblocked = () => { demoDb = undefined; reject(new ApiError('다른 체험 화면을 닫고 다시 시도해 주세요.')) }
  })
  return demoDb
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new ApiError('체험용 데이터를 읽거나 저장하지 못했습니다.'))
  })
}
async function demoTransaction<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDemoDb()
  const tx = db.transaction(['campaigns', 'assets'], mode)
  const completion = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(new ApiError('체험용 저장에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.'))
    tx.onerror = () => { /* onabort carries the failure */ }
  })
  try {
    const result = await action(tx)
    await completion
    return result
  } catch (error) {
    try { tx.abort() } catch { /* transaction may have already ended */ }
    await completion.catch(() => undefined)
    throw error
  }
}

function invalidateAssets(c: MarketingCampaign, user: string): MarketingCampaign {
  return { ...c, status: 'draft', reviews: { ...c.reviews, content: false, rights: false }, revision: c.revision + 1, updatedAt: new Date().toISOString(), updatedBy: user }
}

export function createDemoMarketingApi(getProfile: () => Profile | undefined): MarketingApi {
  const objectUrls = new Map<string, string>()
  function requireMember(write = false) {
    const p = getProfile()
    if (!p?.active) throw new ApiError('활성 팀원으로 로그인이 필요합니다.')
    if (write && p.role !== 'admin') throw new ApiError('캠페인 작성과 소재 관리는 관리자만 할 수 있습니다.')
    return p.id
  }
  function visibleAsset(a: DemoAsset): MarketingAsset {
    const { blob, ...metadata } = a
    let url = objectUrls.get(a.id)
    if (!url) { url = URL.createObjectURL(blob); objectUrls.set(a.id, url) }
    return { ...metadata, url }
  }
  return {
    async listMarketingCampaigns() {
      requireMember()
      return demoTransaction('readonly', async tx => {
        const rows = await requestValue(tx.objectStore('campaigns').getAll()) as MarketingCampaign[]
        return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      })
    },
    async saveMarketingCampaign(c) {
      const user = requireMember(true)
      return demoTransaction('readwrite', async tx => {
        const campaigns = tx.objectStore('campaigns')
        const old = await requestValue(campaigns.get(c.id)) as MarketingCampaign | undefined
        if ((old?.revision ?? 0) !== c.revision) throw new ApiError('다른 작업에서 캠페인이 변경됐습니다. 새로 불러온 뒤 수정해 주세요.')
        const allAssets = await requestValue(tx.objectStore('assets').getAll()) as DemoAsset[]
        const checked = old ? patchMarketingCampaign(old, c) : c
        validateSave(checked, allAssets.filter(a => a.campaignId === c.id))
        const time = new Date().toISOString()
        const saved: MarketingCampaign = { ...checked, revision: c.revision + 1, createdAt: old?.createdAt ?? time, updatedAt: time, createdBy: old?.createdBy ?? user, updatedBy: user }
        await requestValue(campaigns.put(saved))
        return saved
      })
    },
    async listMarketingAssets(campaignId) {
      requireMember()
      const all = await demoTransaction('readonly', tx => requestValue(tx.objectStore('assets').getAll())) as DemoAsset[]
      return all.filter(a => a.campaignId === campaignId).map(visibleAsset)
    },
    async uploadMarketingAsset(campaignId, file, assetId) {
      const user = requireMember(true)
      await checkImage(file)
      const id = assetId ?? crypto.randomUUID()
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('소재 ID를 확인해 주세요.')
      const row: DemoAsset = { id, campaignId, name: file.name.slice(0, 255), mime: file.type, size: file.size, createdAt: new Date().toISOString(), blob: file }
      const saved = await demoTransaction('readwrite', async tx => {
        const campaigns = tx.objectStore('campaigns')
        const campaign = await requestValue(campaigns.get(campaignId)) as MarketingCampaign | undefined
        if (!campaign) throw new ApiError('캠페인을 먼저 저장해 주세요.')
        const assets = tx.objectStore('assets')
        const existing = await requestValue(assets.get(id)) as DemoAsset | undefined
        if (existing) { verifyExistingAsset(existing, campaignId, file); return existing }
        await requestValue(assets.add(row))
        await requestValue(campaigns.put(invalidateAssets(campaign, user)))
        return row
      })
      return visibleAsset(saved)
    },
    async deleteMarketingAsset(id) {
      const user = requireMember(true)
      await demoTransaction('readwrite', async tx => {
        const assets = tx.objectStore('assets')
        const row = await requestValue(assets.get(id)) as DemoAsset | undefined
        if (!row) throw new ApiError('삭제할 소재를 찾을 수 없습니다.')
        const campaigns = tx.objectStore('campaigns')
        const campaign = await requestValue(campaigns.get(row.campaignId)) as MarketingCampaign | undefined
        if (!campaign) throw new ApiError('캠페인을 찾을 수 없습니다.')
        await requestValue(assets.delete(id))
        await requestValue(campaigns.put(invalidateAssets(campaign, user)))
      })
      const url = objectUrls.get(id)
      if (url) URL.revokeObjectURL(url)
      objectUrls.delete(id)
    },
  }
}
