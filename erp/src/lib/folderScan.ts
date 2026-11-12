/**
 * 회계 자료 폴더 전체 읽기 (대표 지시 2026-11-12 "폴더에 있는 모든 파일을 읽을 수 있는 스킬을 만들어")
 *  - 하위 폴더를 끝까지(최대 8단계) 내려가며 모든 파일을 찾음 (예전에는 한 단계 아래까지만 봄)
 *  - 엑셀 · CSV · 구글 시트는 장부에 기입, zip 은 풀어서 안의 엑셀 · CSV 를 기입
 *  - PDF · 이미지 · 한글/워드 등은 '읽지 않은 파일' 목록에 종류와 함께 보여 줌
 *  - 연말정산 · 근로계약 등 개인 자료 폴더는 열지 않음 (주민번호 저장 금지 규칙)
 */
import { FOLDER_MIME, listChildren, type GFile } from './gdrive'

export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
/** 개인 자료라 열지 않는 폴더 · 파일 이름 */
export const PRIVATE_RE = /연말정산|근로계약|주민등록|인사기록|급여명세|원천징수영수증|신분증|가족관계/
export const SHEET_RE = /\.(xlsx|xls|csv)$/i

export type FileKind = '장부 자료' | '압축' | 'PDF' | '이미지' | '문서' | '프로그램' | '개인 자료' | '기타'
export function fileKind(name: string, mime = ''): FileKind {
  if (PRIVATE_RE.test(name)) return '개인 자료'
  if (mime === SHEET_MIME || SHEET_RE.test(name)) return '장부 자료'
  if (/\.zip$/i.test(name) || mime === 'application/zip') return '압축'
  if (/\.pdf$/i.test(name) || mime === 'application/pdf') return 'PDF'
  if (/\.(png|jpe?g|gif|heic|webp|bmp)$/i.test(name) || mime.startsWith('image/')) return '이미지'
  if (/\.(hwp|hwpx|docx?|pptx?|txt|md)$/i.test(name) || mime.startsWith('application/vnd.google-apps.')) return '문서'
  if (/\.(exe|msi|dmg|apk)$/i.test(name)) return '프로그램'
  return '기타'
}

export interface ScannedFile {
  file: GFile
  /** 회계 자료 폴더부터의 경로 (예: '#A2025 결산 › 25년 4분기 부가세 › 우리카드') */
  path: string
  kind: FileKind
}

/** 드라이브 폴더를 끝까지 내려가며 모든 파일 목록 (개인 자료 폴더는 들어가지 않음) */
export async function scanDriveFolder(token: string, rootIds: string[], maxDepth = 8): Promise<{ files: ScannedFile[]; skippedFolders: string[] }> {
  const files: ScannedFile[] = []
  const skippedFolders: string[] = []
  const seen = new Set<string>()
  const queue: { id: string; path: string; depth: number }[] = [...new Set(rootIds.filter(Boolean))].map(id => ({ id, path: '', depth: 0 }))
  while (queue.length) {
    const { id, path, depth } = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const list = await listChildren(token, id).catch(() => [] as GFile[])
    for (const f of list) {
      const here = path ? `${path} › ${f.name}` : f.name
      if (f.mimeType === FOLDER_MIME) {
        if (PRIVATE_RE.test(f.name)) skippedFolders.push(here)
        else if (depth + 1 < maxDepth) queue.push({ id: f.id, path: here, depth: depth + 1 })
        continue
      }
      if (seen.has(f.id)) continue
      seen.add(f.id)
      files.push({ file: f, path: path || '(맨 위)', kind: fileKind(f.name, f.mimeType) })
    }
  }
  return { files, skippedFolders }
}

/** zip 을 풀어 안의 엑셀 · CSV 만 꺼냄 (한글 파일 이름이 깨져도 확장자로 판단) */
export async function sheetsInZip(data: ArrayBuffer): Promise<{ name: string; data: ArrayBuffer }[]> {
  const { unzipSync } = await import('fflate')
  const out: { name: string; data: ArrayBuffer }[] = []
  const entries = unzipSync(new Uint8Array(data), { filter: f => SHEET_RE.test(f.name) && !/(^|\/)__MACOSX\//.test(f.name) && !PRIVATE_RE.test(f.name) })
  for (const [name, bytes] of Object.entries(entries)) {
    if (!bytes.length) continue
    const copy = new Uint8Array(bytes.length)
    copy.set(bytes)
    out.push({ name: name.split('/').pop() || name, data: copy.buffer })
  }
  return out
}
