import { newGrowth, safeWebUrl, validateGrowth, type GrowthDraft } from './growth.ts'
import { validDate } from './prospecting.ts'

export type DiscoveryKind = 'contact' | 'tender'
export interface DiscoveryPreview { index: number; title: string; draft: GrowthDraft | null; error: string; warnings: string[] }

function text(row: Record<string, unknown>, key: string, label: string, max: number, required = false): string {
  const value = row[key]
  if (value == null && !required) return ''
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw new Error(`${label}: ${required ? '필수 · ' : ''}${max}자 이내의 문자열을 입력해 주세요.`)
  return value.trim()
}

/** Untrusted research is a draft, never a verified eligibility decision or automatic write. */
export function parseDiscoveryReport(raw: string, kind: DiscoveryKind, owner: string, today: string): DiscoveryPreview[] {
  if (raw.length > 150000) throw new Error('한 번에 150,000자 이하로 가져와 주세요.')
  if (!validDate(today)) throw new Error('현재 날짜를 확인해 주세요.')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('JSON 형식이 올바르지 않습니다. 조사 결과 원문을 확인해 주세요.') }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  if (!rows.length || rows.length > 20) throw new Error('한 번에 1~20개 후보를 가져올 수 있습니다.')
  const identities = new Set<string>()
  return rows.map((value, index) => {
    const preview: DiscoveryPreview = { index, title: `${index + 1}번 후보`, draft: null, error: '', warnings: [] }
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('후보는 JSON 객체여야 합니다.')
      const row = value as Record<string, unknown>
      preview.title = text(row, 'title', '제목', 160, true)
      if (row.kind !== kind) throw new Error(`현재 화면에는 ${kind === 'contact' ? 'contact(민간 연락처)' : 'tender(나라장터 공고)'}만 가져올 수 있습니다.`)
      const target = text(row, 'target', '브랜드·발주처', 200, true)
      const url = text(row, 'source_url', '출처 주소', 2000, true)
      if (!safeWebUrl(url)) throw new Error('출처는 자격증명이 없는 http(s) 주소여야 합니다.')
      const verified = text(row, 'verified_on', '확인일', 10, true)
      if (!validDate(verified) || verified > today) throw new Error('확인일은 오늘까지의 실제 날짜(YYYY-MM-DD)여야 합니다.')
      const evidence = text(row, 'evidence', '확인 근거', 2000, true)
      const need = text(row, 'need', '영업 계기·수요', 1000, true)
      const offer = text(row, 'offer', '제안 방향', 1000, true)
      const action = text(row, 'next_action', '다음 행동', 500, true)
      const relationship = text(row, 'relationship', '기존 접촉 여부', 100) || '미확인 · 기존 연락 이력 대조 필요'
      const contact = text(row, 'contact_name', '담당자·부서', 200)
      if (row.division != null && row.division !== 'TW' && row.division !== 'AR') throw new Error('수행 회사는 TW 또는 AR이어야 합니다.')
      const draft = newGrowth(kind, owner)
      draft.title = preview.title
      draft.document.division = row.division === 'AR' ? 'AR' : 'TW'
      draft.document.source_url = url
      draft.document.note = ['[영업 발굴 조사 결과 · 검토 전]', `대상: ${target}`, `기존 접촉 여부: ${relationship}`, `확인일: ${verified}`, `출처: ${url}`, `확인 근거: ${evidence}`, `영업 계기·수요: ${need}`, `제안 방향: ${offer}`, `다음 행동: ${action}`, contact && `담당자·부서: ${contact}`, '출처와 기존 연락 이력을 다시 확인한 뒤 영업 기회로 연결하세요. 조사 결과는 발송 동의·참가 자격·계약 확정이 아닙니다.'].filter(Boolean).join('\n')
      let identity = ''
      if (kind === 'contact') {
        draft.document.brand = target
        draft.document.name = contact
        draft.document.email = text(row, 'email', '이메일', 254).toLowerCase()
        draft.document.instagram = text(row, 'instagram', '인스타 계정명', 31).replace(/^@/, '').toLowerCase()
        draft.document.source = '에이전트 리서치'
        identity = draft.document.email || draft.document.instagram
      } else {
        draft.document.number = text(row, 'number', '공고번호', 200, true)
        draft.document.round = text(row, 'round', '차수', 20, true)
        draft.document.agency = target
        const deadline = text(row, 'deadline', '마감 시각', 40)
        if (deadline && (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(deadline) || !validDate(deadline.slice(0, 10)) || !Number.isFinite(Date.parse(deadline)))) throw new Error('마감 시각은 시간대가 있는 날짜·시각으로 입력해 주세요. 예: 2026-11-20T18:00:00+09:00')
        draft.document.deadline = deadline
        if (row.amount != null && (typeof row.amount !== 'number' || !Number.isSafeInteger(row.amount) || row.amount < 0)) throw new Error('공고 금액은 0 이상의 정수 또는 null이어야 합니다.')
        draft.document.amount = typeof row.amount === 'number' ? row.amount : null
        draft.document.qualification = '추가 확인'
        draft.document.evidence = evidence
        const deadlines = text(row, 'deadlines', '상세 마감·제출 방식', 1500)
        draft.document.note += `\n[조사 당시 공고 정보 · 편집 후 변경값은 자동 반영되지 않습니다]\n공고번호·차수: ${draft.document.number} / ${draft.document.round}\n가장 이른 필수 마감: ${deadline || '미확인'}\n상세 마감·제출 방식: ${deadlines || '원문 확인 필요'}\n공고 금액: ${draft.document.amount === null ? '미확인' : `${draft.document.amount}원`} (계약액·우리 매출 아님)`
        identity = `${draft.document.number}:${draft.document.round}`
        preview.warnings.push('참가 자격은 항상 추가 확인으로 등록됩니다. 공고 금액은 계약액이나 우리 매출이 아닙니다.')
        if (!deadline) preview.warnings.push('마감 시각 미확인 · 공고 원문을 확인해 주세요.')
        else if (deadline.slice(0, 10) < today) preview.warnings.push('마감일이 지난 후보입니다. 정정·재공고 또는 다음 회차 여부를 확인해 주세요.')
      }
      const invalid = validateGrowth(draft)
      if (invalid) throw new Error(invalid)
      if (identities.has(identity)) throw new Error('이번 자료 안에 동일한 공고번호·차수 또는 연락처가 중복되어 있습니다.')
      identities.add(identity)
      if (verified < new Date(Date.parse(today + 'T00:00:00Z') - 14 * 86400000).toISOString().slice(0, 10)) preview.warnings.push('확인 후 14일이 지났습니다. 일정과 연락처를 다시 확인해 주세요.')
      preview.draft = draft
    } catch (e) { preview.error = e instanceof Error ? e.message : '후보 형식을 확인해 주세요.' }
    return preview
  })
}
