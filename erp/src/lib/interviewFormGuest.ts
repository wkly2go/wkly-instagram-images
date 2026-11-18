// 인터뷰지 — 브랜드 담당자 쪽 통신 (/i/<토큰> · 로그인 없음). 서버 함수 두 개만 부른다: interview_form_get · interview_form_submit
// 토큰으로 그 인터뷰지 한 부만 열리고(표는 직접 못 봄), 쓰던 글은 이 브라우저에만 임시로 둔다.
import type { FormQuestion } from './interviewForms'

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const FORM_TOKEN_RE = /^[0-9a-f]{36}$/
export type GuestQuestion = Omit<FormQuestion, 'use'>
export interface GuestForm { brand: string; title: string; intro: string; due_on: string | null; upload_on: string | null; closed: boolean; submitted_at: string | null; answers: Record<string, string>; respondent: string | null; image_consent: string | null; questions: GuestQuestion[] }
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
