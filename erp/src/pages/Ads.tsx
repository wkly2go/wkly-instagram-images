import { GrowthWorkspace } from '../components/GrowthWorkspace'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BarChart3, BookOpen, ChevronDown, ExternalLink, Images, Loader2, Megaphone, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { addDays, dateTimeLabel, shortDate, todayKey } from '../lib/date'
import { useRouter, withQuery } from '../lib/router'
import { AD_PLATFORMS, type AdCampaign, type AdCreative, type AdDaily, type AdPlatform, type AdReport, type AdReportKind, type SeoCheck } from '../lib/types'
import { Shell } from '../components/Shell'
import { Badge, Chip, Empty, Linkify, SectionHead } from '../components/ui'
import { ReportBody } from '../components/Reports'
import { CompareBars, DayChart, Spark, type Series } from '../components/AdCharts'
import { SeoPanel } from '../components/SeoPanel'
import { MarketingDesk } from '../components/MarketingDesk'
import { adPeriod, parseAdRange, selectAdRows, type AdRange } from '../lib/adWorkspace'
import './Ads.css'

const P_COLOR: Record<AdPlatform, string> = { Google: 'var(--blue)', Meta: 'var(--pink)', Naver: 'var(--green)', 기타: 'var(--gray)' }
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const num = (n: number) => Math.round(n).toLocaleString('ko-KR')
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '–')
const shortNum = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만` : num(n))

type Tab = 'content' | 'summary' | 'studio' | 'platform' | 'charts' | 'daily-table' | 'creatives' | 'competitors' | 'overseas' | 'daily' | 'seo'
const TABS: [Tab, string][] = [
  ['content', '콘텐츠·배포'],
  ['summary', '대시보드'],
  ['studio', '캠페인 준비'],
  ['platform', '매체별 성과'],
  ['charts', '추이 그래프'],
  ['daily-table', '일별 수치'],
  ['creatives', '우리 소재'],
  ['competitors', '경쟁사 분석'],
  ['overseas', '해외 사례'],
  ['daily', '일일 보고'],
  ['seo', '검색 노출 (SEO · AEO · GEO)'],
]
const GROUPS = [
  { label: '콘텐츠·배포', icon: Images, tabs: ['content'] as Tab[], description: '네이버 블로그·인스타그램·유튜브 글을 작성하고, 검수·발행 기록과 연결 광고를 관리하세요.' },
  { label: '캠페인 준비', icon: Megaphone, tabs: ['studio'] as Tab[], description: '기획부터 소재 준비, 집행 전 확인까지 순서대로 진행하세요.' },
  { label: '소재 관리', icon: Images, tabs: ['creatives'] as Tab[], description: '등록된 광고 소재와 성과를 확인하세요. 새 문구와 이미지는 캠페인 준비에서 관리합니다.' },
  { label: '성과·보고서', icon: BarChart3, tabs: ['summary', 'platform', 'charts', 'daily-table', 'daily'] as Tab[], description: '대시보드에서 광고 현황을 확인하고, 매체별 성과·추이·일일 보고를 살펴보세요.' },
  { label: '리서치·검색', icon: Search, tabs: ['competitors', 'overseas', 'seo'] as Tab[], description: '경쟁사·해외 광고 사례와 검색·AI 답변의 브랜드 노출을 확인하세요.' },
]
const NUMBER_TABS: Tab[] = ['summary', 'platform', 'charts', 'daily-table']
type Period = ReturnType<typeof adPeriod>

type MetricKey = 'cost' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'conversions'
const METRICS: { key: MetricKey; label: string; mode: 'stack' | 'line'; format: (n: number) => string }[] = [
  { key: 'cost', label: '광고비', mode: 'stack', format: n => `${shortNum(n)}원` },
  { key: 'impressions', label: '노출', mode: 'stack', format: shortNum },
  { key: 'clicks', label: '클릭', mode: 'stack', format: shortNum },
  { key: 'ctr', label: '클릭률(CTR)', mode: 'line', format: n => `${n.toFixed(2)}%` },
  { key: 'cpc', label: '클릭당 비용(CPC)', mode: 'line', format: n => `${shortNum(n)}원` },
  { key: 'conversions', label: '전환 (Google)', mode: 'stack', format: num },
]

interface Agg {
  cost: number
  imp: number
  clk: number
  conv: number
}
const agg = (list: AdDaily[]): Agg => list.reduce((a, r) => ({ cost: a.cost + (r.cost ?? 0), imp: a.imp + (r.impressions ?? 0), clk: a.clk + (r.clicks ?? 0), conv: a.conv + Number(r.conversions ?? 0) }), { cost: 0, imp: 0, clk: 0, conv: 0 })
const metricOf = (a: Agg, k: MetricKey): number | null =>
  k === 'cost' ? a.cost : k === 'impressions' ? a.imp : k === 'clicks' ? a.clk : k === 'conversions' ? a.conv : k === 'ctr' ? (a.imp ? (a.clk / a.imp) * 100 : null) : a.clk ? a.cost / a.clk : null

/** 업무별 탐색은 기존 tab 링크와 작성 중 이동 보호를 유지한다. */
export default function Ads() {
  const { query, path, navigate } = useRouter()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const tab = (TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'summary') as Tab
  const setTab = (t: Tab) => {
    if (t === tab) return
    navigate(withQuery(path, query, { tab: t === 'summary' ? null : t, id: null }))
  }
  const group = GROUPS.find(g => g.tabs.includes(tab))!
  const range = parseAdRange(query.get('period'))
  const platform = AD_PLATFORMS.find(p => p === query.get('platform')) ?? null
  const setRange = (r: AdRange) => navigate(withQuery(path, query, { period: r === 14 ? null : String(r) }))
  const setPlatform = (p: AdPlatform | null) => navigate(withQuery(path, query, { platform: p }))
  const period = adPeriod(todayKey(), range)
  useEffect(() => {
    workspaceRef.current?.closest('.main')?.scrollTo({ top: 0 })
  }, [tab])
  return (
    <Shell active="ads">
      <div className={`ads-workspace${tab === 'studio' ? ' is-preparing' : ''}`} ref={workspaceRef}>
        <header className="ads-heading">
          <div><span className="ads-eyebrow">MARKETING WORKSPACE</span><h1>광고·콘텐츠 통합 관리</h1><p>인스타그램 광고와 블로그·유튜브 콘텐츠를 한곳에서 관리합니다.</p></div>
          <div className="ads-heading-actions">
            <a className="btn" href="/manual/growth.html#ads" target="_blank" rel="noreferrer"><BookOpen size={16} /> 통합 메뉴 사용설명</a>
            {tab !== 'studio' && <button type="button" className="btn primary ads-prepare-btn" onClick={() => setTab('studio')}><Megaphone size={16} /> 캠페인 준비하기 <ArrowRight size={15} /></button>}
          </div>
        </header>
        <nav className="ads-nav" aria-label="광고 업무">
          {GROUPS.map(g => <button key={g.label} type="button" className={g === group ? 'active' : ''} aria-current={g === group ? 'page' : undefined} onClick={() => setTab(g.tabs.includes(tab) ? tab : g.tabs[0])}><g.icon size={18} /><span>{g.label}</span></button>)}
        </nav>
        {group.tabs.length > 1 && <nav className="ads-subnav" aria-label={`${group.label} 상세 메뉴`}>
          {group.tabs.map(t => <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{TABS.find(([key]) => key === t)![1]}</button>)}
        </nav>}
        <section className="ads-content" aria-label={TABS.find(([key]) => key === tab)![1]}>
          <p className="ads-help">{group.description}</p>
          {tab === 'content' ? <GrowthWorkspace kind="content" /> : tab === 'studio' ? <MarketingDesk key={query.get('id')??'default'} initialCampaignId={query.get('id')??undefined} /> : NUMBER_TABS.includes(tab) ? <NumbersWorkspace tab={tab} range={range} platform={platform} period={period} setRange={setRange} setPlatform={setPlatform} goTab={setTab} />
            : tab === 'creatives' ? <CreativeWorkspace period={period} />
            : tab === 'seo' ? <SearchWorkspace />
            : <ReportWorkspace key={tab} kind={tab === 'competitors' ? '경쟁사 분석' : tab === 'overseas' ? '해외 사례' : '일일 보고'} />}
        </section>
      </div>
    </Shell>
  )
}

function LoadState({ error, retry }: { error?: string | null; retry?: () => void }) {
  return <div className={`ads-load-state${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
    {error ? <TriangleAlert size={22} /> : <Loader2 size={22} className="ads-spin" />}
    <div><strong>{error ? '자료를 불러오지 못했습니다' : '자료를 불러오는 중입니다'}</strong><p>{error ? '연결 상태를 확인하고 다시 불러와 주세요.' : '잠시만 기다려 주세요.'}</p></div>
    {error && retry && <button type="button" className="btn" onClick={retry}><RefreshCw size={14} /> 다시 불러오기</button>}
  </div>
}

function NumbersWorkspace({ tab, range, platform, period, setRange, setPlatform, goTab }: { tab: Tab; range: AdRange; platform: AdPlatform | null; period: Period; setRange: (r: AdRange) => void; setPlatform: (p: AdPlatform | null) => void; goTab: (t: Tab) => void }) {
  const { api, version } = useApp()
  const { from, to, previousFrom, days } = period
  const requestKey = `${previousFrom}:${to}:${version}`
  const { data, loading, error, reload } = useAsync(async () => {
    const [rows, campaigns] = await Promise.all([api.listAdDaily(previousFrom, to), api.listAdCampaigns()])
    return { rows, campaigns, requestKey }
  }, [requestKey], { rows: [] as AdDaily[], campaigns: [] as AdCampaign[], requestKey: '' })
  const current = data.requestKey === requestKey
  const rows = current ? selectAdRows(data.rows, from, to, platform) : []
  const prev = current ? selectAdRows(data.rows, previousFrom, addDays(from, -1), platform) : []
  const platforms = AD_PLATFORMS.filter(pl => (!platform || pl === platform) && (data.rows.some(r => r.platform === pl) || data.campaigns.some(c => c.platform === pl)))
  const lastUpdate = current ? data.rows.reduce<string | null>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null) : null
  const coveredDays = new Set(rows.map(r => r.date)).size
  return <>
    <div className="ads-filters">
      <div className="ads-period"><span className="ads-filter-label">조회 기간</span><div className="ads-segment" role="group" aria-label="조회 기간">{([7, 14, 30, 'month'] as AdRange[]).map(r => <button key={r} type="button" aria-pressed={range === r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r === 'month' ? '이번 달' : `${r}일`}</button>)}</div></div>
      <label className="ads-channel"><span className="ads-filter-label">매체</span><select aria-label="성과 조회 매체" value={platform ?? ''} onChange={e => setPlatform((e.target.value || null) as AdPlatform | null)}><option value="">전체 매체</option>{AD_PLATFORMS.map(pl => <option key={pl}>{pl}</option>)}</select></label>
      <div className="ads-date-range"><strong>{days.length ? `${shortDate(from)} – ${shortDate(to)}` : '이번 달 집계 전'}</strong><span>어제까지 · 한국 시간</span></div>
      <button type="button" className="btn ads-refresh" onClick={reload} disabled={loading} aria-label="광고 성과 새로 불러오기"><RefreshCw size={14} className={loading ? 'ads-spin' : ''} /> 새로고침</button>
    </div>
    {loading ? <LoadState /> : error ? <LoadState error={error} retry={reload} /> : !current ? <LoadState /> : <>
      <div className="ads-data-meta"><span>{lastUpdate ? `최근 읽은 기록 갱신 ${dateTimeLabel(lastUpdate)}` : '조회 범위에 갱신 기록이 없습니다'}</span>{rows.length > 0 && <span>{days.length}일 중 {coveredDays}일 기록 · 합계는 수집된 기록 기준</span>}</div>
      {rows.length === 0 ? <>
        <div className="ads-empty"><BarChart3 size={30} /><h2>{days.length ? '선택한 기간에 광고 기록이 없습니다' : '이번 달의 일별 집계가 아직 없습니다'}</h2><p>{days.length ? '광고비와 성과를 확인할 기록이 없습니다. 기간 또는 매체를 바꿔 확인해 주세요.' : '최근 7일을 선택하면 지난달 말의 기록을 확인할 수 있습니다.'}</p><div className="ads-empty-actions">{range !== 30 && <button type="button" className="btn" onClick={() => setRange(days.length ? 30 : 7)}>{days.length ? '최근 30일 보기' : '최근 7일 보기'}</button>}{platform && <button type="button" className="btn" onClick={() => setPlatform(null)}>전체 매체 보기</button>}<button type="button" className="btn primary" onClick={() => goTab('studio')}>캠페인 준비하기 <ArrowRight size={14} /></button></div></div>
        {tab === 'summary' && <LatestReport goTab={goTab} />}
        {tab === 'summary' && <Flags campaigns={data.campaigns.filter(c => !platform || c.platform === platform)} />}
        {tab === 'platform' && platforms.length > 0 && <PlatformReport rows={rows} days={days} platforms={platforms} campaigns={data.campaigns} />}
      </> : tab === 'summary' ? <Summary rows={rows} prev={prev} days={days} platforms={platforms} campaigns={data.campaigns} goTab={goTab} />
        : tab === 'platform' ? <PlatformReport rows={rows} days={days} platforms={platforms} campaigns={data.campaigns} />
        : tab === 'charts' ? <Charts rows={rows} days={days} platforms={platforms} campaigns={data.campaigns} />
        : <DailyTable rows={rows} days={days} platforms={platforms} />}
    </>}
  </>
}

function LatestReport({ goTab }: { goTab: (t: Tab) => void }) {
  const { api, version } = useApp()
  const { data, loading, error, reload } = useAsync(() => api.listAdReports(), [version], [] as AdReport[])
  const latest = data.filter(r => r.kind === '일일 보고').sort((a, b) => b.report_date.localeCompare(a.report_date))[0]
  if (loading) return <span className="t-cap" role="status">최근 일일 보고 확인 중…</span>
  if (error) return <div className="ads-inline-status" role="status">일일 보고를 불러오지 못했습니다. <button type="button" className="link-btn" onClick={reload}>다시 불러오기</button></div>
  if (!latest) return null
  return <button type="button" className="ad-report-card" onClick={() => goTab('daily')}><span className="row"><Badge tone="acid">최근 일일 보고</Badge><span className="t-bodyb grow truncate">{latest.title}</span><span className="t-meta">{shortDate(latest.report_date)}</span><ArrowRight size={15} /></span>{latest.summary && <span className="t-small pre clamp-3">{latest.summary}</span>}</button>
}

function CreativeWorkspace({ period }: { period: Period }) {
  const { api, version } = useApp()
  const { data, loading, error, reload } = useAsync(() => api.listAdCreatives(), [version], [] as AdCreative[])
  const { data: rows, error: numbersError, loading: numbersLoading, reload: reloadNumbers } = useAsync(() => api.listAdDaily(period.from, period.to), [period.from, period.to, version], [] as AdDaily[])
  if (loading) return <LoadState />
  if (error) return <LoadState error={error} retry={reload} />
  return <><SectionHead title="우리 소재" right={<button type="button" className="link-btn" disabled={numbersLoading} onClick={() => { reload(); reloadNumbers() }}><RefreshCw size={13} /> 새로고침</button>} /><p className="ads-help">캠페인과 문구로 등록된 소재를 찾을 수 있습니다. {period.days.length > 0 && `성과 표시는 ${shortDate(period.from)}–${shortDate(period.to)} 기록 기준입니다.`}</p>{numbersError && !numbersLoading && <span className="t-cap">소재별 성과를 불러오지 못했습니다. 등록된 소재를 먼저 표시합니다. <button type="button" className="link-btn" onClick={reloadNumbers}>성과 다시 불러오기</button></span>}<Creatives list={data.filter(c => c.side === '우리')} rows={numbersError || numbersLoading ? [] : selectAdRows(rows, period.from, period.to, null)} side="우리" /></>
}

function ReportWorkspace({ kind }: { kind: AdReportKind }) {
  const { api, version } = useApp()
  const reports = useAsync(() => api.listAdReports(), [kind, version], [] as AdReport[])
  const creatives = useAsync(() => kind === '일일 보고' ? Promise.resolve([] as AdCreative[]) : api.listAdCreatives(), [kind, version], [] as AdCreative[])
  return <><div className="ads-report-top"><SectionHead title={kind} /><button type="button" className="btn" disabled={reports.loading || creatives.loading} onClick={() => { reports.reload(); creatives.reload() }}><RefreshCw size={14} /> 새로고침</button></div>{reports.loading ? <LoadState /> : reports.error ? <LoadState error={reports.error} retry={reports.reload} /> : <Analysis kind={kind} reports={reports.data} creatives={creatives.data.filter(c => c.side === (kind === '해외 사례' ? '해외' : '경쟁사'))} rows={[]} />}{creatives.error && !creatives.loading && <div className="ads-inline-status" role="status">참고 소재를 불러오지 못했습니다. <button type="button" className="link-btn" onClick={creatives.reload}>다시 불러오기</button></div>}</>
}

function SearchWorkspace() {
  const { api, version } = useApp()
  const { data, loading, error, reload } = useAsync(() => api.listSeoChecks(), [version], [] as SeoCheck[])
  return loading ? <LoadState /> : error ? <LoadState error={error} retry={reload} /> : <SeoPanel checks={data} />
}

// ---------------------------------------------------------------------

function Kpis({ rows, prev, days }: { rows: AdDaily[]; prev: AdDaily[]; days: string[] }) {
  const t = agg(rows)
  const p = agg(prev)
  const recordedDays = new Set(rows.map(r => r.date)).size
  const delta = (a: number, b: number) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(((a - b) / b) * 100).toFixed(0)}%` : '')
  return (
    <><div className="kpis kpis-4">
      <div className="kpi">
        <span className="t-cap">광고비</span>
        <span className="v">{won(t.cost)}</span>
        <span className="sub">
          기록된 {recordedDays}일 평균 {won(t.cost / Math.max(1, recordedDays))}
        </span>
      </div>
      <div className="kpi">
        <span className="t-cap">노출</span>
        <span className="v">{num(t.imp)}</span>
        <span className="sub">{prev.length ? `이전 기간 대비 ${delta(t.imp, p.imp) || '비교값 없음'}` : '이전 기간 기록 없음'}</span>
      </div>
      <div className="kpi">
        <span className="t-cap">클릭 · CTR</span>
        <span className="v">{num(t.clk)}</span>
        <span className="sub">
          CTR {pct(t.clk, t.imp)} {delta(t.clk, p.clk)}
        </span>
      </div>
      <div className="kpi">
        <span className="t-cap">클릭당 비용</span>
        <span className="v">{t.clk ? won(t.cost / t.clk) : '–'}</span>
        <span className="sub">전환 {num(t.conv)} (Google 기준)</span>
      </div>
    </div><span className="t-cap ads-comparison-note">{days.length}일 집계 · 비교는 직전 동일 기간의 수집 기록 기준</span></>
  )
}

function seriesFor(rows: AdDaily[], days: string[], platforms: AdPlatform[], k: MetricKey): Series[] {
  return platforms.map(pl => ({
    key: pl,
    label: pl,
    color: P_COLOR[pl],
    values: days.map(d => {
      const list = rows.filter(r => r.platform === pl && r.date === d)
      if (!list.length) return null
      if (k === 'conversions' && pl !== 'Google') return null
      return metricOf(agg(list), k)
    }),
  }))
}

function Legend({ platforms }: { platforms: AdPlatform[] }) {
  return (
    <div className="legend">
      {platforms.map(pl => (
        <span key={pl}>
          <i style={{ background: P_COLOR[pl] }} />
          {pl}
        </span>
      ))}
    </div>
  )
}

function Flags({ campaigns }: { campaigns: AdCampaign[] }) {
  const flags = campaigns.filter(c => c.flags)
  if (!flags.length) return null
  return (
    <details className="ads-attention">
      <summary><TriangleAlert size={17} /><strong>확인이 필요한 캠페인</strong><span className="ads-count">{flags.length}</span><span className="ads-details-hint">내용 보기</span><ChevronDown size={16} className="ads-details-chevron" /></summary>
      <div className="ads-attention-list">
      {flags.map(c => (
        <div key={`${c.platform}${c.campaign}`}><strong>{c.platform} · {c.campaign}</strong><span>{c.flags}</span></div>
      ))}
      </div>
    </details>
  )
}

function Summary({ rows, prev, days, platforms, campaigns, goTab }: { rows: AdDaily[]; prev: AdDaily[]; days: string[]; platforms: AdPlatform[]; campaigns: AdCampaign[]; goTab: (t: Tab) => void }) {
  return (
    <>
      <Kpis rows={rows} prev={prev} days={days} />
      <LatestReport goTab={goTab} />
      <Flags campaigns={campaigns.filter(c => platforms.includes(c.platform))} />
      <SectionHead title="매체별 한눈에" right={<button type="button" className="link-btn" onClick={() => goTab('platform')}>매체별 보고서 →</button>} />
      <PlatformCards rows={rows} days={days} platforms={platforms} campaigns={campaigns} />
      <SectionHead title="일별 광고비" right={<button type="button" className="link-btn" onClick={() => goTab('charts')}>모든 그래프 →</button>} />
      <DayChart days={days} series={seriesFor(rows, days, platforms, 'cost')} mode="stack" format={METRICS[0].format} label="일별 광고비" />
      <Legend platforms={platforms} />
    </>
  )
}

function PlatformCards({ rows, days, platforms, campaigns }: { rows: AdDaily[]; days: string[]; platforms: AdPlatform[]; campaigns: AdCampaign[] }) {
  const total = agg(rows).cost
  return (
    <div className="ad-pcards">
      {platforms.map(pl => {
        const list = rows.filter(r => r.platform === pl)
        const a = agg(list)
        const camps = campaigns.filter(c => c.platform === pl)
        const budget = camps.reduce((n, c) => n + (c.daily_budget ?? 0), 0)
        return (
          <div key={pl} className="ad-pcard" style={{ borderTopColor: P_COLOR[pl] }}>
            <div className="row">
              <span className="t-bodyb grow">{pl}</span>
              {camps.some(c => c.flags) && <Badge tone="red">확인 필요</Badge>}
            </div>
            {list.length === 0 ? (
              <span className="t-cap">선택 기간의 기록 없음{camps[0]?.status ? ` · ${camps[0].status}` : ''}</span>
            ) : (
              <>
                <span className="v">{won(a.cost)}</span>
                <span className="t-cap">
                  전체의 {total ? Math.round((a.cost / total) * 100) : 0}% · 일 예산 {budget ? won(budget) : '–'}
                </span>
                <Spark values={days.map(d => agg(list.filter(r => r.date === d)).cost)} color={P_COLOR[pl]} />
                <div className="ad-pstats">
                  <span>
                    노출 <b>{num(a.imp)}</b>
                  </span>
                  <span>
                    클릭 <b>{num(a.clk)}</b>
                  </span>
                  <span>
                    CTR <b>{pct(a.clk, a.imp)}</b>
                  </span>
                  <span>
                    CPC <b>{a.clk ? won(a.cost / a.clk) : '–'}</b>
                  </span>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PlatformReport({ rows, days, platforms, campaigns }: { rows: AdDaily[]; days: string[]; platforms: AdPlatform[]; campaigns: AdCampaign[] }) {
  return (
    <>
      <PlatformCards rows={rows} days={days} platforms={platforms} campaigns={campaigns} />
      {platforms.map(pl => {
        const list = rows.filter(r => r.platform === pl)
        const names = [...new Set([...list.map(r => r.campaign), ...campaigns.filter(c => c.platform === pl).map(c => c.campaign)])]
        return (
          <section key={pl} className="col gap-6 ad-psection">
            <SectionHead title={`${pl} 보고서`} count={names.length} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>캠페인</th>
                    <th>상태</th>
                    <th className="num">일 예산</th>
                    <th className="num">광고비</th>
                    <th className="num">노출</th>
                    <th className="num">클릭</th>
                    <th className="num">CTR</th>
                    <th className="num">CPC</th>
                    {pl === 'Google' && <th className="num">전환</th>}
                    <th>추세</th>
                  </tr>
                </thead>
                <tbody>
                  {names.map(n => {
                    const c = campaigns.find(x => x.platform === pl && x.campaign === n)
                    const cl = list.filter(r => r.campaign === n)
                    const a = agg(cl)
                    return (
                      <tr key={n}>
                        <td title={c?.full_name ?? undefined}>
                          {n}
                          {c?.flags && (
                            <span className="t-red" title={c.flags}>
                              {' '}
                              ⚠
                            </span>
                          )}
                        </td>
                        <td>{c?.status ? <Badge tone={/중|활성|게재|운영|ON/i.test(c.status) && !/준비|대기/.test(c.status) ? 'acid' : 'gray'}>{c.status}</Badge> : '–'}</td>
                        <td className="num">{c?.daily_budget ? won(c.daily_budget) : '–'}</td>
                        <td className="num">{cl.length ? won(a.cost) : '–'}</td>
                        <td className="num">{cl.length ? num(a.imp) : '–'}</td>
                        <td className="num">{cl.length ? num(a.clk) : '–'}</td>
                        <td className="num">{pct(a.clk, a.imp)}</td>
                        <td className="num">{a.clk ? won(a.cost / a.clk) : '–'}</td>
                        {pl === 'Google' && <td className="num">{cl.length ? num(a.conv) : '–'}</td>}
                        <td>{cl.length ? <Spark values={days.map(d => cl.find(r => r.date === d)?.cost ?? 0)} color={P_COLOR[pl]} /> : <span className="t-meta">기록 없음</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Flags campaigns={campaigns.filter(c => c.platform === pl)} />
          </section>
        )
      })}
      <span className="t-cap">숫자는 각 광고 관리자에서 전날 기준으로 읽은 값입니다(원, VAT 별도). Google 전환은 페이지 조회가 포함되어 실제보다 많을 수 있습니다.</span>
    </>
  )
}

function Charts({ rows, days, platforms, campaigns }: { rows: AdDaily[]; days: string[]; platforms: AdPlatform[]; campaigns: AdCampaign[] }) {
  const [metric, setMetric] = useState<MetricKey>('cost')
  const m = METRICS.find(x => x.key === metric)!
  const byCampaign = useMemo(() => {
    const keys = [...new Set(rows.map(r => `${r.platform}|${r.campaign}`))]
    return keys
      .map(k => {
        const [pl, c] = k.split('|') as [AdPlatform, string]
        const v = metricOf(agg(rows.filter(r => r.platform === pl && r.campaign === c)), metric)
        return { key: k, label: `${pl} · ${c}`, value: v ?? 0, color: P_COLOR[pl], skip: v == null || (metric === 'conversions' && pl !== 'Google') }
      })
      .filter(r => !r.skip)
      .sort((a, b) => b.value - a.value)
  }, [rows, metric])
  return (
    <>
      <div className="chips">
        {METRICS.map(x => (
          <Chip key={x.key} active={metric === x.key} onClick={() => setMetric(x.key)}>
            {x.label}
          </Chip>
        ))}
      </div>
      <SectionHead title={`일별 ${m.label} · 매체별`} right={<span className="t-cap">{m.mode === 'stack' ? '막대 = 매체별 누적' : '선 = 매체별'} · 마우스를 올리면 값</span>} />
      <DayChart days={days} series={seriesFor(rows, days, platforms, metric)} mode={m.mode} format={m.format} height={240} label={`일별 ${m.label}`} />
      <Legend platforms={platforms} />
      <SectionHead title={`캠페인별 ${m.label}`} count={byCampaign.length} />
      {byCampaign.length ? <CompareBars rows={byCampaign} format={m.format} /> : <Empty>이 기간에 값이 없습니다.</Empty>}
      <details className="ads-disclosure"><summary><strong>모든 지표 한눈에</strong><span>6개 지표</span><ChevronDown size={16} className="ads-details-chevron" /></summary>
      <div className="ad-multiples">
        {METRICS.map(x => (
          <div key={x.key} className="ad-multiple">
            <button type="button" className="t-smallb link-btn" onClick={() => setMetric(x.key)}>
              {x.label}
            </button>
            <DayChart days={days} series={seriesFor(rows, days, platforms, x.key)} mode={x.mode} format={x.format} height={150} label={`일별 ${x.label}`} />
          </div>
        ))}
      </div>
      </details>
      <details className="ads-disclosure"><summary><strong>캠페인별 일별 광고비</strong><span>상세 그래프</span><ChevronDown size={16} className="ads-details-chevron" /></summary>
      <div className="ad-multiples">
        {[...new Set(rows.map(r => `${r.platform}|${r.campaign}`))].map(k => {
          const [pl, c] = k.split('|') as [AdPlatform, string]
          const cl = rows.filter(r => r.platform === pl && r.campaign === c)
          const budget = campaigns.find(x => x.platform === pl && x.campaign === c)?.daily_budget
          return (
            <div key={k} className="ad-multiple">
              <span className="t-smallb">
                {pl} · {c}
                {budget ? <span className="t-meta"> · 일 예산 {won(budget)}</span> : null}
              </span>
              <DayChart days={days} series={[{ key: k, label: c, color: P_COLOR[pl], values: days.map(d => cl.find(r => r.date === d)?.cost ?? null) }]} mode="stack" format={METRICS[0].format} height={130} label={`${pl} ${c} 일별 광고비`} />
            </div>
          )
        })}
      </div>
      </details>
    </>
  )
}

function DailyTable({ rows, days, platforms }: { rows: AdDaily[]; days: string[]; platforms: AdPlatform[] }) {
  const list = [...days].reverse().filter(d => rows.some(r => r.date === d))
  return (
    <>
      <SectionHead title="일별 요약" count={`${list.length}일`} right={<span className="t-cap">하루 한 줄 · 매체별 광고비</span>} />
      {list.length === 0 ? (
        <Empty>이 기간에 기록이 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>날짜</th>
                <th className="num">광고비</th>
                {platforms.map(pl => (
                  <th key={pl} className="num">
                    <i className="ad-dot" style={{ background: P_COLOR[pl] }} /> {pl}
                  </th>
                ))}
                <th className="num">노출</th>
                <th className="num">클릭</th>
                <th className="num">CTR</th>
                <th className="num">CPC</th>
              </tr>
            </thead>
            <tbody>
              {list.map(d => {
                const dl = rows.filter(r => r.date === d)
                const a = agg(dl)
                return (
                  <tr key={d}>
                    <td>{shortDate(d)}</td>
                    <td className="num">
                      <b>{won(a.cost)}</b>
                    </td>
                    {platforms.map(pl => {
                      const pl2 = dl.filter(r => r.platform === pl)
                      return (
                        <td key={pl} className="num">
                          {pl2.length ? won(agg(pl2).cost) : '–'}
                        </td>
                      )
                    })}
                    <td className="num">{num(a.imp)}</td>
                    <td className="num">{num(a.clk)}</td>
                    <td className="num">{pct(a.clk, a.imp)}</td>
                    <td className="num">{a.clk ? won(a.cost / a.clk) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function Creatives({ list, rows, side }: { list: AdCreative[]; rows: AdDaily[]; side: '우리' | '경쟁사' | '해외' }) {
  const [onlyLive, setOnlyLive] = useState(side === '우리')
  const [camp, setCamp] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const camps = [...new Set(list.map(c => c.campaign || c.brand))]
  const searchText = search.trim().toLocaleLowerCase('ko-KR')
  const shown = list.filter(c => (!onlyLive || !/이전|종료|중지/.test(c.status ?? '')) && (!camp || (c.campaign || c.brand) === camp) && (!searchText || [c.name, c.brand, c.campaign, c.headline, c.body].join(' ').toLocaleLowerCase('ko-KR').includes(searchText)))
  const groups = camps.filter(k => shown.some(c => (c.campaign || c.brand) === k))
  if (!list.length) return <Empty>{side === '우리' ? '아직 등록된 소재가 없습니다.' : '아직 수집된 광고 소재가 없습니다.'}</Empty>
  return (
    <>
      <div className="ads-creative-filters">
        <label className="ads-search"><Search size={16} /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="소재명·광고 문구 검색" aria-label={`${side} 소재 검색`} /></label>
        <label className="ads-creative-campaign"><span className="sr-only">캠페인 또는 브랜드</span><select aria-label={`${side} 소재 캠페인`} value={camp ?? ''} onChange={e => setCamp(e.target.value || null)}><option value="">전체 캠페인·브랜드</option>{camps.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
        {side === '우리' && (
          <label className="row t-small" style={{ gap: 4 }}>
            <input type="checkbox" checked={onlyLive} onChange={e => setOnlyLive(e.target.checked)} /> 최신 소재만
          </label>
        )}
        <span className="t-cap">{shown.length}개</span>
      </div>
      {shown.length === 0 && <div className="ads-empty compact"><h2>조건에 맞는 소재가 없습니다</h2><p>검색어나 캠페인, 최신 소재 필터를 바꿔 보세요.</p><button type="button" className="btn" onClick={() => { setSearch(''); setCamp(null); setOnlyLive(false) }}>필터 초기화</button></div>}
      {groups.map(g => {
        const items = shown.filter(c => (c.campaign || c.brand) === g)
        const perf = side === '우리' ? agg(rows.filter(r => r.campaign === g)) : null
        return (
          <section key={g} className="col gap-6">
            <SectionHead title={g} count={items.length} right={perf && perf.imp ? <span className="t-cap">조회 기간 광고비 {won(perf.cost)} · CTR {pct(perf.clk, perf.imp)}</span> : undefined} />
            <div className="ad-creatives">
              {items.map(c => (
                <a key={c.id} className="ad-creative" href={c.link ?? c.image_url ?? undefined} target="_blank" rel="noreferrer" title={c.note ?? c.name}>
                  <span className={`thumb${/스토리|9:16/.test(c.format ?? '') ? ' tall' : /가로/.test(c.format ?? '') ? ' wide' : ''}`}>
                    {c.image_url ? <img src={c.image_url} alt={c.name} loading="lazy" referrerPolicy="no-referrer" /> : <span className="t-cap">이미지 없음</span>}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    {c.platform && <i className="ad-dot" style={{ background: P_COLOR[(c.platform as AdPlatform) in P_COLOR ? (c.platform as AdPlatform) : '기타'] }} />}
                    <span className="t-smallb truncate grow">{side === '우리' ? c.format ?? c.name : c.brand}</span>
                    {c.link && <ExternalLink size={12} />}
                  </span>
                  {c.headline && <span className="t-small">{c.headline}</span>}
                  {c.body && <span className="t-cap clamp-3">{c.body}</span>}
                  <span className="t-meta">
                    {[c.platform, c.status, c.last_seen && `확인 ${shortDate(c.last_seen)}`].filter(Boolean).join(' · ')}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

function Analysis({ kind, reports, creatives, rows }: { kind: AdReportKind; reports: AdReport[]; creatives: AdCreative[]; rows: AdDaily[] }) {
  const { query, path, navigate } = useRouter()
  const list = reports.filter(r => r.kind === kind).sort((a, b) => b.report_date.localeCompare(a.report_date))
  const open = list.find(r => r.id === query.get('id')) ?? list[0] ?? null
  const selectReport = (id: string) => navigate(withQuery(path, query, { id }))
  const intro =
    kind === '일일 보고'
      ? '광고 성과, 개선점, 경쟁사 현황을 날짜별로 확인하세요.'
      : kind === '경쟁사 분석'
        ? '국내 공간 · 팝업 · 전시 · 브랜드 경험 회사의 광고 소재와 집행 방식 분석 (WKLY 총괄)'
        : '우리와 비슷한 매체 · 사업을 하는 해외 회사의 광고 집행 사례 분석 (WKLY 총괄)'
  const report = open && (
    <article className="report-paper ads-report-paper" aria-label={open.title}>
      <div className="row wrap">
        <Badge tone="acid">{kind}</Badge>
        <span className="t-meta grow">
          {open.report_date.replaceAll('-', '.')} · 수정 {dateTimeLabel(open.updated_at)}
        </span>
      </div>
      <h2>{open.title}</h2>
      {open.summary && <p className="t-small pre ad-summary"><Linkify text={open.summary} /></p>}
      <ReportBody body={open.body ?? ''} />
      {open.sources && (
        <details>
          <summary className="t-cap">출처</summary>
          <span className="t-cap pre">{open.sources}</span>
        </details>
      )}
    </article>
  )
  return (
    <><p className="ads-help">{intro}</p>
    {list.length === 0 && <Empty>아직 등록된 {kind} 보고서가 없습니다.</Empty>}
    {list.length > 0 && <label className="ads-report-picker"><span className="ads-filter-label">보고서 선택 · {list.length}개</span><select value={open?.id ?? ''} onChange={e => selectReport(e.target.value)}>{list.map(r => <option key={r.id} value={r.id}>{shortDate(r.report_date)} · {r.title}</option>)}</select></label>}
    <div className={`ad-analysis ads-report-layout${list.length === 0 ? ' no-reports' : ''}`}>
      {list.length > 0 && <aside className="ads-report-list" aria-label="보고서 목록">
        <div className="ads-report-list-title"><strong>보고서</strong><span>{list.length}개</span></div>
        {list.map(r => (
          <button key={r.id} type="button" aria-current={open?.id === r.id ? 'true' : undefined} className={open?.id === r.id ? 'active' : ''} onClick={() => selectReport(r.id)}>
            <span className="t-meta">{shortDate(r.report_date)}</span><strong>{r.title}</strong>
          </button>
        ))}
      </aside>}
      <div className="col gap-8" style={{ minWidth: 0 }}>
        {report}
        {creatives.length > 0 && (
          <>
            <SectionHead title={kind === '해외 사례' ? '해외 광고 소재' : '경쟁사 광고 소재'} count={creatives.length} />
            <Creatives list={creatives} rows={rows} side={kind === '해외 사례' ? '해외' : '경쟁사'} />
          </>
        )}
      </div>
    </div>
    </>
  )
}
