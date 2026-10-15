import { useMemo, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { addDays, dateTimeLabel, shortDate, todayKey } from '../lib/date'
import { AD_PLATFORMS, type AdCampaign, type AdDaily, type AdPlatform } from '../lib/types'
import { Shell } from '../components/Shell'
import { Badge, Chip, Empty, SectionHead } from '../components/ui'

const P_COLOR: Record<AdPlatform, string> = { Google: 'var(--blue)', Meta: 'var(--pink)', Naver: 'var(--green)', 기타: 'var(--gray)' }
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const num = (n: number) => Math.round(n).toLocaleString('ko-KR')
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '–')

type Range = 7 | 14 | 30 | 'month'

/** 광고 · 마케팅 대시보드 (관리자). WKLY 총괄이 매일 아침 광고 관리자 숫자를 기록 */
export default function Ads() {
  const { api, me, version } = useApp()
  const today = todayKey()
  const yesterday = addDays(today, -1)
  const [range, setRange] = useState<Range>(7)
  const [platform, setPlatform] = useState<AdPlatform | null>(null)
  const from = range === 'month' ? `${today.slice(0, 7)}-01` : addDays(yesterday, -(range - 1))
  const prevFrom = range === 'month' ? addDays(from, -30) : addDays(from, -range)
  const { data, loading } = useAsync(
    async () => {
      const [rows, campaigns] = await Promise.all([api.listAdDaily(prevFrom, today), api.listAdCampaigns()])
      return { rows, campaigns }
    },
    [prevFrom, today, version],
    { rows: [] as AdDaily[], campaigns: [] as AdCampaign[] },
  )
  const rows = data.rows.filter(r => (!platform || r.platform === platform) && r.date >= from)
  const prev = data.rows.filter(r => (!platform || r.platform === platform) && r.date >= prevFrom && r.date < from)
  const sum = (list: AdDaily[], k: 'cost' | 'impressions' | 'clicks' | 'conversions') => list.reduce((n, r) => n + Number(r[k] ?? 0), 0)
  const t = { cost: sum(rows, 'cost'), imp: sum(rows, 'impressions'), clk: sum(rows, 'clicks'), conv: sum(rows, 'conversions') }
  const p = { cost: sum(prev, 'cost'), imp: sum(prev, 'impressions'), clk: sum(prev, 'clicks') }
  const delta = (a: number, b: number) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(((a - b) / b) * 100).toFixed(0)}%` : '')

  const days = useMemo(() => {
    const out: string[] = []
    for (let d = from; d <= yesterday; d = addDays(d, 1)) out.push(d)
    return out
  }, [from, yesterday])
  const byDay = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const r of rows) {
      const cur = m.get(r.date) ?? {}
      cur[r.platform] = (cur[r.platform] ?? 0) + (r.cost ?? 0)
      m.set(r.date, cur)
    }
    return m
  }, [rows])
  const max = Math.max(1, ...days.map(d => Object.values(byDay.get(d) ?? {}).reduce((a, b) => a + b, 0)))
  const platforms = AD_PLATFORMS.filter(pl => data.rows.some(r => r.platform === pl))

  const byCampaign = useMemo(() => {
    const m = new Map<string, { platform: AdPlatform; campaign: string; cost: number; imp: number; clk: number; conv: number; days: number }>()
    for (const r of rows) {
      const k = `${r.platform}|${r.campaign}`
      const cur = m.get(k) ?? { platform: r.platform, campaign: r.campaign, cost: 0, imp: 0, clk: 0, conv: 0, days: 0 }
      cur.cost += r.cost ?? 0
      cur.imp += r.impressions ?? 0
      cur.clk += r.clicks ?? 0
      cur.conv += Number(r.conversions ?? 0)
      cur.days += 1
      m.set(k, cur)
    }
    for (const c of data.campaigns) if ((!platform || c.platform === platform) && !m.has(`${c.platform}|${c.campaign}`)) m.set(`${c.platform}|${c.campaign}`, { platform: c.platform, campaign: c.campaign, cost: 0, imp: 0, clk: 0, conv: 0, days: 0 })
    return [...m.values()].sort((a, b) => a.platform.localeCompare(b.platform) || b.cost - a.cost)
  }, [rows, data.campaigns, platform])
  const camp = (pl: string, c: string) => data.campaigns.find(x => x.platform === pl && x.campaign === c)
  const lastUpdate = data.rows.reduce<string | null>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null)
  const flags = data.campaigns.filter(c => c.flags)

  if (me.role !== 'admin') {
    return (
      <Shell active="ads">
        <Empty>관리자만 볼 수 있습니다.</Empty>
      </Shell>
    )
  }
  return (
    <Shell active="ads">
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
        <span className="t-cap">{lastUpdate ? `WKLY 총괄 갱신 ${dateTimeLabel(lastUpdate)} · 매일 08:37` : 'WKLY 총괄이 매일 08:37 어제 숫자를 기록합니다'}</span>
      </div>
      {data.rows.length === 0 ? (
        <Empty>{loading ? '불러오는 중…' : '아직 기록된 광고 숫자가 없습니다. 내일 아침 광고 대시보드 갱신 후 나타납니다.'}</Empty>
      ) : (
        <>
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
          {flags.length > 0 && (
            <div className="note">
              <b>⚠ 확인 필요</b>
              {flags.map(c => (
                <div key={`${c.platform}${c.campaign}`} className="t-small">
                  · {c.platform} {c.campaign} — {c.flags}
                </div>
              ))}
            </div>
          )}
          <SectionHead title="일별 광고비" right={<span className="t-cap">막대에 마우스를 올리면 매체별 금액</span>} />
          <div className="ad-chart" role="img" aria-label="일별 광고비 막대 그래프">
            {days.map(d => {
              const v = byDay.get(d) ?? {}
              const total = Object.values(v).reduce((a, b) => a + b, 0)
              return (
                <div key={d} className="ad-bar" title={`${shortDate(d)} · ${won(total)}\n${Object.entries(v).map(([k, n]) => `${k} ${won(n)}`).join('\n')}`}>
                  <div className="ad-stack" style={{ height: `${(total / max) * 100}%` }}>
                    {platforms
                      .filter(pl => v[pl])
                      .map(pl => (
                        <i key={pl} style={{ flexGrow: v[pl], background: P_COLOR[pl] }} />
                      ))}
                  </div>
                  <span className="t-meta">{days.length > 16 ? (d.endsWith('01') || d === days[0] ? shortDate(d) : Number(d.slice(8))) : shortDate(d)}</span>
                </div>
              )
            })}
          </div>
          <div className="legend">
            {platforms.map(pl => (
              <span key={pl}>
                <i style={{ background: P_COLOR[pl] }} />
                {pl}
              </span>
            ))}
          </div>
          <SectionHead title="캠페인별" count={byCampaign.length} />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>매체</th>
                  <th>캠페인</th>
                  <th>상태</th>
                  <th className="num">일 예산</th>
                  <th className="num">광고비</th>
                  <th className="num">노출</th>
                  <th className="num">클릭</th>
                  <th className="num">CTR</th>
                  <th className="num">CPC</th>
                  <th className="num">전환</th>
                </tr>
              </thead>
              <tbody>
                {byCampaign.map(r => {
                  const c = camp(r.platform, r.campaign)
                  return (
                    <tr key={`${r.platform}${r.campaign}`}>
                      <td>
                        <span className="row" style={{ gap: 4 }}>
                          <i className="ad-dot" style={{ background: P_COLOR[r.platform] }} />
                          {r.platform}
                        </span>
                      </td>
                      <td title={c?.full_name ?? undefined}>
                        {r.campaign}
                        {c?.flags && (
                          <span className="t-red" title={c.flags}>
                            {' '}
                            ⚠
                          </span>
                        )}
                      </td>
                      <td>{c?.status ? <Badge tone={/중|활성|게재|운영|ON/i.test(c.status) ? 'acid' : 'gray'}>{c.status}</Badge> : '–'}</td>
                      <td className="num">{c?.daily_budget ? won(c.daily_budget) : '–'}</td>
                      <td className="num">{won(r.cost)}</td>
                      <td className="num">{num(r.imp)}</td>
                      <td className="num">{num(r.clk)}</td>
                      <td className="num">{pct(r.clk, r.imp)}</td>
                      <td className="num">{r.clk ? won(r.cost / r.clk) : '–'}</td>
                      <td className="num">{r.platform === 'Google' ? num(r.conv) : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <span className="t-cap">숫자는 각 광고 관리자에서 전날 기준으로 읽은 값입니다(원, VAT 별도). Google 전환은 페이지 조회가 포함되어 실제보다 많을 수 있습니다.</span>
        </>
      )}
    </Shell>
  )
}
