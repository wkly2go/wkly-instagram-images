// Delivery step: checklist of deliverables per the learned standard (drawings PDF + CAD, spec books, estimate, proposal, design report),
// each row shows what exists and where to produce it. Design report = A4 print compiled from data already in the project (no new numbers).
import { useRef } from 'react'
import { Badge, Button } from './ui'
import { useApp, useAsync } from '../lib/app'
import { useRouter, withQuery } from '../lib/router'
import { DOC_LABELS, SPACE_LABELS, SPEC_BOOKS, type DesignBase, type DesignProject, type SpecBook } from '../lib/design'
import { floorArea, type PlanGeometry } from '../lib/designPlan'
import { sheetList } from '../lib/designDrawings'

const won = (v: string | undefined) => (v ? `${Number(v).toLocaleString('ko-KR')}원` : '')

export function DesignDelivery({ project, base }: { project: DesignProject; base: DesignBase }) {
  const { api, version, toast } = useApp()
  const { query, navigate } = useRouter()
  const { data: renders } = useAsync(() => api.listRenders(project.id), [project.id, version], [])
  const { data: plan } = useAsync(() => api.getDesignPlan(project.id), [project.id, version], null as PlanGeometry | null)
  const { data: docs } = useAsync(() => api.listDesignDocuments(project.id), [project.id, version], [])
  const { data: specs } = useAsync(() => api.listSpecItems(project.id), [project.id, version], [])
  const { data: props } = useAsync(() => api.listProposalSections(project.id), [project.id, version], [])
  const { data: tpl } = useAsync(() => api.getProposalTemplate(project.space_type), [project.space_type], [])
  const { data: estimates } = useAsync(() => api.listEstimates(project.id), [project.id, version], [])
  const { data: tasks } = useAsync(() => api.listScheduleTasks(project.id), [project.id, version], [])
  const { data: rows } = useAsync(() => api.listPlacements(project.id, project.model_version), [project.id, project.model_version, version], [])
  const report = useRef<HTMLDivElement>(null)
  const est = estimates.find(e => e.variant === 'standard')
  const liveSpecs = specs.filter(s => s.status !== 'dropped')
  const sheets = plan ? sheetList(plan).length : 0
  const area = plan ? floorArea(plan.walls.filter(w => w.kind === 'existing')) : null
  const go = (view: string) => navigate(withQuery('/design', query, { view }))
  const latest = (kind: string) => docs.find(d => d.kind === kind)
  const items: { name: string; ready: boolean; state: string; view: string; action: string }[] = [
    { name: '도면 세트 (A3 PDF) · 캐드 파일 (DXF)', ready: sheets > 3, state: sheets > 3 ? `${sheets}장 만들 수 있음` : '평면이 아직 없음', view: 'drawings', action: '도면에서 인쇄 · 내려받기' },
    { name: '스펙북', ready: liveSpecs.length > 0 && liveSpecs.every(s => s.status === 'confirmed'), state: liveSpecs.length ? `${liveSpecs.filter(s => s.status === 'confirmed').length}/${liveSpecs.length} 확정` : '항목 없음', view: 'spec', action: '스펙북에서 인쇄' },
    { name: '견적서 (제출용 PDF · 엑셀)', ready: !!latest('estimate_deck'), state: est ? `${est.revision}차 · 공급가액 ${won(est.totals.supply)}` : '견적 없음', view: 'estimate', action: '견적에서 내려받기' },
    { name: '제안서 (PDF · 피그마용)', ready: tpl.length > 0 && tpl.every(t => props.find(p => p.section_key === t.key && p.status !== 'draft')), state: `${props.filter(p => p.status === 'checked').length}/${tpl.length} 확인`, view: 'proposal', action: '제안서에서 내보내기' },
    { name: '공정표', ready: tasks.length > 0, state: tasks.length ? `${tasks.length}개 공정` : '공정 없음', view: 'schedule', action: '공정 보기' },
  ]
  const print = () => {
    const win = window.open('', '_blank')
    if (!win || !report.current) { toast('인쇄 창을 열지 못했습니다. 팝업 차단을 풀어 주세요'); return }
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${project.code ?? ''} 설계 보고서</title><style>@page{size:A4;margin:16mm}body{font-family:'Pretendard','Noto Sans KR',sans-serif;font-size:10pt;color:#111;line-height:1.6}h1{font-size:20pt;margin:0}h2{font-size:12pt;margin:8mm 0 2mm;border-left:3pt solid #111;padding-left:2mm}table{width:100%;border-collapse:collapse;font-size:9pt}th,td{border:0.4pt solid #999;padding:1.5mm 2mm;text-align:left}th{background:#eee;width:28%}p{margin:0 0 2mm;white-space:pre-wrap}.sub{color:#555}.miss{color:#c0392b}</style></head><body>${report.current.innerHTML}</body></html>`)
    win.document.close(); window.setTimeout(() => win.print(), 400)
  }
  const tname = (c: string) => base.trades.find(t => t.code === c)?.name ?? c
  const trades = [...new Set(rows.map(r => r.trade_code))]
  return (
    <div className="design-block">
      <div className="design-plan-bar"><b className="t-bodyb">납품 묶음 · 준비 {items.filter(i => i.ready).length}/{items.length}</b><span className="design-gap" /><Button size="sm" onClick={print}>설계 보고서 PDF로 인쇄</Button></div>
      <ul className="design-cards">{items.map(i => (
        <li key={i.name}><div className="row wrap"><Badge tone={i.ready ? 'blue' : 'outline'}>{i.ready ? '준비됨' : '미완'}</Badge><b>{i.name}</b><span className="t-cap">{i.state}</span><span className="design-right"><Button size="sm" kind="outline" onClick={() => go(i.view)}>{i.action}</Button></span></div></li>))}
      </ul>
      {docs.length > 0 && <><b className="t-cap">보관된 파일 (최근 것부터)</b><ul className="design-files">{docs.slice(0, 8).map(d => <li key={d.id}><b>{DOC_LABELS[d.kind] ?? d.kind}</b> <span className="t-cap">{d.version}차 · {d.created_at.slice(0, 10)}</span></li>)}</ul></>}
      <p className="t-cap">납품 기준은 표본(유니셈) 납품 구성입니다: 도면 합본 PDF + 캐드 파일, 스펙북, 공사비 내역, 디자인 보고서. 밖으로 보내는 것은 사람이 내려받아 직접 보냅니다. 투시도(렌더)는 스케치업 · Enscape 에서 만들어 따로 넣습니다.</p>
      <div ref={report} hidden>
        <h1>{project.name}</h1><p className="sub">설계 보고서 · {[project.code, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · ')} · 주식회사 아트리어디자인스튜디오</p>
        <h2>1. 프로젝트 개요</h2>
        <table><tbody>
          <tr><th>발주처</th><td>{project.client_name ?? ''}</td></tr><tr><th>위치</th><td>{project.address ?? ''}</td></tr>
          <tr><th>공간 종류</th><td>{SPACE_LABELS[project.space_type]}</td></tr>
          <tr><th>면적</th><td>{project.area_m2 != null ? `${project.area_m2}㎡` : area != null ? `${area}㎡ (평면에서 계산 · 확인 필요)` : <span className="miss">미입력</span>}</td></tr>
          <tr><th>기간</th><td>{[project.start_date, project.end_date].filter(Boolean).join(' ~ ')}</td></tr>
        </tbody></table>
        {renders.some(r => r.status === 'final' && r.data) && <><h2>투시도</h2><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm' }}>{renders.filter(r => r.status === 'final' && r.data).map(r => <figure key={r.id} style={{ margin: 0, breakInside: 'avoid' }}><img src={r.data!} alt="" style={{ width: '100%' }} /><figcaption>{r.no} {r.title}</figcaption></figure>)}</div></>}
        <h2>2. 기획 · 디자인 방향</h2>
        {tpl.filter(t => props.find(p => p.section_key === t.key && p.status !== 'blank' && p.body?.trim())).map(t => <div key={t.key}><p><b>{t.title}</b></p><p>{props.find(p => p.section_key === t.key)!.body}</p></div>)}
        {!props.some(p => p.body?.trim()) && <p className="miss">제안서 본문이 아직 없습니다.</p>}
        <h2>3. 공사 범위</h2>
        <table><tbody>{trades.map(t => <tr key={t}><th>{tname(t)}</th><td>{rows.filter(r => r.trade_code === t).map(r => r.item).join(', ')}</td></tr>)}</tbody></table>
        <h2>4. 주요 마감 · 스펙</h2>
        {(Object.keys(SPEC_BOOKS) as SpecBook[]).filter(k => liveSpecs.some(s => s.book === k)).map(k => <p key={k}><b>{SPEC_BOOKS[k]}</b>: {liveSpecs.filter(s => s.book === k).map(s => [s.code, s.name].filter(Boolean).join(' ')).join(', ')}</p>)}
        {!liveSpecs.length && <p className="miss">스펙북 항목이 아직 없습니다.</p>}
        <h2>5. 도면 · 공정</h2>
        <p>도면 {sheets}장 (A3). 공정 {tasks.length}개{tasks.length ? ` · ${tasks[0].start_date} ~ ${tasks[tasks.length - 1].end_date}` : ''}.</p>
        <h2>6. 공사비</h2>
        {est ? <table><tbody><tr><th>견적 차수</th><td>{est.revision}차</td></tr><tr><th>직접 공사비</th><td>{won(est.totals.direct)}</td></tr><tr><th>공급가액 (부가세 별도)</th><td>{won(est.totals.supply)}</td></tr><tr><th>부가세 포함</th><td>{won(est.totals.total)}</td></tr></tbody></table> : <p className="miss">견적이 아직 없습니다.</p>}
      </div>
    </div>
  )
}
