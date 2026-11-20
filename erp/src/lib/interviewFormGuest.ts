// 인터뷰지 — 브랜드 담당자 쪽 통신 (/i/<토큰> · 로그인 없음). 서버 함수 두 개만 부른다: interview_form_get · interview_form_submit
// 토큰으로 그 인터뷰지 한 부만 열리고(표는 직접 못 봄), 쓰던 글은 이 브라우저에만 임시로 둔다.
import { guestFilePath, type FormQuestion } from './interviewForms'

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const FORM_TOKEN_RE = /^[0-9a-f]{36}$/
export type GuestQuestion = Omit<FormQuestion, 'use'>
export interface GuestFile { id: string; name: string; size: number | null; mime: string | null; path: string; at: string }
export interface GuestForm { files?: GuestFile[]; brand: string; title: string; intro: string; due_on: string | null; upload_on: string | null; closed: boolean; submitted_at: string | null; answers: Record<string, string>; respondent: string | null; image_consent: string | null; questions: GuestQuestion[] }
export type GuestResult<T> = ({ ok: true } & T) | { ok: false; reason: string; no?: string }
export interface GuestDraft { answers: Record<string, string>; respondent: string; contact: string; consent: string }

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<GuestResult<T>> {
  if (!BASE || !ANON) return { ok: false, reason: 'offline' }
  try {
    const r = await fetch(`${BASE}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` }, body: JSON.stringify(body), referrerPolicy: 'no-referrer' })
    if (!r.ok) return { ok: false, reason: 'server' }
    return (await r.json()) as GuestResult<T>
  } catch {
    return { ok: false, reason: 'network' }
  }
}
export const getGuestForm = (token: string) => rpc<GuestForm>('interview_form_get', { p_token: token })
export const submitGuestForm = (token: string, d: GuestDraft) =>
  rpc<{ answered: number }>('interview_form_submit', { p_token: token, p_answers: d.answers, p_respondent: d.respondent, p_contact: d.contact, p_image_consent: d.consent })

// 사진 · 자료 올리기 (2026-11-20): 비공개 보관함 interview-files 의 <토큰>/ 폴더로 바로 올리고(보관함 정책이 열린 인터뷰지 토큰 폴더만 허락),
// 올라간 뒤 interview_file_add 가 목록에 기록 · 담당자에게 알린다. 파일 이름(한글 등)은 목록에만 남기고 보관 경로는 영문 · 숫자로.
export const GUEST_FILE_MAX = 30 * 1024 * 1024
export const GUEST_FILE_LIMIT = 30
export const GUEST_FILE_ACCEPT = 'image/*,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.zip,.mp4,.mov'
export async function uploadGuestFile(token: string, file: File): Promise<GuestResult<{ files: GuestFile[] }>> {
  if (!BASE || !ANON) return { ok: false, reason: 'offline' }
  if (file.size > GUEST_FILE_MAX) return { ok: false, reason: 'too_big' }
  const path = guestFilePath(token, file.name)
  try {
    const up = await fetch(`${BASE}/storage/v1/object/interview-files/${path}`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-upsert': 'false', 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      referrerPolicy: 'no-referrer',
    })
    if (!up.ok) return { ok: false, reason: up.status === 413 ? 'too_big' : up.status === 400 || up.status === 415 ? 'bad_type' : up.status === 403 ? 'closed' : 'server' }
  } catch {
    return { ok: false, reason: 'network' }
  }
  return rpc<{ files: GuestFile[] }>('interview_file_add', { p_token: token, p_path: path, p_name: file.name, p_size: file.size, p_mime: file.type || null })
}
export async function removeGuestFile(token: string, f: GuestFile): Promise<GuestResult<{ files: GuestFile[] }>> {
  const r = await rpc<{ files: GuestFile[]; path: string | null }>('interview_file_remove', { p_token: token, p_id: f.id })
  if (r.ok && r.path && BASE && ANON) {
    // 보관함의 실제 파일도 지움 (실패해도 목록에서는 빠졌으므로 담당자에게 안 보임)
    try { await fetch(`${BASE}/storage/v1/object/interview-files/${r.path}`, { method: 'DELETE', headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }) } catch { /* 무시 */ }
  }
  return r
}
export const GUEST_FILE_REASONS: Record<string, string> = {
  too_big: '파일이 30MB 보다 큽니다. 줄이거나 나눠서 올려 주세요.',
  bad_type: '이 형식은 올릴 수 없습니다. 사진 · PDF · 문서 · 발표 · 한글 · 압축 · 영상 파일만 받습니다.',
  closed: '자료를 더 받을 수 없습니다(접수 마감 또는 30개 한도).',
  missing: '올리다가 끊겼습니다. 다시 올려 주세요.',
}

// 쓰던 글 임시 보관 (이 브라우저에만 · 보낸 뒤 지움). 저장소를 못 쓰는 브라우저에서는 조용히 건너뛴다
const key = (token: string) => `wkly-ivf-${token.slice(0, 16)}`
export function loadDraft(token: string): GuestDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(key(token)) ?? 'null') as Partial<GuestDraft> | null
    return d && typeof d.answers === 'object' && d.answers ? { answers: d.answers, respondent: d.respondent ?? '', contact: d.contact ?? '', consent: d.consent ?? '' } : null
  } catch { return null }
}
export function saveDraft(token: string, d: GuestDraft) { try { localStorage.setItem(key(token), JSON.stringify(d)) } catch { /* 보관 못 해도 작성은 계속 */ } }
export function clearDraft(token: string) { try { localStorage.removeItem(key(token)) } catch { /* 없음 */ } }
