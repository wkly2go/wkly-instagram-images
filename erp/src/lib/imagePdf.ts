// 그림(JPEG) 여러 장 → PDF 한 부 (라이브러리 없이 · 화이트보드 PDF 내보내기 · 2026-11-27 대표 '작성 완료된 것들은 pdf로')
// 한 장 = 한 쪽 · 쪽 크기는 그림 비율 그대로(긴 변 842pt = A4 긴 변)

export interface PdfImage { jpeg: Uint8Array; width: number; height: number }

const enc = new TextEncoder()

export function imagesToPdf(images: PdfImage[], title = ''): Uint8Array {
  if (!images.length) throw new Error('PDF 에 넣을 그림이 없습니다.')
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); size += u.length }
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = size; push(`${n} 0 obj\n`); body.forEach(push); push('\nendobj\n') }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const pageCount = images.length
  // 1 카탈로그 · 2 쪽 목록 · 3 정보 · 이후 쪽마다 [쪽, 그림, 내용] 3개
  const pageIds = images.map((_, i) => 4 + i * 3)
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
  obj(2, [`<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`])
  const hex = Array.from(enc.encode(title)).length ? `<FEFF${Array.from(title).map(c => c.codePointAt(0)!).flatMap(cp => cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp]).map(u => u.toString(16).padStart(4, '0')).join('')}>` : '()'
  obj(3, [`<< /Title ${hex} /Producer (WKLY) >>`])
  images.forEach((im, i) => {
    const long = Math.max(im.width, im.height)
    const k = 842 / long
    const w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k))
    const page = pageIds[i], img = page + 1, content = page + 2
    obj(page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`])
    obj(img, [`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`, im.jpeg, '\nendstream'])
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
    obj(content, [`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`])
  })
  const total = 4 + pageCount * 3
  const xref = size
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let n = 1; n < total; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(table)
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
