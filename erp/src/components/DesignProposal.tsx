// Proposal step: left table of contents with per-section status, body + sourced figures, 16:9 slide preview,
// PDF print and SVG export for Figma (Figma imports SVG as editable layers). Figures without a source are flagged, never guessed.
import { useEffect, useMemo, useRef, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { Badge, Button, Empty, Field } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import type { DesignProject, DesignRender, ProposalFigure, ProposalQuote, ProposalSection, ProposalTemplateSection } from '../lib/design'

const SW = 1920, SH = 1080
const STATUS = { draft: '초안', checked: '확인', blank: '빈칸' } as const
// Slide styling follows the ARTERIOR Proposal Design System (Figma '00 · Design System'): 1920×1080, side margin 80,
// black/white + one blue accent, header y40, title block y110 (serif eyebrow → H1 60 → lead 26), body y300–1000 in two 860 columns.
const WKLY = { source: 'THE WKLY 인사이트', url: 'https://www.thewklyn.com' }
const T = { tint: '#E8EEF8', ink: '#121212', sub: '#5E5E5E', mute: '#9A9A9A', line: '#D9D9D9', panel: '#F3F3F3', blue: '#2456AB', warn: '#C0392B' }
const SANS = "Pretendard, Inter, 'Noto Sans KR', sans-serif", SERIF = "'Noto Serif KR', Georgia, 'Times New Roman', serif"
const M = 80, COL = 860, COL2 = M + COL + 40, ROWS = 20
const wrap = (text: string, n: number) => text.split('\n').flatMap(line => { const out: string[] = []; let s = line; while (s.length > n) { out.push(s.slice(0, n)); s = s.slice(n) } out.push(s); return out })
const Logo = ({ fill }: { fill: string }) => <text x={SW - M} y={SH - 44} fontSize={22} fontWeight={700} letterSpacing={6} fill={fill} textAnchor="end">ARTERIOR</text>

type SlideProps = { project: DesignProject; index: number; total: number; title: string; eyebrow?: string; sec?: ProposalSection; kind?: 'cover' | 'content' | 'closing' | 'render'; image?: string | null }
function Slide({ project, index, total, title, eyebrow, sec, kind = 'content', image }: SlideProps) {
  const svg = { className: 'design-slide', viewBox: `0 0 ${SW} ${SH}`, xmlns: 'http://www.w3.org/2000/svg', role: 'img', 'aria-label': title, fontFamily: SANS }
  if (kind === 'render') return (
    <svg {...svg}>
      <rect width={SW} height={SH} fill="#fff" />
      <text x={M} y={56} fontSize={18} fill={T.sub}>{project.name.slice(0, 40)}</text>
      <text x={SW - M} y={56} fontSize={18} fill={T.sub} textAnchor="end">ARTERIOR  |  PERSPECTIVE {eyebrow}</text>
      {image ? <image href={image} x={M} y={96} width={SW - M * 2} height={860} preserveAspectRatio="xMidYMid slice" /> : <rect x={M} y={96} width={SW - M * 2} height={860} fill={T.panel} />}
      <text x={M} y={SH - 44} fontSize={26} fontWeight={700} fill={T.ink}>{title.slice(0, 50)}</text>
      <Logo fill={T.ink} />
    </svg>
  )
  if (kind !== 'content') return (
    <svg {...svg}>
      <rect width={SW} height={SH} fill="#fff" />
      <text x={M} y={72} fontSize={18} fill={T.mute} letterSpacing={2}>{project.code ?? ''}</text>
      <text x={SW - M} y={72} fontSize={18} fill={T.mute} textAnchor="end">{new Date().toISOString().slice(0, 7).replace('-', '.')}</text>
      <text x={M} y={470} fontSize={64} fontWeight={300} letterSpacing={8} fill={T.ink}>{kind === 'cover' ? 'PROPOSAL' : 'THANK YOU'}</text>
      <rect x={M} y={510} width={96} height={4} fill={T.blue} />
      <text x={M} y={610} fontSize={60} fontWeight={700} fill={T.ink}>{kind === 'cover' ? project.name.slice(0, 28) : '감사합니다'}</text>
      <text x={M} y={672} fontSize={26} fill={T.sub}>{kind === 'cover' ? [project.client_name, project.address].filter(Boolean).join(' · ').slice(0, 60) : '주식회사 아트리어디자인스튜디오 · www.thewklyn.com'}</text>
      <text x={M} y={SH - 44} fontSize={16} fill={T.mute}>주식회사 아트리어디자인스튜디오</text>
      <Logo fill={T.ink} />
    </svg>
  )
  const figs = (sec?.figures ?? []).slice(0, 6)
  const [first = '', ...paras] = (sec?.body ?? '').trim().split('\n'), [lead = '', ...over] = wrap(first, 64), rest = wrap([over.join(''), ...paras].filter((l, i) => i > 0 || l).join('\n'), 41)
  const quote = (sec?.quotes ?? []).find(q => q.text.trim()), rows = quote ? ROWS - 6 : ROWS
  const cols = figs.length ? [rest.slice(0, rows)] : [rest.slice(0, rows), rest.slice(rows, quote ? rows : ROWS * 2)]
  const sources = [...new Set(figs.map(f => f.source.trim()).filter(Boolean))].join(' · ').slice(0, 110)
  return (
    <svg {...svg}>
      <rect width={SW} height={SH} fill="#fff" />
      <text x={M} y={56} fontSize={18} fill={T.sub}>{project.name.slice(0, 40)}</text>
      <text x={SW - M} y={56} fontSize={18} fill={T.sub} textAnchor="end">ARTERIOR  |  {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</text>
      <text x={M} y={132} fontSize={20} fontFamily={SERIF} letterSpacing={3} fill={T.blue}>{`${String(index + 1).padStart(2, '0')} · ${(eyebrow ?? '').replace(/_/g, ' ').toUpperCase()}`}</text>
      <text x={M} y={206} fontSize={60} fontWeight={700} fill={T.ink}>{title.slice(0, 28)}</text>
      {lead ? <text x={M} y={262} fontSize={26} fill={T.sub}>{lead}</text> : <text x={M} y={262} fontSize={26} fill={T.warn}>내용이 비어 있습니다.</text>}
      <line x1={M} y1={292} x2={SW - M} y2={292} stroke={T.ink} strokeWidth={1} />
      {cols.map((c, k) => c.map((l, i) => <text key={`${k}-${i}`} x={k ? COL2 : M} y={344 + i * 33} fontSize={20} fill={T.ink}>{l}</text>))}
      {figs.map((f, i) => <g key={i} transform={`translate(${COL2 + (i % 2) * 450}, ${324 + Math.floor(i / 2) * 224})`}>
        <rect width={410} height={196} fill={T.panel} />
        <rect width={410} height={2} fill={T.ink} />
        <text x={28} y={52} fontSize={20} fill={T.sub}>{f.label.slice(0, 18)}</text>
        <text x={28} y={128} fontSize={`${f.value}${f.unit ?? ''}`.length > 8 ? 44 : 64} fontWeight={700} fill={T.blue}>{`${f.value}${f.unit ?? ''}`.slice(0, 13)}</text>
        <text x={28} y={168} fontSize={16} fill={f.source ? T.mute : T.warn}>{f.source ? `${f.source.slice(0, 26)}${f.as_of ? ` · ${f.as_of}` : ''}` : '출처 없음 — 확인 필요'}</text>
      </g>)}
      {quote && <g>
        <rect x={M} y={812} width={COL} height={164} fill={T.tint} /><rect x={M} y={812} width={6} height={164} fill={T.blue} />
        {wrap(quote.text.trim(), 36).slice(0, 3).map((l, i) => <text key={i} x={M + 34} y={858 + i * 34} fontSize={24} fontWeight={700} fill={T.ink}>{l}</text>)}
        <text x={M + 34} y={958} fontSize={16} fill={T.blue}>{`${quote.source}${quote.url ? ` · ${quote.url.replace(/^https?:\/\//, '')}` : ''}`.slice(0, 70)}</text>
      </g>}
      <line x1={M} y1={SH - 84} x2={SW - M} y2={SH - 84} stroke={T.line} strokeWidth={1} />
      <text x={M} y={SH - 44} fontSize={16} fill={T.mute}>{sources ? `출처: ${sources}` : '주식회사 아트리어디자인스튜디오 · www.thewklyn.com'}</text>
      <Logo fill={T.ink} />
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
  const [quote, setQuote] = useState<ProposalQuote>({ text: '', ...WKLY })
  const { data: renders } = useAsync(() => api.listRenders(project.id), [project.id, version], [] as DesignRender[])
  const finals = renders.filter(r => r.status === 'final')
  const [rq, setRq] = useState('')
  const { data: research } = useAsync(() => (rq.trim().length >= 2 ? api.listResearch() : Promise.resolve([])), [rq.trim().length >= 2], [] as Awaited<ReturnType<typeof api.listResearch>>)
  const hits = rq.trim().length >= 2 ? research.filter(r => `${r.title} ${r.summary ?? ''} ${r.tags.join(' ')}`.toLowerCase().includes(rq.trim().toLowerCase())).slice(0, 6) : []
  const quotes = quote.text.trim() ? [{ ...quote, text: quote.text.trim() }] : []
  useEffect(() => { setBody(sec?.body ?? ''); setFigs(sec?.figures ?? []); setQuote(sec?.quotes?.[0] ?? { text: '', ...WKLY }) }, [cur?.key, sec?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useRef<HTMLDivElement>(null)
  const done = useMemo(() => tpl.filter(t => secs.find(s => s.section_key === t.key)?.status === 'checked').length, [tpl, secs])
  const unsourced = figs.filter(f => f.value && !f.source.trim()).length
  const save = (status?: ProposalSection['status']) => cur && run(() => api.saveProposalSection(project.id, cur.key, { body, quotes, figures: figs.filter(f => f.label.trim() || f.value.trim()), status: status ?? (sec?.status === 'checked' ? 'draft' : sec?.status ?? 'draft') }), status === 'checked' ? '확인으로 표시했습니다' : '저장했습니다')
  const svgs = () => [...(all.current?.querySelectorAll('svg') ?? [])].map(s => new XMLSerializer().serializeToString(s))
  const figma = () => {
    const files: Record<string, Uint8Array> = {}
    const names = [...(all.current?.querySelectorAll('svg') ?? [])].map(e => e.getAttribute('aria-label') ?? 'slide')
    svgs().forEach((s, i) => { files[`${String(i + 1).padStart(2, '0')}_${names[i].replace(/[\\/:*?"<>|]/g, ' ')}.svg`] = strToU8(s) })
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
          <Field label="본문"><textarea className="textarea" rows={7} value={body} onChange={e => setBody(e.target.value)} placeholder="이 항목의 내용을 적으세요. 슬라이드에는 첫 줄은 머리 문장으로, 나머지는 20줄(수치가 없으면 두 단 40줄)까지 들어갑니다." /></Field>
          <div className="design-figs" aria-label="수치">
            <b className="t-cap">수치 (출처와 기준 시점을 함께 적습니다 · 출처가 없으면 슬라이드에 빨갛게 표시)</b>
            {figs.map((f, i) => <div className="design-add" key={i}>
              {(['label', 'value', 'unit', 'source', 'as_of'] as const).map(k => <input key={k} className={`input${k === 'unit' ? ' design-qty' : ''}`} value={f[k] ?? ''} placeholder={{ label: '항목', value: '값', unit: '단위', source: '출처', as_of: '기준 시점' }[k]} aria-label={{ label: '항목', value: '값', unit: '단위', source: '출처', as_of: '기준 시점' }[k]}
                onChange={e => setFigs(figs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
              <Button size="sm" kind="ghost" onClick={() => setFigs(figs.filter((_, j) => j !== i))}>지우기</Button>
            </div>)}
            <div className="row"><Button size="sm" kind="outline" onClick={() => setFigs([...figs, { label: '', value: '', unit: '', source: '', as_of: '' }])}>수치 추가</Button>{unsourced > 0 && <span className="design-warn">출처 없는 수치 {unsourced}개</span>}</div>
          </div>
          <div className="design-figs" aria-label="인사이트 인용">
            <b className="t-cap">인사이트 인용 (더위클리 홈페이지 인사이트 등 · 실제 글의 문장과 주소를 적습니다 · 슬라이드 왼쪽 아래 강조 칸)</b>
            <div className="design-add">
              <input className="input" value={quote.text} onChange={e => setQuote({ ...quote, text: e.target.value })} placeholder="인용할 문장 (없으면 비워 둠)" aria-label="인용 문장" />
              <input className="input" value={quote.source} onChange={e => setQuote({ ...quote, source: e.target.value })} placeholder="출처" aria-label="인용 출처" />
              <input className="input" type="url" value={quote.url ?? ''} onChange={e => setQuote({ ...quote, url: e.target.value })} placeholder="글 주소" aria-label="인용 글 주소" />
            </div>
            <div className="design-add">
              <input className="input" type="search" value={rq} onChange={e => setRq(e.target.value)} placeholder="인트라넷 리서치 자료에서 찾아 인용 (2글자 이상)" aria-label="리서치 자료 찾기" />
              {hits.map(r => <button type="button" key={r.id} className="chip" title={r.summary ?? ''} onClick={() => { setQuote({ text: (r.summary ?? r.title).split('\n')[0].slice(0, 108), source: r.source_name ?? '더위클리 리서치 자료', url: r.source_url ?? '' }); setRq('') }}>+ {r.title.slice(0, 28)}</button>)}
            </div>
          </div>
          <div className="row wrap">
            <Button disabled={busy} onClick={() => save()}>저장</Button>
            <Button kind="outline" disabled={busy || unsourced > 0 || !body.trim()} title={unsourced ? '출처 없는 수치가 있으면 확인으로 표시할 수 없습니다' : ''} onClick={() => save('checked')}>확인으로 표시</Button>
            <Button kind="ghost" disabled={busy} onClick={() => save('blank')}>이 항목은 빈칸으로</Button>
          </div>
          <div className="design-draw-view"><Slide project={project} index={tpl.indexOf(cur)} total={tpl.length} title={cur.title} eyebrow={cur.key} sec={sec ? { ...sec, body, figures: figs, quotes } : { body, figures: figs, quotes } as ProposalSection} /></div>
        </div>
      </div>
      <p className="t-cap">'피그마용 내보내기'는 슬라이드마다 SVG 파일을 묶어 줍니다. 피그마에 끌어다 놓으면 글자 · 도형이 편집 가능한 상태로 들어옵니다. '빈칸'으로 둔 항목은 내보낼 때 빠지고, 표지 · 맺음 장이 앞뒤에 붙고, '평면 · 3D'에서 확정한 투시도 장면이 맺음 장 앞에 한 장씩 들어갑니다. 디자인은 아트리어 제안서 디자인 시스템(피그마)을 따릅니다.</p>
      <div ref={all} hidden>
        <Slide kind="cover" project={project} index={0} total={0} title="표지" />
        {tpl.filter(t => secs.find(s => s.section_key === t.key)?.status !== 'blank').map((t, i, a) => <Slide key={t.key} project={project} index={i} total={a.length} title={t.title} eyebrow={t.key} sec={t.key === cur.key ? { ...(sec ?? {} as ProposalSection), body, figures: figs, quotes } : secs.find(s => s.section_key === t.key)} />)}
        {finals.map(r => <Slide key={r.id} kind="render" project={project} index={0} total={0} title={r.title} eyebrow={r.no} image={r.data} />)}
        <Slide kind="closing" project={project} index={0} total={0} title="맺음" />
      </div>
    </div>
  )
}
