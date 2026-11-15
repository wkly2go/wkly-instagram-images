// Proposal step: left table of contents with per-section status, body + sourced figures, 16:9 slide preview,
// PDF print and SVG export for Figma (Figma imports SVG as editable layers). Figures without a source are flagged, never guessed.
import { useEffect, useMemo, useRef, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { Badge, Button, Empty, Field } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import type { DesignProject, ProposalFigure, ProposalSection, ProposalTemplateSection } from '../lib/design'

const SW = 1920, SH = 1080
const STATUS = { draft: '초안', checked: '확인', blank: '빈칸' } as const
const wrap = (text: string, n: number) => text.split('\n').flatMap(line => { const out: string[] = []; let s = line; while (s.length > n) { out.push(s.slice(0, n)); s = s.slice(n) } out.push(s); return out })

function Slide({ project, index, total, title, sec }: { project: DesignProject; index: number; total: number; title: string; sec: ProposalSection | undefined }) {
  const lines = wrap(sec?.body ?? '', 52).slice(0, 14), figs = (sec?.figures ?? []).slice(0, 6)
  return (
    <svg className="design-slide" viewBox={`0 0 ${SW} ${SH}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={title} fontFamily="Pretendard, 'Noto Sans KR', sans-serif">
      <rect width={SW} height={SH} fill="#fff" />
      <text x={96} y={92} fontSize={24} fill="#555">{project.name}</text>
      <text x={SW - 96} y={92} fontSize={24} fill="#555" textAnchor="end">ARTERIOR · {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</text>
      <line x1={96} y1={116} x2={SW - 96} y2={116} stroke="#111" strokeWidth={2} />
      <text x={96} y={220} fontSize={72} fontWeight={800}>{title}</text>
      {lines.map((l, i) => <text key={i} x={96} y={320 + i * 46} fontSize={30} fill="#222">{l}</text>)}
      {!lines.join('').trim() && <text x={96} y={320} fontSize={30} fill="#c0392b">내용이 비어 있습니다.</text>}
      {figs.map((f, i) => <g key={i} transform={`translate(${1180 + (i % 2) * 330}, ${300 + Math.floor(i / 2) * 210})`}>
        <rect width={300} height={180} fill="#f4f4f1" />
        <text x={24} y={48} fontSize={22} fill="#555">{f.label.slice(0, 16)}</text>
        <text x={24} y={112} fontSize={48} fontWeight={800}>{`${f.value}${f.unit ?? ''}`.slice(0, 11)}</text>
        <text x={24} y={152} fontSize={16} fill={f.source ? '#555' : '#c0392b'}>{f.source ? `${f.source.slice(0, 24)}${f.as_of ? ` · ${f.as_of}` : ''}` : '출처 없음 — 확인 필요'}</text>
      </g>)}
      <text x={96} y={SH - 56} fontSize={18} fill="#777">주식회사 아트리어디자인스튜디오 · www.thewklyn.com</text>
    </svg>
  )
}

export function DesignProposal({ project }: { project: DesignProject }) {
  const { api, version, toast } = useApp()
  const { run, busy } = useAction()
  const { data: tpl } = useAsync(() => api.getProposalTemplate(project.space_type), [project.space_type], [] as ProposalTemplateSection[])
  const { data: secs } = useAsync(() => api.listProposalSections(project.id), [project.id, version], [] as ProposalSection[])
  const [key, setKey] = useState<string | null>(null)
  const cur = tpl.find(t => t.key === key) ?? tpl[0]
  const sec = secs.find(s => s.section_key === cur?.key)
  const [body, setBody] = useState('')
  const [figs, setFigs] = useState<ProposalFigure[]>([])
  useEffect(() => { setBody(sec?.body ?? ''); setFigs(sec?.figures ?? []) }, [cur?.key, sec?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useRef<HTMLDivElement>(null)
  const done = useMemo(() => tpl.filter(t => secs.find(s => s.section_key === t.key)?.status === 'checked').length, [tpl, secs])
  const unsourced = figs.filter(f => f.value && !f.source.trim()).length
  const save = (status?: ProposalSection['status']) => cur && run(() => api.saveProposalSection(project.id, cur.key, { body, figures: figs.filter(f => f.label.trim() || f.value.trim()), status: status ?? (sec?.status === 'checked' ? 'draft' : sec?.status ?? 'draft') }), status === 'checked' ? '확인으로 표시했습니다' : '저장했습니다')
  const svgs = () => [...(all.current?.querySelectorAll('svg') ?? [])].map(s => new XMLSerializer().serializeToString(s))
  const figma = () => {
    const files: Record<string, Uint8Array> = {}
    svgs().forEach((s, i) => { files[`${String(i + 1).padStart(2, '0')}_${tpl[i]?.title ?? 'slide'}.svg`] = strToU8(s) })
    const url = URL.createObjectURL(new Blob([zipSync(files)], { type: 'application/zip' }))
    const a = document.createElement('a'); a.href = url; a.download = `제안서_${project.code ?? ''}_피그마용.zip`; document.body.appendChild(a); a.click(); a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  const print = () => {
    const win = window.open('', '_blank')
    if (!win) { toast('인쇄 창을 열지 못했습니다. 팝업 차단을 풀어 주세요'); return }
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${project.code ?? ''} 제안서</title><style>@page{size:338.67mm 190.5mm;margin:0}body{margin:0}svg{display:block;width:338.67mm;height:190.5mm;page-break-after:always}</style></head><body>${svgs().join('')}</body></html>`)
    win.document.close(); window.setTimeout(() => win.print(), 500)
  }
  if (!tpl.length) return <Empty>제안서 틀을 불러오는 중이거나 아직 없습니다.</Empty>
  return (
    <div className="design-block">
      <div className="design-plan-bar">
        <b className="t-bodyb">제안서 · 확인 {done}/{tpl.length}</b>
        <span className="design-gap" />
        <Button size="sm" kind="outline" onClick={figma}>피그마용 내보내기 (SVG 묶음)</Button>
        <Button size="sm" onClick={print}>PDF로 인쇄 (16:9)</Button>
      </div>
      <div className="design-draw">
        <ol className="design-draw-list" aria-label="제안서 목차">
          {tpl.map((t, i) => { const s = secs.find(x => x.section_key === t.key); return <li key={t.key}><button type="button" className={t.key === cur.key ? 'on' : ''} aria-current={t.key === cur.key ? 'true' : undefined} onClick={() => setKey(t.key)}><b>{String(i + 1).padStart(2, '0')}</b><span>{t.title}</span><small>{s ? STATUS[s.status] : '시작 전'}</small></button></li> })}
        </ol>
        <div className="design-block">
          <div className="row wrap"><b className="t-title">{cur.title}</b>{sec ? <Badge tone={sec.status === 'checked' ? 'blue' : 'outline'}>{STATUS[sec.status]}</Badge> : <Badge>시작 전</Badge>}
            {cur.sources?.length ? <span className="t-cap">참고할 자료: {cur.sources.join(', ')}</span> : null}</div>
          <Field label="본문"><textarea className="textarea" rows={7} value={body} onChange={e => setBody(e.target.value)} placeholder="이 항목의 내용을 적으세요. 슬라이드에는 앞 14줄까지 들어갑니다." /></Field>
          <div className="design-figs" aria-label="수치">
            <b className="t-cap">수치 (출처와 기준 시점을 함께 적습니다 · 출처가 없으면 슬라이드에 빨갛게 표시)</b>
            {figs.map((f, i) => <div className="design-add" key={i}>
              {(['label', 'value', 'unit', 'source', 'as_of'] as const).map(k => <input key={k} className={`input${k === 'unit' ? ' design-qty' : ''}`} value={f[k] ?? ''} placeholder={{ label: '항목', value: '값', unit: '단위', source: '출처', as_of: '기준 시점' }[k]} aria-label={{ label: '항목', value: '값', unit: '단위', source: '출처', as_of: '기준 시점' }[k]}
                onChange={e => setFigs(figs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
              <Button size="sm" kind="ghost" onClick={() => setFigs(figs.filter((_, j) => j !== i))}>지우기</Button>
            </div>)}
            <div className="row"><Button size="sm" kind="outline" onClick={() => setFigs([...figs, { label: '', value: '', unit: '', source: '', as_of: '' }])}>수치 추가</Button>{unsourced > 0 && <span className="design-warn">출처 없는 수치 {unsourced}개</span>}</div>
          </div>
          <div className="row wrap">
            <Button disabled={busy} onClick={() => save()}>저장</Button>
            <Button kind="outline" disabled={busy || unsourced > 0 || !body.trim()} title={unsourced ? '출처 없는 수치가 있으면 확인으로 표시할 수 없습니다' : ''} onClick={() => save('checked')}>확인으로 표시</Button>
            <Button kind="ghost" disabled={busy} onClick={() => save('blank')}>이 항목은 빈칸으로</Button>
          </div>
          <div className="design-draw-view"><Slide project={project} index={tpl.indexOf(cur)} total={tpl.length} title={cur.title} sec={sec ? { ...sec, body, figures: figs } : { body, figures: figs } as ProposalSection} /></div>
        </div>
      </div>
      <p className="t-cap">'피그마용 내보내기'는 슬라이드마다 SVG 파일을 묶어 줍니다. 피그마에 끌어다 놓으면 글자 · 도형이 편집 가능한 상태로 들어옵니다. '빈칸'으로 둔 항목은 내보낼 때 빠집니다.</p>
      <div ref={all} hidden>{tpl.filter(t => secs.find(s => s.section_key === t.key)?.status !== 'blank').map((t, i, a) => <Slide key={t.key} project={project} index={i} total={a.length} title={t.title} sec={t.key === cur.key ? { ...(sec ?? {} as ProposalSection), body, figures: figs } : secs.find(s => s.section_key === t.key)} />)}</div>
    </div>
  )
}
