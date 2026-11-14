import { useEffect, useRef, useState } from 'react'
import { isSampleLookup, type LookupSource, type SecretStatusId } from '../../supabase/functions/sales-api/sources'
import type { SalesLookupResult, SalesLookupRow } from '../../supabase/functions/sales-api/lookupTypes'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { todayKey } from '../lib/date'
import { safeWebUrl } from '../lib/growth'
import { registerDraftNavigation } from '../lib/navigationGuard'
import { shiftDate } from '../lib/prospecting'
import { newSalesDraft, type SalesDraft } from '../lib/sales'
import { Button, Field } from './ui'

type LookupValues = Record<string, string | number | boolean>
type LookupField = { key: string; label: string; type?: 'date' | 'month'; hint?: string; options?: readonly (readonly [string, string])[] }
interface SourceOption {
  id: LookupSource
  label: string
  fields: LookupField[]
  description?: string
  opportunity?: boolean
}

const keyword: LookupField = { key: 'keyword', label: '검색어' }
const region: LookupField = { key: 'region', label: '지역', options: ['서울', '인천', '경기'].map(name => [name, name] as const) }
const category: LookupField = { key: 'category', label: '조회 업무', options: [['service', '용역'], ['construction', '공사']] }
const dates: LookupField[] = [
  { key: 'startDate', label: '시작일', type: 'date' },
  { key: 'endDate', label: '종료일', type: 'date' },
]
const parcel: LookupField[] = [
  { key: 'sigunguCd', label: '시군구 코드 (5자리)' },
  { key: 'bjdongCd', label: '법정동 코드 (5자리)' },
  { key: 'platGbCd', label: '대지 구분', options: [['0', '대지'], ['1', '산'], ['2', '블록']] },
  { key: 'bun', label: '지번 본번' },
  { key: 'ji', label: '지번 부번 (선택)' },
]
const sources: SourceOption[] = [
  { id: 'bizinfo', label: '기업마당 지원사업', fields: [keyword, region], opportunity: true, description: '지원사업 모집 정보를 조회합니다. 검색어는 현재 조회한 페이지에 적용됩니다.' },
  { id: 'preSpec', label: '나라장터 사전규격', fields: [category, ...dates, keyword], description: '접수일 기준 조회입니다.', opportunity: true },
  { id: 'orderPlan', label: '나라장터 발주계획', fields: [category, ...dates,
    { key: 'orderStartMonth', label: '발주 시작월', type: 'month' }, { key: 'orderEndMonth', label: '발주 종료월', type: 'month' }, keyword], opportunity: true },
  { id: 'contractProcess', label: '나라장터 계약과정', fields: [category, { key: 'number', label: '입찰공고번호' }, { key: 'round', label: '공고 차수 (선택)' }] },
  { id: 'award', label: '나라장터 낙찰정보', fields: [category, ...dates, keyword], description: '개찰일 기준으로 낙찰 결과를 확인합니다.' },
  { id: 'contract', label: '나라장터 계약정보', fields: [category, ...dates, keyword], description: '계약 체결일 기준 조회입니다.' },
  { id: 'seoulEvents', label: '서울시 문화행사 (샘플)', fields: [], description: '공개 샘플을 확인합니다. 운영 인증키는 보안 연결이 확인된 뒤 적용합니다.' },
  { id: 'seoulPopulation', label: '서울시 상권 생활인구 (샘플)', fields: [{ key: 'quarter', label: '기준 분기 (YYYYQ)', hint: '예: 20262' }], description: '공개 샘플을 확인합니다. 운영 인증키는 보안 연결이 확인된 뒤 적용합니다.' },
  { id: 'kakao', label: '카카오 장소 검색', fields: [{ ...keyword, label: '장소 검색어', hint: '예: 성수 전시장' }] },
  { id: 'district', label: '주변 상가·상권', fields: [{ key: 'longitude', label: '경도', hint: '예: 127.0558' }, { key: 'latitude', label: '위도', hint: '예: 37.5446' }, { key: 'radius', label: '반경 (m)', hint: '기본 500' }] },
  { id: 'buildingRegister', label: '건축물대장', fields: parcel },
  { id: 'buildingPermit', label: '건축인허가', fields: parcel },
  { id: 'restaurant', label: '일반음식점 인허가', fields: [keyword, { key: 'address', label: '주소 또는 지역명' }, ...dates], opportunity: true },
]

const additionalStatus: [SecretStatusId, string, string][] = [
  ['bidNotice', '나라장터 입찰공고', '나라장터 공고 탭에서 실조회'],
  ['anthropic', 'Anthropic', '기존 회의록·AI 기능에서 사용'],
  ['seoulLegacy', '서울시 기존 공용 이름', '용도별 등록 이름과 함께 표시'],
  ['naverId', '네이버 ID', '발급 환경 및 이용 조건 확인 필요'],
  ['naverSecret', '네이버 Secret', '발급 환경 및 이용 조건 확인 필요'],
  ['youtube', '유튜브', '발급된 키 유형과 권한 확인 필요'],
]

function defaults(source: LookupSource): LookupValues {
  const today = todayKey()
  const month = today.slice(0, 7)
  if (source === 'seoulEvents') return { sample: true }
  if (source === 'seoulPopulation') return { sample: true, quarter: String(Number(today.slice(0, 4)) * 10 + Math.max(1, Math.ceil(Number(today.slice(5, 7)) / 3) - 1)) }
  if (source === 'buildingRegister' || source === 'buildingPermit') return { platGbCd: '0' }
  if (source === 'restaurant') return {}
  return { category: 'service', startDate: shiftDate(today, -6), endDate: today, orderStartMonth: month, orderEndMonth: month }
}

export function SalesSourceLookup({ onOpportunity }: { onOpportunity: (draft: SalesDraft) => void }) {
  const { api, me } = useApp()
  const [source, setSource] = useState(sources[0])
  const [values, setValues] = useState<LookupValues>(() => defaults(sources[0].id))
  const [result, setResult] = useState<SalesLookupResult | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  useEffect(() => registerDraftNavigation(window, () => ({ dirty: false, busy: busyRef.current }), () => true), [])
  const status = useAsync(() => api.salesLookupStatus(), [api], {})
  const sample = isSampleLookup(source.id)
  const limit = source.id === 'bizinfo' ? 10 : source.id === 'contractProcess' ? 1 : 20
  const size = source.id === 'bizinfo' ? 25 : ['preSpec', 'orderPlan', 'award', 'contract'].includes(source.id) ? 20 : 15
  const search = async (requestedPage: number) => {
    if (busyRef.current) return
    const params: LookupValues = Object.fromEntries(source.fields.map(({ key }) => [key, values[key] ?? ''] as const).filter(([, value]) => value !== ''))
    for (const key of ['longitude', 'latitude', 'radius']) if (key in params) params[key] = Number(params[key])
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      setResult(await api.searchSalesSources(source.id, { ...params, page: requestedPage, ...(sample ? { sample: true } : {}) }))
      setPage(requestedPage)
    } catch (e) { setError(friendlyError(e)) }
    finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const selectSource = (id: string) => {
    const selected = sources.find(item => item.id === id)
    if (!selected || busyRef.current) return
    setSource(selected)
    setValues(defaults(selected.id))
    setResult(null)
    setError('')
    setPage(1)
  }
  const openDraft = (row: SalesLookupRow) => {
    const government = source.id === 'preSpec' || source.id === 'orderPlan'
    const draft = newSalesDraft(me.id)
    draft.title = row.title.slice(0, 160)
    draft.division = values.category === 'construction' ? 'AR' : 'TW'
    draft.source = government ? '나라장터' : '직접 발굴'
    draft.source_url = typeof row.url === 'string' && safeWebUrl(row.url) ? row.url.slice(0, 2000) : ''
    draft.next_date = todayKey()
    draft.next_action = government ? '원문과 본공고 일정 확인, 과업 범위·자격 검토' : '공식 공지·문의처 확인 후 미발주 업무 검토'
    draft.description = [
      `조회 출처 · ${source.label}`,
      ...(row.id ? [`원본 식별번호 · ${row.id}`] : []),
      ...row.facts.map(fact => `${fact.label} · ${fact.value}`),
    ].join('\n').slice(0, 10000)
    onOpportunity(draft)
  }

  return <section className="sales-pipeline">
    <h2 className="t-sub">API 자료 조회</h2>
    <p>공고, 모집 정보, 공간 자료를 조회합니다. 영업 후보로 선택한 건은 확인 후 저장하세요.</p>
    {status.error && <p role="alert" className="sales-error">{status.error} <Button kind="outline" onClick={status.reload}>설정 다시 확인</Button></p>}
    <details>
      <summary>API 키 등록 목록</summary>
      <ul>
        {[...sources.map(item => [item.id, item.label, isSampleLookup(item.id) ? '공개 샘플 모드' : '자료 조회 탭'] as const), ...additionalStatus].map(([id, label, usage]) =>
          <li key={id}>{label} · {status.data[id] === true ? '값 등록됨' : status.data[id] === false ? '확인된 값 없음' : '등록 상태 미확인'} · {usage}</li>
        )}
      </ul>
    </details>
    <fieldset className="form-grid sales-fieldset" disabled={busy}>
      <Field label="조회 출처"><select className="select" value={source.id} onChange={e => selectSource(e.target.value)}>{sources.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
      <p className="t-small">{status.loading ? '등록 상태 확인 중' : status.data[source.id] === true ? '키 등록 확인 · 조회 성공 여부는 조회 결과에서 확인' : status.data[source.id] === false ? '서버 키 미등록' : '서버 키 등록 상태 미확인'}</p>
      {source.description && <p className="full sales-notice">{source.description}</p>}
      {source.fields.map(field => <Field key={field.key} label={field.label}>
        {field.options
          ? <select className="select" value={String(values[field.key] ?? '')} onChange={e => {
            setValues(old => ({ ...old, [field.key]: e.target.value }))
            setResult(null)
            setError('')
          }}><option value="" hidden={field.key !== 'region'}>{field.key === 'region' ? '전체' : '선택'}</option>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          : <input className="input" type={field.type ?? 'text'} maxLength={100} placeholder={field.hint} value={String(values[field.key] ?? '')} onChange={e => {
            setValues(old => ({ ...old, [field.key]: e.target.value }))
            setResult(null)
            setError('')
          }} />}
      </Field>)}
    </fieldset>
    <div className="row wrap"><Button onClick={() => search(1)} disabled={busy || api.mode === 'demo' || (!sample && status.data[source.id] === false)}>{busy ? '조회 중…' : sample ? '공개 샘플 조회' : '조회'}</Button></div>
    {error && <p role="alert" className="sales-error">{error}</p>}
    {result && <section className="sales-list" aria-label="API 조회 결과">
      <p role="status">{sample ? '공개 샘플 · ' : ''}{result.rows.length}건 표시{result.total === undefined ? '' : ` · 출처 응답 전체 ${result.total.toLocaleString()}건`}</p>
      {result.note && <p>{result.note}</p>}
      {result.rows.map((row, index) => <article className="sales-activity" key={`${row.id ?? row.title}:${index}`}>
        <strong>{row.title}</strong>
        <dl>{row.facts.map((fact, j) => <div key={j}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
        <div className="row wrap">
          {typeof row.url === 'string' && safeWebUrl(row.url) && <a className="btn btn-outline" href={row.url} target="_blank" rel="noreferrer">출처 보기</a>}
          {source.opportunity && <Button kind="outline" disabled={busy} onClick={() => openDraft(row)}>영업 기회 작성</Button>}
        </div>
      </article>)}
      {!sample && <div className="row wrap sales-pager">
        <Button kind="outline" disabled={busy || page <= 1} onClick={() => search(page - 1)}>이전</Button>
        <span>{page}페이지</span>
        <Button kind="outline" disabled={busy || page >= limit || (typeof result.total === 'number' ? page * size >= result.total : !result.rows.length)} onClick={() => search(page + 1)}>다음</Button>
      </div>}
    </section>}
    {api.mode === 'demo' && <p className="sales-notice">실제 조회는 운영 인트라넷에 로그인한 뒤 이용할 수 있습니다.</p>}
  </section>
}
