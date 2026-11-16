import type { GrowthKind } from './growth.ts'

export interface SalesCandidateReview {
  bucket: 'linked' | 'closed' | 'expired' | 'blocked' | 'verify' | 'ready'
  label: string
  nextAction: string
  reasons: string[]
  focus: 'popup' | 'event' | 'general'
  source: 'mail' | 'research' | 'manual' | 'other'
  deadline: string | null
}
export interface CandidateReviewInput {
  kind: GrowthKind
  title: string
  status: string
  linked_sales_id: string | null
  source?: unknown
  segment?: unknown
  deadline?: unknown
  qualification?: unknown
}

function validDeadline(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null
  const time = Date.parse(value), day = Date.parse(value.slice(0, 10) + 'T00:00:00Z')
  return Number.isFinite(time) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.slice(0, 10) ? time : null
}

/** Local triage of a bounded list page. Recorded status and source do not prove commercial intent. */
function evaluateCandidate(row: CandidateReviewInput, now: number): Omit<SalesCandidateReview, 'label' | 'nextAction'> | undefined {
  if (row.kind === 'content') return undefined
  const title = typeof row.title === 'string' ? row.title.slice(0, 160) : ''
  const source = row.source === '받은 메일' ? 'mail' : row.source === '에이전트 리서치' ? 'research' : row.source === '직접 등록' ? 'manual' : 'other'
  const focus = /팝업|pop[ -]?up/i.test(title) || row.segment === '팝업·공간' ? 'popup' : /행사|전시|박람회|페스티벌|축제/.test(title) ? 'event' : 'general'
  const result: Omit<SalesCandidateReview, 'label' | 'nextAction'> = { bucket: 'verify', reasons: [], focus, source, deadline: null }
  if (row.linked_sales_id) return { ...result, bucket: 'linked', reasons: ['이미 영업 기회에 연결됨'] }
  if (['제외', '취소', '종료'].includes(row.status)) return { ...result, bucket: 'closed', reasons: ['종료·제외 상태: 신규 접촉 대상으로 자동 추천하지 않음'] }
  if (row.kind === 'contact') {
    if (!['검토', '확인'].includes(row.status)) return { ...result, reasons: ['연락처 검토 상태 확인 필요'] }
    const segmentRecorded = ['브랜드 마케팅', '팝업·공간', '콘텐츠·광고', '공공기관', '협력사'].includes(String(row.segment))
    result.bucket = row.status === '확인' ? 'ready' : 'verify'
    result.reasons = [row.status === '확인' ? '담당자가 확인으로 기록함: 실제 수요·접촉 동의는 별도 확인' : '담당자 확인 전: 수요·기존 연락 이력 검토 필요', source === 'mail' ? '메일 발신자 후보: 수신만으로 구매 의사를 판단하지 않음' : source === 'research' ? '조사 자료 후보: 출처·확인일·담당 부서 재검토' : source === 'manual' ? '직접 등록 후보: 등록 사실만으로 검증 완료를 뜻하지 않음' : '수집 경로 확인 필요']
    if (!segmentRecorded) result.reasons.push('고객군 미분류: 브랜드·공간·협력사 구분 필요')
    return result
  }
  const deadline = validDeadline(row.deadline)
  result.deadline = deadline === null ? null : new Date(deadline + 9 * 3600000).toISOString().slice(0, 19) + '+09:00'
  if (row.qualification === '불충족') return { ...result, bucket: 'blocked', reasons: ['참가 조건 불충족으로 기록됨: 참여 대상으로 자동 추천하지 않음'] }
  if (deadline !== null && Number.isFinite(now) && deadline <= now) return { ...result, bucket: 'expired', reasons: ['한국시간 마감 경과: 정정·재공고 여부 확인 필요'] }
  if (row.status === '제출') return { ...result, bucket: 'closed', reasons: ['제출로 기록됨: 결과·협상 확인 단계이며 신규 제출 대상 아님'] }
  if (!['검토', '준비'].includes(row.status) || !Number.isFinite(now)) return { ...result, reasons: ['공고 상태·현재 시각 확인 필요'] }
  result.bucket = deadline !== null && row.qualification === '충족' ? 'ready' : 'verify'
  result.reasons = [deadline === null ? '마감 시각·시간대 미확인' : deadline - now <= 3 * 86400000 ? '3일 이내 마감: 서류·가격 제출 기한을 각각 확인' : '마감 전: 제출 방식과 필수 기한 확인', row.qualification === '충족' ? '충족으로 기록됨: 최신 공고의 자격·실적·증빙 재확인' : '참가 자격 검토 필요', '공고 원문·첨부 근거 확인 필요: 목록 분류는 참가 승인이나 수주 가능성을 뜻하지 않음']
  return result
}

export function reviewSalesCandidate(row: CandidateReviewInput, now = Date.now()): SalesCandidateReview | undefined {
  const review = evaluateCandidate(row, now)
  if (!review) return undefined
  const labels = { linked: '영업 연결됨', closed: '신규 접촉 제외', expired: '마감 경과', blocked: '참가 조건 불충족', verify: '추가 확인', ready: '담당자 검토 우선' }
  const actions = { linked: '연결된 영업 기회에서 다음 행동 확인', closed: '기존 결과·종료 사유 확인', expired: '공식 원문에서 정정·재공고 확인', blocked: '자격·실적 조건과 기록 근거 재확인', verify: row.kind === 'contact' ? '실제 수요·담당 부서·기존 접촉 이력 확인' : '원문 자격·제출 기한·첨부 서류 확인', ready: row.kind === 'contact' ? '실제 수요를 확인한 뒤 맞춤 제안 준비' : '원문 대조 후 참여 여부·제출 준비 결정' }
  return { ...review, label: labels[review.bucket], nextAction: actions[review.bucket] }
}
