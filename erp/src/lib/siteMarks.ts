// 현장 실측 사진 위 치수 선 · 치수 글자의 크기
//   2026-11-17 대표 지시 '실측한 치수랑 치수선이 너무 커서 사진이 가려지니까 크기를 지금의 절반 사이즈로'
//   치수는 가로 1000 칸짜리 좌표(viewBox)에 그려 사진 폭에 맞춰 늘어난다. 그래서 크기도 '칸' 단위로 정한다.
//   - 사진이 넓게 보이는 화면(PC · 500px 이상): 선 · 점 · 글자 · 이름표 모두 예전의 정확히 절반
//   - 사진이 좁게 보이는 화면(휴대폰): 선과 점은 그대로 절반까지 줄이고, 글자만 읽을 수 있는 크기(9px)에서 멈춘다.
//     그 대신 이름표(초록 칸)의 여백을 줄여 사진을 가리는 넓이는 예전의 3분의 1쯤이 되게 한다.
//   - 어느 화면에서도 예전보다 커지지는 않는다.

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
  /** 이름표 폭 = 글자 수 × tagChar + tagPad */
  tagChar: number
  tagPad: number
  /** 이름표 가운데에서 글자 밑선까지 (글자가 이름표 가운데에 오게) */
  textDy: number
}

/** [예전 크기(칸), 화면에서 보이려면 필요한 최소 크기(px)] — 새 크기는 예전의 절반, 최소 크기보다 작아지면 거기까지만 */
const OLD_AND_FLOOR = {
  text: [36, 9],
  line: [5, 1],
  halo: [10, 2],
  endRadius: [9, 2],
  endStroke: [4, 0.6],
  draftRadius: [14, 3],
  draftStroke: [5, 1],
} as const

/** 이름표 비율(글자 크기의 몇 배): [예전 비율 그대로 · 글자가 최소 크기에 걸린 좁은 화면용(여백을 줄임)] */
const TAG = {
  height: [4 / 3, 1.15],
  char: [13 / 18, 0.62],
  pad: [5 / 9, 0.3],
} as const
/** 글자가 절반 크기보다 이만큼(25%) 커지면 이름표 여백을 끝까지 줄인다. 그 사이는 조금씩 */
const TAG_SQUEEZE_SPAN = 0.25

/** 사진이 화면에 보이는 폭(px)에 맞는 치수 크기. 폭을 아직 모르면(0 · 잘못된 값) 넓은 화면 기준(절반 크기) */
export function markSizes(widthPx: number): MarkSizes {
  const width = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : MARK_VIEW_WIDTH
  const unit = MARK_VIEW_WIDTH / width
  const size = (key: keyof typeof OLD_AND_FLOOR) => {
    const [old, floor] = OLD_AND_FLOOR[key]
    return Math.min(old, Math.max(old / 2, floor * unit))
  }
  const text = size('text')
  // 0 = 글자가 절반 크기 그대로(넓은 화면) … 1 = 최소 크기에 걸려 절반보다 한참 큼(휴대폰)
  const squeeze = Math.min(1, Math.max(0, (text / (OLD_AND_FLOOR.text[0] / 2) - 1) / TAG_SQUEEZE_SPAN))
  const tag = (key: keyof typeof TAG) => text * (TAG[key][0] + (TAG[key][1] - TAG[key][0]) * squeeze)
  return {
    unit,
    text,
    line: size('line'),
    halo: size('halo'),
    endRadius: size('endRadius'),
    endStroke: size('endStroke'),
    draftRadius: size('draftRadius'),
    draftStroke: size('draftStroke'),
    // 넓은 화면의 이름표는 예전 비율 그대로 (높이 48/36 · 글자당 26/36 · 여백 20/36 · 모서리 6/36 · 밑선 12/36)
    tagHeight: tag('height'),
    tagRadius: text / 6,
    tagChar: tag('char'),
    tagPad: tag('pad'),
    textDy: text / 3,
  }
}

/** 치수 이름표 폭: 글자 수 × 글자 폭 + 양옆 여백 */
export function markTagWidth(label: string, sizes: Pick<MarkSizes, 'tagChar' | 'tagPad'>): number {
  return label.length * sizes.tagChar + sizes.tagPad
}

/** (cx, cy) 가 가운데인 치수 이름표의 자리와 글자 위치 */
export function markTag(label: string, cx: number, cy: number, sizes: MarkSizes) {
  const width = markTagWidth(label, sizes)
  return { x: cx - width / 2, y: cy - sizes.tagHeight / 2, width, height: sizes.tagHeight, rx: sizes.tagRadius, textX: cx, textY: cy + sizes.textDy }
}
