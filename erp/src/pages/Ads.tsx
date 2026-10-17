import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { addDays, dateTimeLabel, shortDate, todayKey } from '../lib/date'
import { useRouter, withQuery } from '../lib/router'
import { AD_PLATFORMS, type AdCampaign, type AdCreative, type AdDaily, type AdPlatform, type AdReport, type AdReportKind, type SeoCheck } from '../lib/types'
import { Shell } from '../components/Shell'
import { usePanelWide, useRightPanel } from '../components/RightPanel'
import { Badge, Chip, Empty, SectionHead } from '../components/ui'
import { ReportBody } from '../components/Reports'
import { CompareBars, DayChart, Spark, type Series } from '../components/AdCharts'
import { SeoPanel } from '../components/SeoPanel'

const P_COLOR: Record<AdPlatform, string> = { Google: 'var(--blue)', Meta: 'var(--pink)', Naver: 'var(--green)', 기타: 'var(--gray)' }
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const num = (n: number) => Math.round(n).toLocaleString('ko-KR')
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '–')
const shortNum = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만` : num(n))

type Range = 7 | 14 | 30 | 'month'
type Tab = 'summary' | 'platform' | 'charts' | 'daily-table' | 'creatives' | 'competitors' | 'overseas' | 'daily' | 'seo'
const TABS: [Tab, string][] = [
  ['summary', '요약'],
  ['platform', '매체별 보고서'],
  ['charts', '그래프'],
  ['daily-table', '일별'],
  ['creatives', '우리 소재'],
  ['competitors', '경쟁사 분석'],
  ['overseas', '해외 사례'],
  ['daily', '09시 일일 보고'],
  ['seo', '검색 노출 (SEO · AEO · GEO)'],
]

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

/** 광고 · 마케팅 (관리자). WKLY 총괄이 매일 07:00 숫자 기록 · 09:00 개선점과 경쟁사 현황 보고 */
export default function Ads() {
  const { api, me, version } = useApp()
  const { query, path, navigate } = useRouter()
  const tab = (TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'summary') as Tab
  const setTab = (t: Tab) => navigate(withQuery(path, query, { tab: t === 'summary' ? null : t, id: null }))
  const today = todayKey()
  const yesterday = addDays(today, -1)
  const [range, setRange] = useState<Range>(14)
  const [platform, setPlatform] = useState<AdPlatform | null>(null)
  const from = range === 'month' ? `${today.slice(0, 7)}-01` : addDays(yesterday, -(range - 1))
  const prevFrom = range === 'month' ? addDays(from, -30) : addDays(from, -range)
  const { data, loading } = useAsync(
    async () => {
      const [rows, campaigns, creatives, reports, seo] = await Promise.all([api.listAdDaily(prevFrom, today), api.listAdCampaigns(), api.listAdCreatives(), api.listAdReports(), api.listSeoChecks()])
      return { rows, campaigns, creatives, reports, seo }
    },
    [prevFrom, today, version],
    { rows: [] as AdDaily[], campaigns: [] as AdCampaign[], creatives: [] as AdCreative[], reports: [] as AdReport[], seo: [] as SeoCheck[] },
  )
  const rows = data.rows.filter(r => (!platform || r.platform === platform) && r.date >= from)
  const prev = data.rows.filter(r => (!platform || r.platform === platform) && r.date >= prevFrom && r.date < from)
  const platforms = AD_PLATFORMS.filter(pl => data.rows.some(r => r.platform === pl) || data.campaigns.some(c => c.platform === pl))
  const shownPlatforms = platforms.filter(pl => !platform || pl === platform)
  const days = useMemo(() => {
    const out: string[] = []
    for (let d = from; d <= yesterday; d = addDays(d, 1)) out.push(d)
    return out
  }, [from, yesterday])
  const lastUpdate = data.rows.reduce<string | null>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null)

  if (me.role !== 'admin') {
    return (
      <Shell active="ads">
        <Empty>관리자만 볼 수 있습니다.</Empty>
      </Shell>
    )
  }
  const showsNumbers = tab === 'summary' || tab === 'platform' || tab === 'charts' || tab === 'daily-table'
  return (
    <Shell active="ads">
      <div className="chips ad-tabs" role="tablist" aria-label="광고 메뉴">
        {TABS.map(([k, l]) => (
          <Chip key={k} active={tab === k} onClick={() => setTab(k)}>
            {l}
            {k === 'daily' && data.reports.some(r => r.kind === '일일 보고' && r.report_date === today) ? ' ●' : ''}
          </Chip>
        ))}
      </div>
      {showsNumbers && (
        <div className="row wrap">
          <div className="chips">
            {([7, 14, 30, 'month'] as Range[]).map(r => (
              <Chip key={r} active={range === r} onClick={() => setRange(r)}>
                {r === 'month' ? '이번 달' : `최근 ${r}일`}
              </Chip>
            ))}
          </div>
          <div className="chips">
            <Chip active={!platform} onClick={() => setPlatform(null)}>
              전체 매체
            </Chip>
            {platforms.map(pl => (
              <Chip key={pl} active={platform === pl} onClick={() => setPlatform(platform === pl ? null : pl)}>
                {pl}
              </Chip>
            ))}
          </div>
          <span className="grow" />
          <span className="t-cap">{lastUpdate ? `숫자 갱신 ${dateTimeLabel(lastUpdate)} · 매일 07:00 기록 · 09:00 보고` : 'WKLY 총괄이 매일 07:00 어제 숫자를 기록하고 09:00에 보고합니다'}</span>
        </div>
      )}
      {showsNumbers && data.rows.length === 0 ? (
        <Empty>{loading ? '불러오는 중…' : '아직 기록된 광고 숫자가 없습니다. 내일 아침 광고 대시보드 갱신 후 나타납니다.'}</Empty>
      ) : tab === 'summary' ? (
        <Summary rows={rows} prev={prev} days={days} platforms={shownPlatforms} campaigns={data.campaigns} reports={data.reports} goTab={setTab} />
      ) : tab === 'platform' ? (
        <PlatformReport rows={rows} days={days} platforms={shownPlatforms} campaigns={data.campaigns} />
      ) : tab === 'charts' ? (
        <Charts rows={rows} days={days} platforms={shownPlatforms} campaigns={data.campaigns} />
      ) : tab === 'daily-table' ? (
        <DailyTable rows={rows} days={days} platforms={shownPlatforms} />
      ) : tab === 'creatives' ? (
        <Creatives list={data.creatives.filter(c => c.side === '우리')} rows={data.rows} side="우리" />
      ) : tab === 'competitors' ? (
        <Analysis kind="경쟁사 분석" reports={data.reports} creatives={data.creatives.filter(c => c.side === '경쟁사')} rows={data.rows} />
      ) : tab === 'seo' ? (
        <SeoPanel checks={data.seo} />
      ) : tab === 'overseas' ? (
        <Analysis kind="해외 사례" reports={data.reports} creatives={data.creatives.filter(c => c.side === '해외')} rows={data.rows} />
      ) : (
        <Analysis kind="일일 보고" reports={data.reports} creatives={[]} rows={data.rows} />
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------

function Kpis({ rows, prev, days }: { rows: AdDaily[]; prev: AdDaily[]; days: string[] }) {
  const t = agg(rows)
  const p = agg(prev)
  const delta = (a: number, b: number) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(((a - b) / b) * 100).toFixed(0)}%` : '')
  return (
    <div className="kpis kpis-4">
      <div className="kpi">
        <span className="t-cap">광고비</span>
        <span className="v">{won(t.cost)}</span>
        <span className="sub">
          하루 평균 {won(t.cost / Math.max(1, days.length))} {delta(t.cost, p.cost)}
        </span>
      </div>
      <div className="kpi">
        <span className="t-cap">노출</span>
        <span className="v">{num(t.imp)}</span>
        <span className="sub">이전 기간 대비 {delta(t.imp, p.imp) || '–'}</span>
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
    </div>
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
    <div className="note">
      <b>⚠ 확인 필요</b>
      {flags.map(c => (
        <div key={`${c.platform}${c.campaign}`} className="t-small">
          · {c.platform} {c.campaign} — {c.flags}
        </div>
      ))}
    </div>
  )
}

function Summary({ rows, prev, days, platforms, campaigns, reports, goTab }: { rows: AdDaily[]; prev: AdDaily[]; days: string[]; platforms: AdPlatform[]; campaigns: AdCampaign[]; reports: AdReport[]; goTab: (t: Tab) => void }) {
  const latest = reports.find(r => r.kind === '일일 보고')
  return (
    <>
      <Kpis rows={rows} prev={prev} days={days} />
      {latest && (
        <button type="button" className="ad-report-card" onClick={() => goTab('daily')}>
          <span className="row">
            <Badge tone="acid">09시 보고</Badge>
            <span className="t-bodyb grow truncate">{latest.title}</span>
            <span className="t-meta">{shortDate(latest.report_date)}</span>
          </span>
          {latest.summary && <span className="t-small pre">{latest.summary}</span>}
        </button>
      )}
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
              <span className="t-cap">{camps[0]?.status ?? '기록 없음'}</span>
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
                        <td className="num">{won(a.cost)}</td>
                        <td className="num">{num(a.imp)}</td>
                        <td className="num">{num(a.clk)}</td>
                        <td className="num">{pct(a.clk, a.imp)}</td>
                        <td className="num">{a.clk ? won(a.cost / a.clk) : '–'}</td>
                        {pl === 'Google' && <td className="num">{num(a.conv)}</td>}
                        <td>{cl.length ? <Spark values={days.map(d => cl.find(r => r.date === d)?.cost ?? 0)} color={P_COLOR[pl]} /> : <span className="t-meta">기록 없음</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {campaigns.filter(c => c.platform === pl && c.flags).map(c => (
              <span key={c.campaign} className="t-cap t-red">
                ⚠ {c.campaign} — {c.flags}
              </span>
            ))}
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
      <SectionHead title="모든 지표 한눈에" />
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
      <SectionHead title="캠페인별 일별 광고비" />
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
  const camps = [...new Set(list.map(c => c.campaign || c.brand))]
  const shown = list.filter(c => (!onlyLive || !/이전|종료|중지/.test(c.status ?? '')) && (!camp || (c.campaign || c.brand) === camp))
  const groups = camps.filter(k => shown.some(c => (c.campaign || c.brand) === k))
  if (!list.length) return <Empty>{side === '우리' ? '아직 등록된 소재가 없습니다.' : '아직 수집된 광고 소재가 없습니다. 매일 09시 보고 때 함께 모읍니다.'}</Empty>
  return (
    <>
      <div className="row wrap">
        <div className="chips">
          <Chip active={!camp} onClick={() => setCamp(null)}>
            전체
          </Chip>
          {camps.map(k => (
            <Chip key={k} active={camp === k} onClick={() => setCamp(camp === k ? null : k)}>
              {k}
            </Chip>
          ))}
        </div>
        <span className="grow" />
        {side === '우리' && (
          <label className="row t-small" style={{ gap: 4 }}>
            <input type="checkbox" checked={onlyLive} onChange={e => setOnlyLive(e.target.checked)} /> 최신 소재만
          </label>
        )}
        <span className="t-cap">{shown.length}개</span>
      </div>
      {groups.map(g => {
        const items = shown.filter(c => (c.campaign || c.brand) === g)
        const perf = side === '우리' ? agg(rows.filter(r => r.campaign === g)) : null
        return (
          <section key={g} className="col gap-6">
            <SectionHead title={g} count={items.length} right={perf && perf.imp ? <span className="t-cap">캠페인 누적 광고비 {won(perf.cost)} · CTR {pct(perf.clk, perf.imp)}</span> : undefined} />
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
  const { query } = useRouter()
  const list = reports.filter(r => r.kind === kind)
  const [openId, setOpenId] = useState<string | null>(query.get('id') ?? list[0]?.id ?? null)
  const open = list.find(r => r.id === openId) ?? list[0] ?? null
  const intro =
    kind === '일일 보고'
      ? '매일 09:00 — 어제 광고 성과, 개선점, 경쟁사 광고 현황 (WKLY 총괄)'
      : kind === '경쟁사 분석'
        ? '국내 공간 · 팝업 · 전시 · 브랜드 경험 회사의 광고 소재와 집행 방식 분석 (WKLY 총괄)'
        : '우리와 비슷한 매체 · 사업을 하는 해외 회사의 광고 집행 사례 분석 (WKLY 총괄)'
  // 넓은 화면: 보고서 본문은 오른쪽 칸, 가운데는 목록 · 소재
  const wide = usePanelWide()
  const report = open && (
    <article className="report-paper">
      <div className="row">
        <Badge tone="acid">{kind}</Badge>
        <span className="t-meta grow">
          {shortDate(open.report_date)} · {dateTimeLabel(open.updated_at)}
        </span>
      </div>
      {open.summary && <p className="t-small pre ad-summary">{open.summary}</p>}
      <ReportBody body={open.body ?? ''} />
      {open.sources && (
        <details>
          <summary className="t-cap">출처</summary>
          <span className="t-cap pre">{open.sources}</span>
        </details>
      )}
    </article>
  )
  useRightPanel(wide && open ? `ad-report:${open.id}` : null, kind, report)
  return (
    <div className={`ad-analysis${wide ? ' one' : ''}`}>
      <aside className="col gap-4">
        <span className="t-cap">{intro}</span>
        {list.length === 0 && <Empty>아직 보고서가 없습니다. 내일 09:00 보고부터 쌓입니다.</Empty>}
        {list.map(r => (
          <button key={r.id} type="button" className={`team-person${open?.id === r.id ? ' active' : ''}`} onClick={() => setOpenId(r.id)}>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="t-smallb truncate">{r.title}</span>
              <span className="t-meta">{shortDate(r.report_date)}</span>
            </span>
          </button>
        ))}
      </aside>
      <div className="col gap-8" style={{ minWidth: 0 }}>
        {open && !wide && report}
        {creatives.length > 0 && (
          <>
            <SectionHead title={kind === '해외 사례' ? '해외 광고 소재' : '경쟁사 광고 소재'} count={creatives.length} />
            <Creatives list={creatives} rows={rows} side={kind === '해외 사례' ? '해외' : '경쟁사'} />
          </>
        )}
      </div>
    </div>
  )
}
