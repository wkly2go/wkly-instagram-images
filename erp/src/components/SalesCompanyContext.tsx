import { useId, useState, type ReactNode } from 'react'
import { useApp, useAsync } from '../lib/app'
import { COMPANY_CONTEXT_PAGES, COMPANY_CONTEXT_PAGE_SIZE, type CompanyContextPages, type CompanyRecordPage, type SalesCompanyContext as CompanyContext } from '../lib/salesCompanyContext'
import { ReportBody } from './Reports'
import { Button } from './ui'

const date = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

function RecordGroup<T extends {id: string}>({ title, records, page, onPage, onRetry, children }: {
  title: string; records: CompanyRecordPage<T>; page: number; onPage: (page: number) => void; onRetry: () => void; children: (row: T) => ReactNode
}) {
  const pages = Math.max(1, Math.ceil((records.total ?? 0) / COMPANY_CONTEXT_PAGE_SIZE))
  return <section className="sales-company-records" aria-label={title}>
    <h4>{title}{records.total !== null && <small> · {records.total}건</small>}</h4>
    {records.error ? <div><p role="alert">{records.error}</p><Button kind="outline" onClick={onRetry}>{title} 다시 불러오기</Button></div> : <>
      {records.items.length ? <ul>{records.items.map(row => <li key={row.id}>{children(row)}</li>)}</ul> : <p className="sales-report-note">{page ? '이 페이지에 자료가 없습니다. 이전 페이지를 확인하세요.' : '이 거래처에 연결되어 조회 가능한 자료가 없습니다.'}</p>}
      {(pages > 1 || page > 0) && <nav className="sales-report-pagination" aria-label={`${title} 페이지`}>
        <Button kind="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>이전</Button><span>{page + 1} / {pages}</span><Button kind="outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>다음</Button>
      </nav>}
    </>}
  </section>
}

function ResearchBody({ id, clientId }: {id: string; clientId: string}) {
  const { api } = useApp()
  const { data, loading, error, reload } = useAsync(async () => {
    const item = await api.getResearch(id)
    if (!item || item.client_id !== clientId) throw new Error('보고서를 찾을 수 없거나 거래처 연결이 변경되었습니다. 회사 자료를 다시 불러와 주세요.')
    return item
  }, [id, clientId], null)
  return <div className="sales-company-body">{loading ? <p role="status">보고서 본문을 읽고 있습니다…</p> : error ? <><p role="alert">{error}</p><Button kind="outline" onClick={reload}>본문 다시 불러오기</Button></> : data && <>
    <p className="sales-report-note">저장된 보고서 전체 본문 · {date(data.updated_at)} 수정</p>
    {data.body?.trim() ? <ReportBody body={data.body}/> : <p>저장된 보고서 본문이 없습니다.</p>}
  </>}</div>
}

function SalesBody({ id, clientId }: {id: string; clientId: string}) {
  const { api } = useApp()
  const { data, loading, error, reload } = useAsync(async () => {
    const item = await api.getSales(id)
    if (!item || item.client_id !== clientId) throw new Error('영업 기록을 찾을 수 없거나 거래처 연결이 변경되었습니다. 회사 자료를 다시 불러와 주세요.')
    return item
  }, [id, clientId], null)
  return <div className="sales-company-body">{loading ? <p role="status">영업 내용을 읽고 있습니다…</p> : error ? <><p role="alert">{error}</p><Button kind="outline" onClick={reload}>내용 다시 불러오기</Button></> : data && <>
    <p className="sales-report-note">{data.stage} · {date(data.updated_at)} 수정</p>
    <dl className="sales-report-facts"><div><dt>영업 내용</dt><dd>{data.description || '등록된 상세 내용 없음'}</dd></div><div><dt>결과·사유</dt><dd>{data.result_note || '등록된 결과 없음'}</dd></div><div><dt>다음 행동</dt><dd>{data.next_action || '미등록'} · {data.next_date || '일정 미정'}</dd></div></dl>
  </>}</div>
}

function ExpandRecord({ label, children }: {label: string; children: ReactNode}) {
  const [open, setOpen] = useState(false), id = useId()
  return <><Button kind="outline" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{open ? `${label} 접기` : `${label} 펼치기`}</Button><div id={id}>{open && children}</div></>
}

export function SalesCompanyContext({ clientId }: {clientId: string}) {
  const { api, profileName, version } = useApp()
  const [pages, setPages] = useState<CompanyContextPages>({...COMPANY_CONTEXT_PAGES})
  const { data, loading, error, reload } = useAsync<CompanyContext | null>(() => api.getSalesCompanyContext(clientId, pages), [clientId, pages, version], null)
  const group = (key: keyof CompanyContextPages) => ({page: pages[key], onPage: (page: number) => setPages(old => ({...old, [key]: page})), onRetry: reload})
  return <section className="sales-company-context" aria-label="연결된 회사 자료" aria-busy={loading}>
    <header><h3>연결된 회사 자료</h3><Button kind="outline" disabled={loading} onClick={reload}>회사 자료 새로고침</Button></header>
    <p className="sales-report-note">같은 거래처로 연결해 둔 저장 자료입니다. 검증 내용을 작성하면서 이 화면에서 펼쳐 읽을 수 있습니다.</p>
    {loading ? <p role="status">회사 자료를 읽고 있습니다…</p> : error ? <p role="alert" className="sales-report-alert">{error}</p> : !data ? <p>연결된 거래처가 삭제되었거나 조회 권한이 없습니다.</p> : <>
      <h4>{data.company.name} · {data.company.category}</h4>
      <dl className="sales-report-facts"><div><dt>회사 연락처</dt><dd>{[data.company.phone, data.company.email].filter(Boolean).join(' · ') || '등록된 연락처 없음'}</dd></div><div><dt>주소</dt><dd>{data.company.address || '미등록'}</dd></div><div><dt>회사 메모</dt><dd>{data.company.memo || '등록된 메모 없음'}</dd></div></dl>
      <p className="sales-report-note">회사 정보 수정: {date(data.company.updated_at)} · 저장 자료는 현재 발주 여부를 확정하지 않습니다.</p>
      <RecordGroup title="담당자" records={data.contacts} {...group('contacts')}>{row => <>
        <strong>{row.name}{row.is_primary ? ' · 대표 연락처' : ''}</strong><span> {row.title || '직책 미등록'}</span><p>{[row.email, row.phone].filter(Boolean).join(' · ') || '연락처 미등록'}</p>{row.memo && <p className="sales-company-memo">{row.memo}</p>}
      </>}</RecordGroup>
      <RecordGroup title="리서치 보고서" records={data.research} {...group('research')}>{row => <>
        <strong>{row.title}</strong><p className="sales-report-note">{row.kind} · {row.status} · {date(row.updated_at)}</p>{row.summary && <p className="sales-company-memo">{row.summary}</p>}<ExpandRecord label="보고서 전체 본문"><ResearchBody id={row.id} clientId={clientId}/></ExpandRecord>
      </>}</RecordGroup>
      <RecordGroup title="기존 영업 기록" records={data.sales} {...group('sales')}>{row => <>
        <strong>{row.title} · {row.stage}</strong><p className="sales-report-note">담당 {profileName(row.owner_id)} · {date(row.updated_at)} 수정</p><p>다음 행동: {row.next_action || '미등록'} · {row.next_date || '일정 미정'}</p><ExpandRecord label="영업 상세 내용"><SalesBody id={row.id} clientId={clientId}/></ExpandRecord>
      </>}</RecordGroup>
      <RecordGroup title="연결 프로젝트" records={data.projects} {...group('projects')}>{row => <>
        <strong>{row.code ? `${row.code} · ` : ''}{row.name} · {row.status}</strong><p className="sales-report-note">담당 {row.owner_id ? profileName(row.owner_id) : '미지정'} · {row.start_date || '시작 미정'} ~ {row.end_date || '종료 미정'}</p>{row.description && <p className="sales-company-memo">{row.description}</p>}
      </>}</RecordGroup>
    </>}
  </section>
}
