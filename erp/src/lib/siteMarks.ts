// 현장 실측 사진 위 치수 선 · 치수 글자의 크기
//   2026-11-17 대표 지시 '실측한 치수랑 치수선이 너무 커서 사진이 가려지니까 크기를 지금의 절반 사이즈로'
//   치수는 가로 1000 칸짜리 좌표(viewBox)에 그려 사진 폭에 맞춰 늘어난다. 그래서 크기도 '칸' 단위로 정한다.
//   - 사진이 넓게 보이는 화면(PC · 약 600px 이상): 모든 크기가 예전의 정확히 절반
//   - 사진이 좁게 보이는 화면(휴대폰): 절반까지 줄이면 읽을 수 없으므로 화면에서 읽히는 최소 크기(px)까지만 줄임

/** 치수 좌표의 가로 칸 수 (세로는 사진 비율대로) */
export const MARK_VIEW_WIDTH = 1000

export interface MarkSizes {
  /** 화면 1px 이 좌표 몇 칸인지 */
  unit: number
  /** 치수 글자 크기 */
  text: number
  /** 노란 치수 선 굵기 */
  line: number
  /** 선 뒤의 흰 테두리 굵기 */
  halo: number
  /** 선 양 끝 점 */
  endRadius: number
  endStroke: number
  /** 찍는 중인 시작점 */
  draftRadius: number
  draftStroke: number
  /** 치수 이름표(초록 칸) 높이 · 모서리 */
  tagHeight: number
  tagRadius: number
  /** 이름표 가운데에서 글자 밑선까지 (글자가 이름표 가운데에 오게) */
  textDy: number
}

/** [예전 크기의 절반(칸), 화면에서 읽히는 최소 크기(px)] */
const HALF_AND_FLOOR = {
  text: [18, 10.5],
  line: [2.5, 1.5],
  halo: [5, 3],
  endRadius: [4.5, 3],
  endStroke: [2, 1],
  draftRadius: [7, 5],
  draftStroke: [2.5, 1.2],
} as const

/** 사진이 화면에 보이는 폭(px)에 맞는 치수 크기. 폭을 아직 모르면(0 · 잘못된 값) 넓은 화면 기준(절반 크기) */
export function markSizes(widthPx: number): MarkSizes {
  const width = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : MARK_VIEW_WIDTH
  const unit = MARK_VIEW_WIDTH / width
  const size = (key: keyof typeof HALF_AND_FLOOR) => Math.max(HALF_AND_FLOOR[key][0], HALF_AND_FLOOR[key][1] * unit)
  const text = size('text')
  return {
    unit,
    text,
    line: size('line'),
    halo: size('halo'),
    endRadius: size('endRadius'),
    endStroke: size('endStroke'),
    draftRadius: size('draftRadius'),
    draftStroke: size('draftStroke'),
    // 이름표는 글자 크기를 따라감 (예전 비율 그대로: 높이 48/36 · 모서리 6/36 · 밑선 12/36)
    tagHeight: (text * 4) / 3,
    tagRadius: text / 6,
    textDy: text / 3,
  }
}

/** 치수 이름표 폭: 글자 수 × 글자 폭 + 양옆 여백 (예전 비율 그대로: 글자당 26/36 · 여백 20/36) */
export function markTagWidth(label: string, text: number): number {
  return (label.length * text * 13) / 18 + (text * 5) / 9
}

/** (cx, cy) 가 가운데인 치수 이름표의 자리와 글자 위치 */
export function markTag(label: string, cx: number, cy: number, sizes: MarkSizes) {
  const width = markTagWidth(label, sizes.text)
  return { x: cx - width / 2, y: cy - sizes.tagHeight / 2, width, height: sizes.tagHeight, rx: sizes.tagRadius, textX: cx, textY: cy + sizes.textDy }
}
