import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Wrench } from 'lucide-react'
import { useApp } from '../lib/app'
import { shortDate, todayKey } from '../lib/date'
import { improveInstruction, remeasureInstructions, type SeoTarget } from '../lib/seoInstructions'
import { seoAction, seoRecommendations } from '../lib/seoRecommendations'
import { SEO_KINDS, type SeoCheck, type SeoKind, type SeoStatus } from '../lib/types'
import { Board, BoardHead, type BoardCol } from './Board'
import { Badge, Chip, Linkify, type Tone } from './ui'

/** 검색 노출 점검 — 세 가지 엔진별로 무엇을 재는지와 최근 측정값 */
const KIND_INFO: Record<SeoKind, { title: string; desc: string; tone: Tone; items: string[] }> = {
  SEO: {
    title: 'SEO · 검색 엔진 최적화',
    desc: '구글 · 네이버 검색 결과에 우리 사이트가 얼마나 잘 잡히는가',
    tone: 'blue',
    items: ['구글 색인 페이지 수', '핵심 키워드 순위 (팝업 제작 · 전시 부스 · 공간 디자인)', '사이트 속도 (LCP · Core Web Vitals)', '모바일 적합성', '메타 제목 · 설명 완성도', '구조화 데이터 (Organization · LocalBusiness)', '백링크 수 · 참조 도메인', '네이버 검색 노출 (블로그 · 플레이스 · 사이트)', '구글 비즈니스 프로필 완성도'],
  },
  AEO: {
    title: 'AEO · 답변 엔진 최적화',
    desc: '질문형 검색에 우리 글이 바로 답으로 뽑히는가 (AI 오버뷰 · 스니펫 · 지식스니펫)',
    tone: 'acid',
    items: ['질문·답변의 명료성 및 적용 가능한 구조화 데이터', '질문형 키워드 답변 글 수', '구글 AI 오버뷰 · 추천 스니펫 노출', '네이버 지식스니펫 · 인플루언서 노출', '첫 문단 요약 (답변 간결성)', '작성자 · 회사 신뢰 신호 (E-E-A-T)'],
  },
  GEO: {
    title: 'GEO · 생성형 엔진 최적화',
    desc: 'ChatGPT · Gemini · Perplexity 같은 AI가 우리를 추천 · 인용하는가',
    tone: 'yellow',
    items: ['ChatGPT 브랜드 언급 (팝업 제작 업체 추천 질문)', 'Gemini 인용', 'Perplexity 인용', '네이버 AI 브리핑 · 클로바 언급', '브랜드 소개 정확도 (AI 답변 내용 검수)', '인용 가능한 출처 페이지 수 (회사 소개 · 실적 · 보도)', '검색 크롤러 접근·색인 허용 (robots.txt · noindex)'],
  },
}
const STATUS_TONE: Record<SeoStatus, Tone> = { 양호: 'green', 주의: 'yellow', 미흡: 'red', 미측정: 'gray' }

export function SeoPanel({ checks }: { checks: SeoCheck[] }) {
  const { api, profiles, toast } = useApp()
  /** 지시를 보내는 중인 대상 ('all' 또는 '종류:항목') */
  const [asking, setAsking] = useState<string | null>(null)
  /** 펼쳐 본 줄 ('종류:항목') */
  const [open, setOpen] = useState<string | null>(null)
  const [kind, setKind] = useState<SeoKind | '전체'>('전체')
  // 좁은 칸(채팅을 넓힌 화면 · 휴대폰)에서는 목표 · 비고 · 측정일 열을 빼고 줄을 눌러 펼쳐 본다
  const box = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 760))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dates = [...new Set(checks.map(c => c.checked_on))].sort((a, b) => b.localeCompare(a))
  const latest = dates[0] ?? null
  const prevDate = dates[1] ?? null
  const kinds = kind === '전체' ? SEO_KINDS : [kind]
  // 항목별 최신값 (카탈로그 항목은 측정 전이면 '미측정'으로)
  const rowsFor = (k: SeoKind) => {
    const measured = checks.filter(c => c.kind === k)
    const names = [...new Set([...KIND_INFO[k].items, ...measured.map(c => c.item)])]
    return names.map(item => {
      const hist = measured.filter(c => c.item === item).sort((a, b) => b.checked_on.localeCompare(a.checked_on))
      const cur = hist[0] ?? null
      const prev = hist.find(c => cur && c.checked_on < cur.checked_on) ?? null
      return { item, cur, prev }
    })
  }
  type Row = ReturnType<typeof rowsFor>[number]
  const avg = (k: SeoKind) => {
    const sc = rowsFor(k).map(r => r.cur?.score).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)
    return sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null
  }
  const lead = profiles.find(p => p.is_agent && p.active && p.name === '마케팅팀장') ?? profiles.find(p => p.is_agent && p.active && p.name === 'WKLY 총괄')
  const target = (k: SeoKind, r: Row): SeoTarget => ({ kind: k, item: r.item, status: r.cur?.status ?? '미측정', value: r.cur?.value, note: r.cur?.note, source: r.cur?.source })
  /** AI 팀원에게 지시 (여러 건이면 차례로) */
  const send = async (key: string, texts: string[], done: string) => {
    if (!lead || asking) return
    setAsking(key)
    try {
      for (const text of texts) await api.instructAgent(lead.id, text)
      toast(done)
    } catch (e) {
      toast(e instanceof Error ? e.message : '지시하지 못했습니다.')
    } finally {
      setAsking(null)
    }
  }
  const improve = (k: SeoKind, r: Row) => {
    const t = target(k, r)
    return t.status === '미측정'
      ? send(`${k}:${r.item}`, remeasureInstructions([t]), `${lead?.name}에게 '${r.item}' 측정을 지시했습니다.`)
      : send(`${k}:${r.item}`, [improveInstruction(t, seoAction(t))], `${lead?.name}에게 '${r.item}' 개선을 지시했습니다. 초안은 알림 · AI 지시 기록으로 옵니다.`)
  }
  // 세 표의 열 폭을 똑같이 고정 (표마다 내용에 따라 열이 밀리지 않게)
  const colsFor = (k: SeoKind): BoardCol<Row>[] => ([
    { key: 'item', label: '측정 항목', width: narrow ? undefined : '24%', kind: 'title', cell: r => <span className="t-smallb" title={r.item}>{r.item}</span> },
    { key: 'status', label: '상태', width: 76, kind: 'center', cell: r => <Badge tone={STATUS_TONE[r.cur?.status ?? '미측정']}>{r.cur?.status ?? '미측정'}</Badge> },
    {
      key: 'score', label: '점수', width: 84, kind: 'num',
      cell: r => (
        <span className="t-mono">
          {r.cur?.score ?? '-'}
          {r.cur?.score != null && r.prev?.score != null && r.cur.score !== r.prev.score && (
            <span className={`t-meta ${r.cur.score > r.prev.score ? 't-green' : 't-red'}`}> ({r.cur.score > r.prev.score ? '+' : ''}{r.cur.score - r.prev.score})</span>
          )}
        </span>
      ),
    },
    { key: 'value', label: '측정값', width: narrow ? '26%' : '18%', cell: r => <span className="t-small" title={r.cur?.value ?? undefined}>{r.cur?.value ?? '-'}</span> },
    { key: 'target', label: '목표', width: '12%', cell: r => <span className="t-small" title={r.cur?.target ?? undefined}>{r.cur?.target ?? '-'}</span> },
    { key: 'note', label: '비고 · 개선점', cell: r => <span className="cell-sub" title={r.cur?.note ?? undefined}>{r.cur?.note ?? '-'}</span> },
    { key: 'date', label: '측정일', width: 72, kind: 'center', cell: r => <span className="t-meta">{r.cur ? shortDate(r.cur.checked_on) : '-'}</span> },
    {
      key: 'act', label: '개선', width: 84, kind: 'center',
      cell: r => {
        const st = r.cur?.status ?? '미측정'
        if (st === '양호' || !lead) return <span className="t-meta">-</span>
        const busy = asking === `${k}:${r.item}`
        return (
          <button type="button" className="btn btn-outline btn-sm" disabled={!!asking} title={`${lead.name} AI 에게 ${st === '미측정' ? '측정' : '개선 초안'} 지시`} onClick={e => { e.stopPropagation(); void improve(k, r) }}>
            {busy ? <RefreshCw size={12} className="spin" /> : st === '미측정' ? '측정' : '개선'}
          </button>
        )
      },
    },
  ] satisfies BoardCol<Row>[]).filter(c => !narrow || !['target', 'note', 'date'].includes(c.key))
  /** 줄을 누르면 펼쳐 보이는 내용: 잘린 글 전체 + 개선 방향 + 바로 지시 */
  const detail = (k: SeoKind, r: Row) => {
    if (open !== `${k}:${r.item}`) return null
    const st = r.cur?.status ?? '미측정'
    return (
      <div className="seo-detail">
        <dl>
          <dt>측정값</dt><dd>{r.cur?.value ? <Linkify text={r.cur.value} /> : '-'}</dd>
          <dt>목표</dt><dd>{r.cur?.target ? <Linkify text={r.cur.target} /> : '-'}</dd>
          <dt>비고 · 개선점</dt><dd>{r.cur?.note ? <Linkify text={r.cur.note} /> : '-'}</dd>
          {r.cur?.source && <><dt>근거</dt><dd><Linkify text={r.cur.source} /></dd></>}
          {st !== '양호' && <><dt>개선 방향</dt><dd>{st === '미측정' ? '먼저 측정이 필요합니다. 측정값과 근거가 쌓이면 개선 방향을 제안합니다.' : seoAction({ kind: k, item: r.item })}</dd></>}
        </dl>
        {st !== '양호' && lead && (
          <div className="row wrap" style={{ gap: 8 }}>
            {st !== '미측정' && (
              <button type="button" className="btn btn-blue btn-sm" disabled={!!asking} onClick={() => void improve(k, r)}>
                <Wrench size={13} /> {lead.name}에게 개선 초안 지시
              </button>
            )}
            <button type="button" className="btn btn-outline btn-sm" disabled={!!asking} onClick={() => void send(`${k}:${r.item}`, remeasureInstructions([target(k, r)]), `${lead.name}에게 '${r.item}' 다시 측정을 지시했습니다.`)}>
              <RefreshCw size={13} /> 다시 측정
            </button>
            <span className="t-cap">AI 는 검토용 초안까지만 작성하며 홈페이지를 직접 고치지 않습니다.</span>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="col gap-10" ref={box}>
      <div className="row wrap">
        <div className="chips">
          <Chip active={kind === '전체'} onClick={() => setKind('전체')}>전체</Chip>
          {SEO_KINDS.map(k => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{k}</Chip>
          ))}
        </div>
        <span className="grow" />
        {(() => {
          // 미측정 · 미흡 다시 측정 (대표 지시 2026-11-11): 마케팅팀장 AI 에게 지시 → 바로 확인할 수 있는 건 지금, 나머지는 측정 담당 AI 의 다음 실행에서
          const weak = kinds.flatMap(k => rowsFor(k).filter(r => !r.cur || r.cur.status === '미측정' || r.cur.status === '미흡').map(r => target(k, r)))
          if (!weak.length || !lead) return null
          // 지시 한 건은 2000자까지라 항목이 많으면 여러 건으로 나눠 보낸다 (2026-11-13 · 글자 수 제한 오류 수정)
          const texts = remeasureInstructions(weak)
          const ask = () => send('all', texts, `${lead.name}에게 ${weak.length}개 항목 다시 측정을 지시했습니다${texts.length > 1 ? ` (지시 ${texts.length}건으로 나눔)` : ''}. 결과는 알림 · AI 지시 기록으로 옵니다.`)
          return (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void ask()} disabled={!!asking} title={`${lead.name} AI 에게 다시 측정 지시`}>
              <RefreshCw size={13} className={asking === 'all' ? 'spin' : undefined} /> 미측정 · 미흡 다시 측정 ({weak.length})
            </button>
          )
        })()}
        <span className="t-cap">{latest ? `최근 측정 ${shortDate(latest)}${prevDate ? ` · 이전 ${shortDate(prevDate)}` : ''} · 예약 실행·실측 여부는 별도 확인` : '아직 측정 전 · 예약 실행·실측 여부는 별도 확인해 기록합니다'}</span>
      </div>
      <p className="t-cap">점수는 등록된 측정값의 평균이며 실제 검색 순위나 AI 인용률이 아닙니다. GEO를 위한 별도 마크업만으로 노출이 보장되지 않습니다. 항목 줄을 누르면 전체 내용과 개선 방향이 펼쳐지고, ‘개선’ 버튼으로 AI 팀원에게 개선 초안을 바로 지시할 수 있습니다.</p>
      <details className="growth-ai"><summary>등록된 측정값으로 개선 우선순위 자동 정리</summary><p>최근 14일 측정·원문 URL을 확인할 수 있는 미흡 항목을 먼저 표시합니다. 실제 페이지 수정은 별도 검토 후 진행합니다.</p><ol>{seoRecommendations(checks.filter(c=>kinds.includes(c.kind)),todayKey()).map(c=><li key={c.kind+c.item}><strong>[{c.kind}] {c.item}</strong> — {c.reason}<p>{c.action}</p>{lead&&<button type="button" className="btn btn-outline btn-sm" disabled={!!asking} onClick={()=>void send(c.kind+':'+c.item,c.priority===2?remeasureInstructions([c]):[improveInstruction(c,c.action)],`${lead.name}에게 '${c.item}' ${c.priority===2?'다시 측정':'개선'}을 지시했습니다.`)}>{c.priority===2?'다시 측정 지시':'개선 초안 지시'}</button>}</li>)}</ol>{checks.length===0&&<p>측정값이 없어 우선순위를 판단하지 않았습니다.</p>}</details>
      <div className="kpis">
        {SEO_KINDS.map(k => {
          const a = avg(k)
          return (
            <div key={k} className="kpi">
              <span className="t-cap">{KIND_INFO[k].title}</span>
              <span className="v">{a ?? '-'}<span className="t-meta"> / 100</span></span>
              <span className="t-meta">{KIND_INFO[k].desc}</span>
            </div>
          )
        })}
      </div>
      {kinds.map(k => (
        <div key={k} className="col">
          <BoardHead title={KIND_INFO[k].title} count={rowsFor(k).filter(r => r.cur).length + ' / ' + rowsFor(k).length}>
            <Badge tone={KIND_INFO[k].tone}>{k}</Badge>
            <span className="t-cap">{KIND_INFO[k].desc}</span>
          </BoardHead>
          <Board className="seo-board" rows={rowsFor(k)} cols={colsFor(k)} rowKey={r => r.item} numbered={false} compact onRow={r => setOpen(o => (o === `${k}:${r.item}` ? null : `${k}:${r.item}`))} selectedId={open?.startsWith(k + ':') ? open.slice(k.length + 1) : null} expand={r => detail(k, r)} />
        </div>
      ))}
    </div>
  )
}
