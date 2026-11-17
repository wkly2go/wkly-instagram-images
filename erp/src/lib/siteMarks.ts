// 현장 실측 사진 위 치수 선 · 치수 글자의 크기
//   2026-11-17 대표 지시 '실측한 치수랑 치수선이 너무 커서 사진이 가려지니까 크기를 지금의 절반 사이즈로'
//   치수는 가로 1000 칸짜리 좌표(viewBox)에 그려 사진 폭에 맞춰 늘어난다. 그래서 크기도 '칸' 단위로 정한다.
//   - 선 · 흰 테두리 · 끝 점 · 찍는 중인 시작점: 어느 화면에서나 예전의 정확히 절반
//   - 글자: 예전의 절반. 다만 사진이 좁게 보이는 휴대폰에서는 읽을 수 있는 8px 아래로는 줄이지 않는다
//     (그래도 예전 크기보다 커지지는 않는다)
//   - 이름표(초록 칸): 글자 크기를 따라가고, 글자가 8px 에 걸린 휴대폰에서는 여백을 줄여
//     사진을 가리는 넓이가 예전의 3분의 1쯤이 되게 한다
//   - 어느 폭에서도(아주 좁은 도면 핀 미리보기 포함) 예전보다 커지는 것은 없다

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

/** 예전 크기(칸) — 2026-11-17 전까지 쓰던 값 */
export const OLD_MARK_SIZES = {
  text: 36,
  line: 5,
  halo: 10,
  endRadius: 9,
  endStroke: 4,
  draftRadius: 14,
  draftStroke: 5,
  tagHeight: 48,
  tagRadius: 6,
  /** 이름표 폭 = 글자 수 × 26 + 20 */
  tagChar: 26,
  tagPad: 20,
  textDy: 12,
} as const

/** 치수 글자의 최소 크기(화면 px) */
export const MARK_TEXT_MIN_PX = 8

/** 이름표 비율(글자 크기의 몇 배): [예전 비율 그대로, 글자가 최소 크기에 걸린 좁은 화면용(여백을 줄임)] */
const TAG = {
  height: [OLD_MARK_SIZES.tagHeight / OLD_MARK_SIZES.text, 1.2],
  char: [OLD_MARK_SIZES.tagChar / OLD_MARK_SIZES.text, 0.64],
  pad: [OLD_MARK_SIZES.tagPad / OLD_MARK_SIZES.text, 0.34],
} as const
/** 글자가 절반 크기보다 이만큼(25%) 커지면 이름표 여백을 끝까지 줄인다. 그 사이는 조금씩 */
const TAG_SQUEEZE_SPAN = 0.25

/** 사진이 화면에 보이는 폭(px)에 맞는 치수 크기. 폭을 아직 모르면(0 · 잘못된 값) 넓은 화면 기준(절반 크기) */
export function markSizes(widthPx: number): MarkSizes {
  const width = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : MARK_VIEW_WIDTH
  const unit = MARK_VIEW_WIDTH / width
  const old = OLD_MARK_SIZES
  const half = old.text / 2
  // 글자: 절반 → 8px 에 걸리면 거기까지만 → 그래도 예전 크기는 넘지 않음
  const text = Math.min(old.text, Math.max(half, MARK_TEXT_MIN_PX * unit))
  // 0 = 글자가 절반 크기 그대로(넓은 화면) … 1 = 최소 크기에 걸려 절반보다 한참 큼(휴대폰)
  const squeeze = Math.min(1, Math.max(0, (text / half - 1) / TAG_SQUEEZE_SPAN))
  const tag = (key: keyof typeof TAG) => text * (TAG[key][0] + (TAG[key][1] - TAG[key][0]) * squeeze)
  return {
    unit,
    text,
    line: old.line / 2,
    halo: old.halo / 2,
    endRadius: old.endRadius / 2,
    endStroke: old.endStroke / 2,
    draftRadius: old.draftRadius / 2,
    draftStroke: old.draftStroke / 2,
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
