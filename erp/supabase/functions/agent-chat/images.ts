// Let the assistant see photos sent in chat (2026-11-28 대표 지시 '내비서가 이미지를 읽지 못해 기능을 추가해').
// Pure rules here; downloading happens in index.ts.

export type Att = { path?: string; name?: string; type?: string; size?: number; preview_path?: string } | null
export type Row = { user_id: string; created_at: string; attachment?: Att }

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const MAX_IMAGES = 4
/** Only photos sent this close to the message being answered are shown to the model. */
export const IMAGE_WINDOW_MS = 30 * 60_000
/** Originals bigger than this are skipped when no small preview exists (API limit is 5MB per image). */
export const MAX_ORIGINAL_BYTES = 3_500_000

export const isImage = (a: Att) => !!a?.path && IMAGE_TYPES.includes(String(a.type ?? '').toLowerCase())

/** Which stored file to send for a chat photo: the small preview if there is one, else the original when small enough. */
export function imageSource(a: Att): { path: string; mediaType: string } | null {
  if (!isImage(a)) return null
  if (a!.preview_path && a!.preview_path === `${a!.path}.preview.webp`) return { path: a!.preview_path, mediaType: 'image/webp' }
  if ((a!.size ?? 0) > MAX_ORIGINAL_BYTES) return null
  return { path: a!.path!, mediaType: String(a!.type).toLowerCase() }
}

/** Photos the requester sent recently (newest last, at most MAX_IMAGES), relative to the answered message. */
export function pickImages(rows: Row[], requesterId: string, answeredAt: string): { path: string; mediaType: string; name: string; at: string }[] {
  const end = Date.parse(answeredAt)
  const out: { path: string; mediaType: string; name: string; at: string }[] = []
  for (const r of rows) {
    if (r.user_id !== requesterId) continue
    const t = Date.parse(r.created_at)
    if (!(t <= end + 1000 && end - t <= IMAGE_WINDOW_MS)) continue
    const src = imageSource(r.attachment ?? null)
    if (src) out.push({ ...src, name: r.attachment?.name ?? '사진', at: r.created_at })
  }
  out.sort((a, b) => a.at.localeCompare(b.at))
  return out.slice(-MAX_IMAGES)
}

/** Text shown in the transcript line for a message that carries a file. */
export function attachmentNote(a: Att): string {
  if (!a?.path) return ''
  return isImage(a) ? ` [사진: ${a.name ?? '사진'}]` : ` [파일: ${a.name ?? '파일'}]`
}
