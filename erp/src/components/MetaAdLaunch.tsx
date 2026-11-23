// 메타 광고로 올리기 (2026-11-21 대표 지시 '모든 광고와 마케팅은 더위클리로' · 메타 연결 뒤 바로 시작)
// 광고 준비 › 등록 단계 (관리자 · 매체 메타 · 준비 완료 저장 뒤)
//  ① '메타에 만들기' → 서버가 캠페인 · 광고 세트 · 소재 · 광고를 모두 '멈춤'으로 만듦 (돈 안 나감)
//  ② 메타 광고 관리자에서 미리 보기 확인 → '켜기 (대표 승인)' — 긴급 정지 · 하루 한도 확인 뒤 집행 시작
//  ③ '끄기' 는 언제든
import { useState } from 'react'
import { ExternalLink, Pause, Play, Rocket } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import type { MetaDraft } from '../lib/adAutopilotApi'
import { ask } from './Ask'

const won = (n: number | null) => (n == null ? '총예산' : `하루 ${n.toLocaleString('ko-KR')}원`)

export function MetaAdLaunch({ campaignId, ready, title }: { campaignId: string; ready: boolean; title: string }) {
  const { api, toast } = useApp()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const d = useAsync<MetaDraft | null>(() => api.metaDraft(campaignId).catch(() => null), [api, campaignId, tick], null).data
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try { await fn(); toast(ok) } catch (e) { toast(e instanceof Error ? e.message : '처리하지 못했습니다.') } finally { setBusy(null); setTick(t => t + 1) }
  }
  const create = async () => {
    if (!(await ask(`'${title}' 을(를) 메타 광고 계정에 '멈춤' 상태로 만듭니다.\n켜기 전에는 광고비가 나가지 않습니다. 만들까요?`))) return
    await run('create', () => api.metaCreate(campaignId), '메타에 멈춤 상태로 만들었습니다. 광고 관리자에서 미리 보기를 확인한 뒤 켜 주세요.')
  }
  const launch = async () => {
    if (!(await ask(`켜면 바로 광고비가 나가기 시작합니다 (${won(d?.daily_budget ?? null)}).\n긴급 정지 · 하루 한도를 확인한 뒤 켭니다. 켤까요?`))) return
    await run('launch', () => api.metaSwitch(campaignId, true), '광고를 켰습니다. 매일 아침 자동 운영이 수치를 받아 판단합니다.')
  }
  const managerUrl = d?.meta_campaign_id && d.meta_campaign_id !== '[시험]' ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${d.meta_campaign_id}` : 'https://adsmanager.facebook.com/'
  return <div className="md-handoff md-meta-launch">
    <div>
      <h4>메타에 광고로 올리기</h4>
      <p>캠페인 · 광고 세트 · 소재 · 광고를 메타에 <b>멈춤 상태</b>로 만듭니다. 미리 보기를 확인하고 <b>켜기</b>를 눌러야 집행됩니다. 광고 계정 · 페이지 · 인스타그램은 자동 운영 설정의 더위클리 것을 씁니다.</p>
      {d && <p className="md-meta-state">
        <span className={`md-status ${d.status === '켜짐' ? 'ready' : 'draft'}`}>{d.status}</span>
        {' '}{won(d.daily_budget)} · 이미지 {d.images}장 · 만든 때 {dateTimeLabel(d.created_at)}{d.launched_at ? ` · 켠 때 ${dateTimeLabel(d.launched_at)}` : ''}
      </p>}
      {d?.status === '실패' && d.error && <p className="md-warning-text">{d.error}</p>}
      {!ready && !d && <p className="md-warning-text">변경 내용을 저장하고 '준비 완료'로 저장하면 만들 수 있습니다.</p>}
    </div>
    <div className="md-actions">
      {(!d || d.status === '실패') && <button type="button" className="md-button md-primary" disabled={!ready || !!busy} onClick={() => void create()}><Rocket size={14} />{busy === 'create' ? '만드는 중…' : d ? '다시 만들기' : '메타에 만들기 (멈춤)'}</button>}
      {d?.status === '멈춤' && <button type="button" className="md-button md-primary" disabled={!!busy} onClick={() => void launch()}><Play size={14} />{busy === 'launch' ? '켜는 중…' : '켜기 (대표 승인)'}</button>}
      {d?.status === '켜짐' && <button type="button" className="md-button" disabled={!!busy} onClick={() => void run('pause', () => api.metaSwitch(campaignId, false), '광고를 멈췄습니다.')}><Pause size={14} />{busy === 'pause' ? '멈추는 중…' : '끄기'}</button>}
      {d?.status === '만드는 중' && <span className="md-help">메타에 만드는 중입니다…</span>}
    </div>
    {d && d.status !== '실패' && <a className="md-manager-link" href={managerUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />메타 광고 관리자에서 미리 보기</a>}
  </div>
}
