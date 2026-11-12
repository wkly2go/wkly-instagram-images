/** 원본은 그대로 두고, 긴 변 640px · 최대 96KB의 미리보기를 별도로 만든다. */
export const PREVIEW_MAX_BYTES = 96 * 1024
export function previewSize(width: number, height: number, edge = 640) {
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height)) throw new Error('사진 크기를 확인할 수 없습니다.')
  const scale = Math.min(1, edge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
export const sitePreviewPath = (path: string) => /\/preview-v1-[^/]+$/.test(path) ? `${path}.preview.webp` : null

export async function makeImagePreview(file: File): Promise<Blob | null> {
  if (!/^image\/(jpeg|png|webp|avif|gif)$/.test(file.type) || typeof document === 'undefined') return null
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      const timer = window.setTimeout(() => reject(new Error('사진 미리보기 시간 초과')), 15_000)
      image.onload = () => { window.clearTimeout(timer); resolve(image) }
      image.onerror = () => { window.clearTimeout(timer); reject(new Error('사진을 읽지 못했습니다.')) }
      image.src = url
    })
    const canvas = document.createElement('canvas')
    for (const edge of [640, 480, 320]) {
      Object.assign(canvas, previewSize(img.naturalWidth, img.naturalHeight, edge))
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.72))
      if (blob && blob.size <= PREVIEW_MAX_BYTES) return blob
    }
    return null
  } catch {
    return null // 미리보기 생성 실패 때문에 원본 업로드를 막지 않는다.
  } finally { URL.revokeObjectURL(url) }
}
