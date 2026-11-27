// 드라이브 폴더 → 인트라넷 프로젝트 자동 가져오기 규칙 (대표 지시 2026-11-25 '드라이브 폴더 자동으로 인트라넷에 넣는 기능 만들어')
// 순수 규칙만 — 시험 tests/drive-folder-import.test.ts

/** 연도 묶음 폴더 이름 → 구분 */
export const GROUP_DIVISION: Record<string, 'AR' | 'TW' | 'RS'> = { ARTERIOR: 'AR', WKLY: 'TW', RESEARCH: 'RS' }

/** 묶음 폴더 안의 보관 폴더(예: 'AR0000 NIC') → 그 안 프로젝트의 상태 */
export function holdingStatus(name: string): string | null {
  const t = name.trim()
  if (!/^[A-Z]{2}0000\s/.test(t)) return null
  if (/\bNIC\b/i.test(t)) return 'NIC'
  if (/완료/.test(t)) return '완료'
  return null
}

export interface FolderPick { code: string; division: 'AR' | 'TW' | 'RS'; name: string }

/**
 * 프로젝트 폴더 이름 'AR2611-15 성수 향수 팝업 - 케이월드미디어' → 연번 · 구분 · 이름.
 * 연번이 두 개 붙은 이름 · 운영 칸(0000) · 이름 없는 것 · 구분이 묶음과 다른 것은 가져오지 않음.
 */
export function parseProjectFolder(title: string, division: 'AR' | 'TW' | 'RS'): FolderPick | null {
  const m = /^(AR|TW|RS)(\d{4})-(\d{1,3})[\s_]+(.+)$/.exec(title.trim())
  if (!m) return null
  const [, div, ym, seq, rest] = m
  if (div !== division) return null
  if (ym === '0000') return null
  const mm = Number(ym.slice(2))
  if (mm < 1 || mm > 12) return null
  if (/^(AR|TW|RS)\d{4}(-\d{1,3})?[\s_]/.test(rest)) return null // 'AR2611-07 AR2611-12 …' 처럼 연번이 둘
  const name = rest.replace(/[\s_]+/g, ' ').trim()
  if (!name || name.length > 200) return null
  return { code: `${div}${ym}-${seq.padStart(2, '0')}`, division, name }
}

export const categoryOf = (name: string) => (/팝업/.test(name) ? '팝업' : '기타')
