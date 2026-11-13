import type { SeoKind } from './types'

/** agent_instructions.instruction 은 2000자까지 (0007) — 여유를 두고 자른다 */
export const INSTRUCTION_MAX = 1900

export interface SeoTarget {
  kind: SeoKind
  item: string
  status: string
  value?: string | null
  note?: string | null
  source?: string | null
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const REMEASURE_GUIDE =
  "1) 웹 검색으로 지금 바로 확인할 수 있는 항목은 바로 확인해 결과를 알려 주세요.\n2) 나머지는 검색 노출 측정 담당 팀원 AI 에게 add_directive 로 '다음 실행에서 아래 항목 우선 재측정 (미흡이면 원인 · 개선안 함께)'을 우선순위 2 · 7일로 등록하세요.\n3) 서치콘솔처럼 로그인이 필요한 항목은 무엇이 필요한지 적어 주세요."

/**
 * '다시 측정' 지시문. 항목이 많으면 지시 한 건이 글자 수 제한을 넘으므로 여러 건으로 나눈다.
 * 모든 항목이 빠짐없이 어느 한 건에 들어간다.
 */
export function remeasureInstructions(targets: SeoTarget[], max = INSTRUCTION_MAX): string[] {
  const lines = targets.map(t => `- [${t.kind}] ${clip(t.item, 80)} (${t.status})`)
  const head = (part: string, n: number) =>
    `[검색 노출 다시 측정${part}] 광고 › 검색 노출 점검에서 '미측정' · '미흡'인 항목 ${n}개를 다시 측정해 seo_checks 에 오늘 날짜로 기록해 주세요.\n${REMEASURE_GUIDE}\n\n`
  // 머리글 길이는 가장 긴 경우(' 99/99', 항목 수 전체)로 잡아 넉넉히 나눈다
  const room = max - head(' 99/99', targets.length).length
  const groups: string[][] = [[]]
  let used = 0
  for (const line of lines) {
    if (used + line.length + 1 > room && groups[groups.length - 1].length) {
      groups.push([])
      used = 0
    }
    groups[groups.length - 1].push(line)
    used += line.length + 1
  }
  return groups
    .filter(g => g.length)
    .map((g, i, all) => head(all.length > 1 ? ` ${i + 1}/${all.length}` : '', g.length) + g.join('\n'))
}

/** 항목 하나를 바로 개선하도록 하는 지시문 (초안까지만 · 홈페이지 직접 수정 · 게시는 하지 않음) */
export function improveInstruction(t: SeoTarget, action: string, max = INSTRUCTION_MAX): string {
  const facts = [
    `현재 상태: ${t.status}`,
    t.value && `측정값: ${clip(t.value, 200)}`,
    t.note && `비고: ${clip(t.note, 500)}`,
    t.source && `근거: ${clip(t.source, 200)}`,
  ].filter(Boolean).join('\n')
  return clip(
    `[검색 노출 개선] [${t.kind}] ${clip(t.item, 120)}\n${facts}\n\n개선 방향: ${action}\n\n1) 원인을 확인하고, 바로 적용할 수 있는 개선 초안(고칠 페이지 주소 · 제목/설명/본문 문구 · 필요한 구조화 데이터)을 답으로 남겨 주세요.\n2) 홈페이지를 직접 수정하거나 게시하지 말고 검토용 초안까지만 작성합니다. 대표 확인이 필요한 것은 따로 적어 주세요.\n3) 확인한 사실은 seo_checks 에 오늘 날짜로 다시 기록해 주세요 (추정은 추정이라고 표시).`,
    max,
  )
}
