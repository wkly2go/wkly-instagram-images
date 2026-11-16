import { useApp, useAsync } from '../lib/app'
import { safeWebUrl } from '../lib/growth'
import { Button } from './ui'

/** 연결 당시 복사된 메모와 별도로, 현재 저장된 후보 원문을 읽는다. */
export function SalesOrigins({ id, inlineSources = false }: { id: string; inlineSources?: boolean }) {
  const { api } = useApp()
  const state = useAsync(() => api.listSalesOrigins(id), [id], [])
  return <section aria-label="연결된 발굴 자료"><h3 className="t-sub">연결된 발굴 자료</h3>
    <p className="t-cap">현재 저장된 후보 자료 · 최대 20건. 외부 원문의 정정·마감은 출처에서 다시 확인하세요.</p>
    {state.loading ? <p role="status">발굴 자료 확인 중…</p> : state.error ? <div role="alert">{state.error} <Button kind="outline" onClick={state.reload}>발굴 자료 다시 확인</Button></div> : !state.data.length ? <p>연결된 후보가 없습니다. 직접 등록한 영업 건은 위 출처와 메모를 확인하세요.</p> : state.data.map(row => {
      const d = row.document
      const deadline = d.deadline && Number.isFinite(Date.parse(d.deadline)) ? new Date(d.deadline).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미등록'
      return <article className="sales-origin" key={row.id}>
        <h4>{row.title}</h4><p>{row.kind === 'tender' ? '나라장터 공고' : '민간 영업 후보'} · {row.status}</p>
        <dl>{row.kind === 'tender' ? <><dt>공고번호·차수</dt><dd>{d.number} / {d.round}</dd><dt>발주처</dt><dd>{d.agency || '미확인'}</dd><dt>가장 이른 필수 마감 (한국 시간)</dt><dd>{deadline}</dd><dt>참가 조건 검토</dt><dd>{d.qualification || '추가 확인'}</dd><dt>검토 근거</dt><dd className="sales-copy">{d.evidence || '미등록'}</dd></> : <><dt>브랜드·담당자</dt><dd>{d.brand || '미확인'} · {d.name || '미확인'}</dd><dt>공개 연락 창구</dt><dd>{[d.email, d.instagram].filter(Boolean).join(' · ') || '미확인'}</dd></>}</dl>
        {inlineSources && d.source_url && <p className="sales-copy">출처 · {d.source_url}</p>}
        {!inlineSources && d.source_url && safeWebUrl(d.source_url) && <a className="btn btn-outline" href={d.source_url} target="_blank" rel="noopener noreferrer">발굴 자료 출처 열기</a>}
        {d.note && <details open={inlineSources || undefined}><summary>조사 메모·세부 마감 보기</summary><p className="sales-copy">{d.note}</p></details>}
      </article>
    })}
  </section>
}
