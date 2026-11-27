// 프로젝트 사진을 표지 소재로 (2026-11-27 마케팅 자동화 — '프로젝트 사진 자동 선택')
//  한 번에 만들기의 표지 사진을 매번 올리지 않도록, 프로젝트 대표 사진(project_covers) 중
//  알릴 내용과 가장 맞는 것을 앞에 세운다. AI 없음 · 순수 함수. 시험: tests/cover-picks.test.ts
import type { Project } from './types'
import type { MarketingBrand } from './marketing'

export interface CoverPick { projectId: string; name: string; place: string; url: string; score: number; reasons: string[] }

const PARTICLE_RE = /(에서|으로|에게|까지|부터|이랑|하고|처럼|보다|의|을|를|은|는|이|가|에|로|와|과|도|만)$/
const STOP = new Set(['팝업', '공간', '오픈', '대관', '브랜드', '담당자', '준비', '소개', '안내', '이벤트', '행사', '프로젝트', '시험'])

/** 알릴 내용 → 비교할 낱말 (2자 이상 · 흔한 조사 · 흔한 낱말 뺌) */
export function topicWords(topic: string): string[] {
  const out = new Set<string>()
  for (const raw of topic.replace(/\[[^\]]*\]/g, ' ').split(/[^0-9A-Za-z가-힣]+/)) {
    const w = raw.replace(PARTICLE_RE, '').toLowerCase()
    if (w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w)
  }
  return [...out].slice(0, 20)
}

/** 대표 사진이 있는 프로젝트를 알릴 내용과 맞는 순서로. 회사 운영(RS) · 문의 · NIC 는 뺀다 */
export function rankCoverPhotos(topic: string, brand: MarketingBrand, projects: Project[], covers: Record<string, string>, limit = 12): CoverPick[] {
  const words = topicWords(topic)
  const division = brand === 'arterior' ? 'AR' : 'TW'
  const picks: (CoverPick & { at: number })[] = []
  for (const p of projects) {
    const url = covers[p.id]
    if (!url || p.division === 'RS' || p.status === '문의' || p.status === 'NIC') continue
    const hay = `${p.name} ${p.location ?? ''} ${p.description ?? ''}`.toLowerCase()
    const hits = words.filter(w => hay.includes(w))
    const reasons = hits.length ? [`'${hits.slice(0, 3).join(' · ')}' 일치`] : []
    let score = hits.length * 3
    if (p.division === division) { score += 1; reasons.push(division === 'AR' ? '아트리어 프로젝트' : '더위클리 프로젝트') }
    if (p.status === '완료') score += 0.5
    picks.push({ projectId: p.id, name: p.name, place: p.location ?? '', url, score, reasons, at: Date.parse(p.end_date ?? p.updated_at ?? '') || 0 })
  }
  return picks.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, limit).map(({ at: _at, ...x }) => x)
}

/** 고른 사진 → 표지에 쓸 파일 (주소에서 받아 옴) */
export async function coverFile(pick: CoverPick, fetcher: typeof fetch = fetch): Promise<File> {
  const res = await fetcher(pick.url)
  if (!res.ok) throw new Error('사진을 받지 못했습니다. 잠시 뒤 다시 골라 주세요.')
  const blob = await res.blob()
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg'
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg').replace(/\+.*$/, '') || 'jpg'
  return new File([blob], `${pick.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.${ext}`, { type })
}
