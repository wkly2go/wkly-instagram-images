// 정부지원사업 — 관리자 전용 메뉴 (2026-11-19 대표 지시 '인트라넷에 만들어' · '관리자 메뉴는 비공개야' · '더위클리와 아트리어 자료들 사용해')
// 서버가 매일 아침 공공데이터(K-Startup)에서 모집 중 공고를 받아 회사마다 따로 판정한다 (자동).
// 사람은 추천된 공고를 보고 검토 → 신청 준비 → 제출 → 선정/탈락 단계만 바꾼다. 신청 · 제출은 인트라넷이 하지 않는다.
import { Fragment, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { Shell } from '../components/Shell'
import { Badge, Button, Empty, Linkify, Loading, type Tone } from '../components/ui'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate, todayKey } from '../lib/date'
import { GOV_FITS, GOV_STATUSES, daysLeft, ddayLabel, filterGovPrograms, fitFor, govCounts, parseKeywords, type GovCompany, type GovFilter, type GovFit, type GovProgram, type GovStatus } from '../lib/gov'
import './Design.css'
import './Gov.css'

const FIT_TONE: Record<GovFit, Tone> = { 높음: 'green', 보통: 'yellow', 낮음: 'paper', 제외: 'gray' }
const STATUS_TONE: Record<GovStatus, Tone> = { 신규: 'outline', '검토 중': 'blue', '신청 준비': 'yellow', 제출: 'acid', 선정: 'green', 탈락: 'gray', 보류: 'paper', 마감: 'gray' }
const STATUS_TABS: { key: GovFilter['status']; label: string }[] = [{ key: 'open', label: '모집 중' }, { key: '검토 중', label: '검토 중' }, { key: '신청 준비', label: '신청 준비' }, { key: '제출', label: '제출' }, { key: '선정', label: '선정' }, { key: '탈락', label: '탈락' }, { key: '보류', label: '보류' }, { key: '마감', label: '마감' }, { key: 'all', label: '전체' }]

export default function Gov() {
  const { me } = useApp()
  return (
    <Shell active="gov">
      {me.role !== 'admin' ? (
        <Empty>관리자만 볼 수 있는 화면입니다.</Empty>
      ) : (
        <div className="design-page gov">
          <header className="design-head">
            <h1 className="t-title">정부지원사업</h1>
            <p className="t-cap">매일 아침 공공데이터에서 모집 중인 지원사업 공고를 받아 회사별로 맞는지 판정합니다. 판정은 참고용이며, 신청 자격은 공고 원문으로 확인해 주세요. 신청 · 제출은 각 기관 누리집에서 직접 합니다.</p>
          </header>
          <Board />
        </div>
      )}
    </Shell>
  )
}

function Board() {
  const { api, version, bump, toast } = useApp()
  const { run, busy } = useAction()
  const today = todayKey()
  const { data: list, loading } = useAsync(() => api.listGovPrograms(), [version], [] as GovProgram[])
  const { data: companies } = useAsync(() => api.listGovCompanies(), [version], [] as GovCompany[])
  const [f, setF] = useState<GovFilter>({ company: null, fit: '높음', status: 'open', word: '' })
  const [open, setOpen] = useState<string | null>(null)
  const [rules, setRules] = useState(false)
  const shown = useMemo(() => filterGovPrograms(list, f), [list, f])
  const n = useMemo(() => govCounts(list, f.company, today), [list, f.company, today])
  const short = (key: string) => companies.find(c => c.key === key)?.short ?? key
  const refresh = () => void run(async () => { const got = await api.refreshGovPrograms(); toast(`공고 ${got}건을 다시 받았습니다`); bump() })

  return (
    <div className="design-block">
      <div className="gov-tiles">
        <Tile label="새 추천" value={n.recommended} hint="판정 높음 · 아직 안 본 것" onClick={() => setF({ ...f, fit: '높음', status: '신규' })} />
        <Tile label="7일 안 마감" value={n.closingSoon} hint="추천 · 진행 중인 것만" warn={n.closingSoon > 0} onClick={() => setF({ ...f, fit: 'all', status: 'open' })} />
        <Tile label="진행 중" value={n.active} hint="검토 · 신청 준비 · 제출" onClick={() => setF({ ...f, fit: 'all', status: '검토 중' })} />
        <Tile label="선정" value={n.won} hint="누적" onClick={() => setF({ ...f, fit: 'all', status: '선정' })} />
      </div>

      <div className="row wrap gov-bar">
        <div className="row wrap" role="tablist" aria-label="회사">
          <Pick on={f.company === null} onClick={() => setF({ ...f, company: null })}>두 회사</Pick>
          {companies.map(c => <Pick key={c.key} on={f.company === c.key} onClick={() => setF({ ...f, company: c.key })}>{c.short}</Pick>)}
        </div>
        <span className="gov-sep" aria-hidden />
        <div className="row wrap" role="tablist" aria-label="판정">
          {GOV_FITS.map(k => <Pick key={k} on={f.fit === k} onClick={() => setF({ ...f, fit: k })}>{k === '높음' ? '추천' : k}</Pick>)}
          <Pick on={f.fit === 'all'} onClick={() => setF({ ...f, fit: 'all' })}>전체</Pick>
        </div>
        <span className="gov-grow" />
        <Button kind="outline" size="sm" onClick={() => setRules(v => !v)} aria-expanded={rules}><SlidersHorizontal size={13} /> 판정 기준</Button>
        <Button kind="outline" size="sm" onClick={refresh} disabled={busy}><RefreshCw size={13} /> 지금 다시 받기</Button>
      </div>

      {rules && <Rules companies={companies} />}

      <div className="row wrap">
        <div className="row wrap" role="tablist" aria-label="진행 단계">
          {STATUS_TABS.map(t => <Pick key={t.key} on={f.status === t.key} onClick={() => setF({ ...f, status: t.key })}>{t.label}</Pick>)}
        </div>
        <input className="input design-filter" type="search" value={f.word} onChange={e => setF({ ...f, word: e.target.value })} placeholder="공고 · 기관 · 분야 찾기" aria-label="공고 찾기" />
        <span className="t-cap">{shown.length}건</span>
      </div>

      {loading ? <Loading /> : shown.length === 0 ? (
        <Empty>{list.length === 0 ? '아직 받은 공고가 없습니다. 매일 아침 6시 35분에 자동으로 받아 옵니다.' : '조건에 맞는 공고가 없습니다. 판정 · 단계를 바꿔 보세요.'}</Empty>
      ) : (
        <div className="table-wrap"><table className="table gov-table">
          <thead><tr><th>마감</th><th>공고</th><th>분야</th><th>판정</th><th>단계</th></tr></thead>
          <tbody>
            {shown.map(p => {
              const left = daysLeft(p.apply_end, today)
              const on = open === p.id
              return (
                <Fragment key={p.id}>
                  <tr className={on ? 'gov-open' : undefined} onClick={() => setOpen(on ? null : p.id)}>
                    <td className="nowrap"><b className={left != null && left >= 0 && left <= 7 ? 't-red' : undefined}>{ddayLabel(left)}</b><span className="cell-sub">{p.apply_end ? shortDate(p.apply_end) : '마감일 없음'}</span></td>
                    <td className="max"><button type="button" className="gov-title" aria-expanded={on}>{p.title.trim()}</button><span className="cell-sub">{[p.org, p.region].filter(Boolean).join(' · ')}</span></td>
                    <td className="nowrap">{p.category ?? '-'}</td>
                    <td className="nowrap"><Fits p={p} company={f.company} short={short} /></td>
                    <td className="nowrap" onClick={e => e.stopPropagation()}>
                      <select className={`select gov-status ${STATUS_TONE[p.status]}`} value={p.status} disabled={busy} aria-label={`${p.title} 단계`} onChange={e => void run(async () => { await api.updateGovProgram(p.id, { status: e.target.value as GovStatus }); bump() }, '단계를 바꿨습니다')}>
                        {GOV_STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                  {on && <tr className="gov-detail"><td colSpan={5}><Detail p={p} short={short} companies={companies} /></td></tr>}
                </Fragment>
              )
            })}
          </tbody>
        </table></div>
      )}
    </div>
  )
}

function Pick({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={on} className={`chip${on ? ' active' : ''}`} onClick={onClick}>{children}</button>
}

function Tile({ label, value, hint, warn, onClick }: { label: string; value: number; hint: string; warn?: boolean; onClick: () => void }) {
  return <button type="button" className="gov-tile" onClick={onClick}><span className="t-cap">{label}</span><b className={warn ? 't-red' : undefined}>{value}</b><span className="t-cap">{hint}</span></button>
}

/** 판정 배지: 회사를 고르면 그 회사 것 하나, 아니면 회사마다 */
function Fits({ p, company, short }: { p: GovProgram; company: string | null; short: (k: string) => string }) {
  if (company) { const one = fitFor(p, company); return <Badge tone={FIT_TONE[one.fit]} title={one.note ?? undefined}>{one.fit === '높음' ? '추천' : one.fit} {one.score > 0 ? one.score : ''}</Badge> }
  const keys = Object.keys(p.fits ?? {})
  if (!keys.length) return <Badge tone={FIT_TONE[p.fit]}>{p.fit}</Badge>
  return <span className="gov-fits">{keys.map(k => <Badge key={k} tone={FIT_TONE[p.fits[k].fit]} title={p.fits[k].note ?? undefined}>{short(k)} {p.fits[k].fit === '높음' ? '추천' : p.fits[k].fit}</Badge>)}</span>
}

function Detail({ p, short, companies }: { p: GovProgram; short: (k: string) => string; companies: GovCompany[] }) {
  const { api, bump, profiles } = useApp()
  const { run, busy } = useAction()
  const [note, setNote] = useState(p.decision_note ?? '')
  const people = profiles.filter(x => x.active && !x.is_agent)
  const order = companies.length ? companies.map(c => c.key).filter(k => p.fits?.[k]) : Object.keys(p.fits ?? {})
  return (
    <div className="gov-box">
      <div className="gov-why">
        {order.map(k => (
          <div key={k}><Badge tone={FIT_TONE[p.fits[k].fit]}>{short(k)} · {p.fits[k].fit === '높음' ? '추천' : p.fits[k].fit}{p.fits[k].score > 0 ? ` ${p.fits[k].score}점` : ''}</Badge><span>{p.fits[k].note ?? '판정 근거 없음'}</span></div>
        ))}
      </div>
      <dl className="gov-dl">
        {p.summary && <><dt>개요</dt><dd><Linkify text={p.summary} /></dd></>}
        {p.target_detail && <><dt>신청 대상</dt><dd><Linkify text={p.target_detail} /></dd></>}
        {p.support_content && <><dt>지원 내용</dt><dd><Linkify text={p.support_content} /></dd></>}
        {p.exclude_detail && <><dt>제외 대상</dt><dd><Linkify text={p.exclude_detail} /></dd></>}
        <dt>조건</dt><dd>{[p.target && `대상 ${p.target}`, p.biz_years && `업력 ${p.biz_years.replace(/,/g, ' · ')}`, p.supervising && `${p.supervising} 주관`].filter(Boolean).join(' / ') || '-'}</dd>
        <dt>접수</dt><dd>{p.apply_start ? shortDate(p.apply_start) : '?'} ~ {p.apply_end ? shortDate(p.apply_end) : '상시'}{p.contact ? ` · 문의 ${p.contact}` : ''}</dd>
      </dl>
      <div className="row wrap">
        {p.detail_url && <a className="btn btn-outline btn-sm" href={p.detail_url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> 공고 원문</a>}
        {p.apply_url && /^https?:\/\//.test(p.apply_url) && <a className="btn btn-outline btn-sm" href={p.apply_url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> 신청 누리집</a>}
        <select className="select gov-owner" value={p.owner_id ?? ''} disabled={busy} aria-label="담당자" onChange={e => void run(async () => { await api.updateGovProgram(p.id, { owner_id: e.target.value || null }); bump() }, '담당자를 바꿨습니다')}>
          <option value="">담당자 없음</option>
          {people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <form className="row wrap gov-note" onSubmit={e => { e.preventDefault(); void run(async () => { await api.updateGovProgram(p.id, { decision_note: note.trim() || null }); bump() }, '메모를 저장했습니다') }}>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="메모 (검토 결과 · 준비할 서류 · 보류 이유)" aria-label="메모" maxLength={500} />
        <Button kind="outline" size="sm" type="submit" disabled={busy || note.trim() === (p.decision_note ?? '')}>메모 저장</Button>
      </form>
    </div>
  )
}

/** 회사별 판정 기준 — 서류에서 옮긴 설립일 · 업종 · 인증은 읽기만, 관심 · 제외 낱말은 고쳐서 다시 판정 */
function Rules({ companies }: { companies: GovCompany[] }) {
  if (!companies.length) return null
  return (
    <div className="gov-rules">
      {companies.map(c => <Rule key={c.key} c={c} />)}
      <p className="t-cap">판정 방식: 지역 · 업력이 안 맞으면 제외, 그 밖에는 관심 낱말 · 지원 분야 · 주관 기관 · 보유 인증 언급으로 점수를 매깁니다(60점 이상 추천). AI 를 쓰지 않는 계산식이라 비용이 없고, 공고문의 세부 조건(매출 · 인원 · 대표 나이)은 보지 못합니다.</p>
    </div>
  )
}

function Rule({ c }: { c: GovCompany }) {
  const { api, bump, toast } = useApp()
  const { run, busy } = useAction()
  const [inc, setInc] = useState(c.include_keywords.join(', '))
  const [exc, setExc] = useState(c.exclude_keywords.join(', '))
  const dirty = inc !== c.include_keywords.join(', ') || exc !== c.exclude_keywords.join(', ')
  const save = () => void run(async () => { const n = await api.saveGovCompany(c.key, { include_keywords: parseKeywords(inc), exclude_keywords: parseKeywords(exc) }); toast(`${c.short} 기준을 저장하고 ${n}건을 다시 판정했습니다`); bump() })
  return (
    <section className="gov-rule">
      <h2 className="t-em">{c.name}</h2>
      <dl className="gov-dl">
        <dt>설립</dt><dd>{c.founded} · {c.region}</dd>
        <dt>업종</dt><dd>{c.industries || '-'}</dd>
        <dt>인증</dt><dd>{c.cert_notes || '없음'}</dd>
        <dt>관심 낱말</dt><dd><textarea className="input" rows={2} value={inc} onChange={e => setInc(e.target.value)} aria-label={`${c.short} 관심 낱말`} /></dd>
        <dt>제외 낱말</dt><dd><textarea className="input" rows={2} value={exc} onChange={e => setExc(e.target.value)} aria-label={`${c.short} 제외 낱말`} /></dd>
      </dl>
      <div className="row"><Button size="sm" onClick={save} disabled={busy || !dirty}>저장하고 다시 판정</Button></div>
    </section>
  )
}
