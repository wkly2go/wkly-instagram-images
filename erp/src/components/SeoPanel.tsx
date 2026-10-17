import { useState } from 'react'
import { shortDate } from '../lib/date'
import { SEO_KINDS, type SeoCheck, type SeoKind, type SeoStatus } from '../lib/types'
import { Board, BoardHead, type BoardCol } from './Board'
import { Badge, Chip, type Tone } from './ui'

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
    items: ['FAQ 구조화 (FAQPage · HowTo 스키마)', '질문형 키워드 답변 글 수', '구글 AI 오버뷰 · 추천 스니펫 노출', '네이버 지식스니펫 · 인플루언서 노출', '첫 문단 요약 (답변 간결성)', '작성자 · 회사 신뢰 신호 (E-E-A-T)'],
  },
  GEO: {
    title: 'GEO · 생성형 엔진 최적화',
    desc: 'ChatGPT · Gemini · Perplexity 같은 AI가 우리를 추천 · 인용하는가',
    tone: 'yellow',
    items: ['ChatGPT 브랜드 언급 (팝업 제작 업체 추천 질문)', 'Gemini 인용', 'Perplexity 인용', '네이버 AI 브리핑 · 클로바 언급', '브랜드 소개 정확도 (AI 답변 내용 검수)', '인용 가능한 출처 페이지 수 (회사 소개 · 실적 · 보도)', 'AI 크롤러 허용 (robots.txt · llms.txt)'],
  },
}
const STATUS_TONE: Record<SeoStatus, Tone> = { 양호: 'green', 주의: 'yellow', 미흡: 'red', 미측정: 'gray' }

export function SeoPanel({ checks }: { checks: SeoCheck[] }) {
  const [kind, setKind] = useState<SeoKind | '전체'>('전체')
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
    const sc = rowsFor(k).map(r => r.cur?.score).filter((n): n is number => typeof n === 'number')
    return sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null
  }
  const cols: BoardCol<Row>[] = [
    { key: 'item', label: '측정 항목', kind: 'title', cell: r => <span className="t-smallb">{r.item}</span> },
    { key: 'status', label: '상태', width: 72, kind: 'center', cell: r => <Badge tone={STATUS_TONE[r.cur?.status ?? '미측정']}>{r.cur?.status ?? '미측정'}</Badge> },
    {
      key: 'score', label: '점수', width: 96, kind: 'num',
      cell: r => (
        <span className="t-mono">
          {r.cur?.score ?? '-'}
          {r.cur?.score != null && r.prev?.score != null && r.cur.score !== r.prev.score && (
            <span className={`t-meta ${r.cur.score > r.prev.score ? 't-green' : 't-red'}`}> ({r.cur.score > r.prev.score ? '+' : ''}{r.cur.score - r.prev.score})</span>
          )}
        </span>
      ),
    },
    { key: 'value', label: '측정값', width: 160, cell: r => <span className="t-small">{r.cur?.value ?? '-'}</span> },
    { key: 'target', label: '목표', width: 140, hideNarrow: true, cell: r => <span className="t-small">{r.cur?.target ?? '-'}</span> },
    { key: 'note', label: '비고 · 개선점', hideNarrow: true, cell: r => <span className="cell-sub">{r.cur?.note ?? ''}</span> },
    { key: 'date', label: '측정일', width: 80, kind: 'center', hideNarrow: true, cell: r => <span className="t-meta">{r.cur ? shortDate(r.cur.checked_on) : '-'}</span> },
  ]
  return (
    <div className="col gap-10">
      <div className="row wrap">
        <div className="chips">
          <Chip active={kind === '전체'} onClick={() => setKind('전체')}>전체</Chip>
          {SEO_KINDS.map(k => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{k}</Chip>
          ))}
        </div>
        <span className="grow" />
        <span className="t-cap">{latest ? `최근 측정 ${shortDate(latest)}${prevDate ? ` · 이전 ${shortDate(prevDate)}` : ''} · 매주 월요일 WKLY 총괄이 측정` : '아직 측정 전 · 매주 월요일 WKLY 총괄이 측정해 기록합니다'}</span>
      </div>
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
          <Board rows={rowsFor(k)} cols={cols} rowKey={r => r.item} numbered={false} compact />
        </div>
      ))}
    </div>
  )
}
