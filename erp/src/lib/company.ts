/**
 * 회사 구분 (대표 지시 2026-11-18 '더위클리와 아트리어 회계 구분 · 업체도 각 회사 구분')
 *  - 아트리어 = 주식회사 아트리어디자인스튜디오 (302-88-02334) · 프로젝트 연번 AR
 *  - 더위클리 = 더위클리컴퍼니 · 프로젝트 연번 TW · 공통 회사운영업무 RS 도 더위클리 쪽(드라이브 #WKLY_연도와 같음)
 * 고른 회사는 이 브라우저에 기억(wkly-company) · 입출금 장부 · 결제 대장 · 세금계산서 · 거래처가 같이 따름
 */
import { useSyncExternalStore } from 'react'

export type CompanyKey = 'AR' | 'TW'
export type CompanyPick = CompanyKey | 'all'
export const COMPANY_KEYS: CompanyKey[] = ['AR', 'TW']
export const COMPANIES: Record<CompanyKey, { label: string; full: string; biz: string | null; color: string }> = {
  AR: { label: '아트리어', full: '아트리어디자인스튜디오', biz: '302-88-02334', color: '#8a6d3b' },
  TW: { label: '더위클리', full: '더위클리컴퍼니', biz: null, color: '#1f6b4a' },
}

const KEY = 'wkly-company'
const read = (): CompanyPick => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'AR' || v === 'TW' ? v : 'all'
  } catch {
    return 'all'
  }
}
let current: CompanyPick = read()
const subs = new Set<() => void>()
export const getCompany = () => current
export function setCompany(v: CompanyPick) {
  current = v
  try { localStorage.setItem(KEY, v) } catch { /* 기억 못 해도 화면은 바뀜 */ }
  subs.forEach(f => f())
}
export function useCompany(): CompanyPick {
  return useSyncExternalStore(f => (subs.add(f), () => void subs.delete(f)), getCompany, getCompany)
}

/** 프로젝트 → 회사 (연번 앞 두 글자 · 없으면 구분 칸) */
export function companyOfProject(p: { code?: string | null; division?: string | null } | null | undefined): CompanyKey | null {
  if (!p) return null
  const d = (p.code ?? '').slice(0, 2).toUpperCase() || (p.division ?? '').toUpperCase()
  if (d === 'AR') return 'AR'
  if (d === 'TW' || d === 'RS') return 'TW'
  return null
}
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
/** 세금계산서 → 회사 (우리 쪽 사업자번호 · 이름) */
export function companyOfInvoice(inv: { our_biz_no?: string | null; our_name?: string | null }): CompanyKey {
  if (digits(inv.our_biz_no) === digits(COMPANIES.AR.biz)) return 'AR'
  if (/위클리|weekly/i.test(inv.our_name ?? '')) return 'TW'
  return /아트리어|아크리어|arterior/i.test(inv.our_name ?? '') ? 'AR' : 'TW'
}
export const inCompany = (pick: CompanyPick, c: CompanyKey | null | undefined) => pick === 'all' || c === pick
