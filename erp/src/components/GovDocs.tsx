// 정부지원사업 › 자료 · 계획 — 사업계획서 가이드 · 선정 사례, 투자유치 계획, 월별 계획, 고도화 일정 (2026-11-19 대표 지시 '모든 요청사항과 지시는 인트라넷에')
// 본문은 운영 DB(gov_docs)에만 있다. 관리자가 그 자리에서 고친다.
import { useEffect, useState } from 'react'
import { Button, Empty, Loading } from './ui'
import { ReportBody } from './Reports'
import { useAction, useApp, useAsync } from '../lib/app'
import type { GovDoc } from '../lib/gov'

export function GovDocs() {
  const { api, version, bump } = useApp()
  const { run, busy } = useAction()
  const { data: docs, loading } = useAsync(() => api.listGovDocs(), [version], [] as GovDoc[])
  const [key, setKey] = useState<string | null>(null)
  const [edit, setEdit] = useState<string | null>(null)
  const doc = docs.find(d => d.key === key) ?? docs[0]
  useEffect(() => setEdit(null), [doc?.key])
  if (loading) return <Loading />
  if (!doc) return <Empty>아직 자료가 없습니다.</Empty>
  return (
    <div className="gov-docs">
      <div className="row wrap" role="tablist" aria-label="자료">
        {docs.map(d => <button type="button" role="tab" aria-selected={d.key === doc.key} key={d.key} className={`chip${d.key === doc.key ? ' active' : ''}`} onClick={() => setKey(d.key)}>{d.title}</button>)}
        <span className="gov-grow" />
        <span className="t-cap">고친 날 {doc.updated_at.slice(0, 10)}</span>
        {edit === null
          ? <Button kind="outline" size="sm" onClick={() => setEdit(doc.body)}>고치기</Button>
          : <><Button size="sm" disabled={busy || edit === doc.body} onClick={() => void run(async () => { await api.saveGovDoc(doc.key, edit); bump(); setEdit(null) }, '저장했습니다')}>저장</Button><Button kind="outline" size="sm" onClick={() => setEdit(null)}>취소</Button></>}
      </div>
      {edit === null
        ? <article className="gov-doc"><ReportBody body={doc.body} /></article>
        : <textarea className="input gov-doc-edit" value={edit} onChange={e => setEdit(e.target.value)} aria-label={`${doc.title} 본문`} />}
    </div>
  )
}
