// Instagram caption rules shared by the intranet screen and the instagram-publish function.
export const IG_CAPTION_MAX = 2200
export const IG_HASHTAG_MAX = 30
export const IG_MENTION_MAX = 20
export const IG_IMAGE_MAX = 10

export function igHashtags(tags: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags.split(/[\s,，]+/)) {
    const word = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    out.push(`#${word}`)
  }
  return out
}

/** Caption = title (unless the body already opens with it) + body + hashtags not already in the body. */
export function igCaption(v: { title: string; body: string; tags: string }): string {
  const title = v.title.trim()
  const body = v.body.trim()
  const head = title && !body.startsWith(title) ? `${title}\n\n` : ''
  const inBody = new Set((body.match(/#[\p{L}\p{N}_]+/gu) ?? []).map(t => t.toLowerCase()))
  const tags = igHashtags(v.tags).filter(t => !inBody.has(t.toLowerCase()))
  return `${head}${body}${tags.length ? `\n\n${tags.join(' ')}` : ''}`
}

export function igCaptionIssues(caption: string): string[] {
  const issues: string[] = []
  if (!caption.trim()) issues.push('본문이 비어 있습니다.')
  if (caption.length > IG_CAPTION_MAX) issues.push(`글이 ${caption.length.toLocaleString()}자입니다. 인스타그램은 ${IG_CAPTION_MAX.toLocaleString()}자까지입니다.`)
  const tags = caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0
  if (tags > IG_HASHTAG_MAX) issues.push(`해시태그가 ${tags}개입니다. ${IG_HASHTAG_MAX}개까지 쓸 수 있습니다.`)
  const mentions = caption.match(/(^|\s)@[\w.]+/g)?.length ?? 0
  if (mentions > IG_MENTION_MAX) issues.push(`계정 언급(@)이 ${mentions}개입니다. ${IG_MENTION_MAX}개까지 쓸 수 있습니다.`)
  return issues
}
