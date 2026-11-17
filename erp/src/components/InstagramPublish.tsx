import { useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import type { GrowthItem, InstagramPublishResult } from '../lib/growth'
import type { MarketingAsset } from '../lib/marketing'
import { Button, Modal } from './ui'

/** PNG · WebP 이미지를 인스타그램이 받는 JPG 로 바꿈 (투명한 곳은 흰색) */
async function toJpeg(asset: MarketingAsset): Promise<File> {
  if (!asset.url) throw new Error('이미지 주소를 불러오지 못했습니다.')
  const bitmap = await createImageBitmap(await (await fetch(asset.url)).blob())
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92))
  if (!blob) throw new Error('JPG 로 바꾸지 못했습니다.')
  return new File([blob], asset.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' })
}

/** 콘텐츠 › 인스타그램 버전 → 인스타그램 바로 게시 (관리자 · 저장된 승인 버전만) */
export function InstagramPublish({ item, dirty, onPublished }: { item: GrowthItem; dirty: boolean; onPublished: (row: GrowthItem) => void }) {
  const { api } = useApp()
  const v = item.document.versions?.find(x => x.channel === '인스타그램')
  const campaign = item.campaign_id
  const assets = useAsync(() => (campaign ? api.listMarketingAssets(campaign) : Promise.resolve([])), [campaign], [])
  const [check, setCheck] = useState<InstagramPublishResult | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  if (!v) return null
  if (v.status === '발행') return <p className="ig-publish t-cap">인스타그램에 게시됨 {v.publication_url && <a href={v.publication_url} target="_blank" rel="noreferrer">게시물 보기</a>}</p>
  const notJpeg = assets.data.filter(a => a.mime !== 'image/jpeg')
  const blocker = dirty ? '저장한 뒤 게시할 수 있습니다.'
    : v.status !== '승인' ? '인스타그램 버전을 승인 상태로 저장하면 여기서 바로 게시할 수 있습니다.'
    : !campaign ? '이미지가 있는 광고 캠페인을 연결해 주세요.'
    : !assets.loading && !assets.data.length ? '연결 캠페인에 이미지가 없습니다. 광고 › 제작에서 이미지를 만들거나 올려 주세요.'
    : assets.data.length > 10 ? '이미지는 10장까지 올릴 수 있습니다.' : ''
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError('')
    try { await fn() } catch (e) { setError(friendlyError(e)) } finally { setBusy('') }
  }
  const convert = () => run('JPG 로 바꾸는 중…', async () => {
    for (const a of notJpeg) { await api.uploadMarketingAsset(campaign!, await toJpeg(a)); await api.deleteMarketingAsset(a.id) }
    setCheck(null); assets.reload()
  })
  const doCheck = () => run('확인 중…', async () => setCheck(await api.instagramPublish('check', item.id, item.revision)))
  const doPublish = () => run('게시하는 중…', async () => {
    const r = await api.instagramPublish('publish', item.id, item.revision)
    setConfirm(false)
    if (r.warning) setError(r.warning)
    if (r.item) onPublished(r.item)
  })
  return <section className="ig-publish" aria-label="인스타그램 바로 게시">
    <header className="row wrap"><strong>인스타그램 바로 게시</strong>{campaign && <small>이미지 {assets.data.length}장{notJpeg.length ? ` · JPG 아님 ${notJpeg.length}장` : ''}</small>}</header>
    {blocker ? <p className="t-cap">{blocker}</p> : <>
      {assets.data.length > 0 && <div className="ig-publish-thumbs">{assets.data.map(a => a.url && <img key={a.id} src={a.url} alt={a.name} loading="lazy" />)}</div>}
      <div className="row wrap">
        {notJpeg.length > 0 && <Button kind="outline" disabled={!!busy} onClick={convert}>JPG로 바꾸기</Button>}
        <Button kind="outline" disabled={!!busy || notJpeg.length > 0} onClick={doCheck}>게시 내용 확인</Button>
        {check && !check.issues?.length && <Button disabled={!!busy} onClick={() => setConfirm(true)}>인스타그램에 게시</Button>}
      </div>
      {check && <div className="ig-publish-preview">
        <small>@{check.username} · 이미지 {check.images?.length ?? 0}장{check.quota?.total ? ` · 오늘 게시 ${check.quota.used ?? 0}/${check.quota.total}` : ''}</small>
        <pre>{check.caption}</pre>
        {check.issues?.map(t => <p key={t} role="alert" className="growth-error">{t}</p>)}
      </div>}
    </>}
    {busy && <p role="status" className="t-cap">{busy}</p>}
    {error && <p role="alert" className="growth-error">{error}</p>}
    {confirm && check && <Modal title="인스타그램에 게시" onClose={() => !busy && setConfirm(false)} actions={<><Button kind="ghost" disabled={!!busy} onClick={() => setConfirm(false)}>취소</Button><Button disabled={!!busy} onClick={doPublish}>{busy || '지금 게시'}</Button></>}>
      <p>@{check.username} 계정에 이미지 {check.images?.length ?? 0}장과 아래 글로 바로 게시합니다. 게시 뒤에는 인스타그램 앱에서만 지울 수 있습니다.</p>
      <pre className="ig-publish-caption">{check.caption}</pre>
    </Modal>}
  </section>
}
