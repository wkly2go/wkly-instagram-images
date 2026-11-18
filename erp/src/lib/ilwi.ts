// 일위대가 (2026-11-18 대표 지시 '일위대가와 일반 인테리어를 분리해서 개발해')
// 단위당 재료비 + 노무비 + 경비. 일반 인테리어 견적(판매 단가 · 수량표)과 따로 두며 견적 계산에는 끼어들지 않는다.
// 금액은 DB 보기(design_ilwi_items · design_ilwi_lines)가 물가 기준 · 노임단가로 계산한다. 여기 계산은 화면 미리보기 · 시험용으로 같은 규칙.
import type { PriceRef } from './design'

export type IlwiKind = 'material' | 'labor' | 'expense'
export const ILWI_KINDS: Record<IlwiKind, string> = { material: '재료비', labor: '노무비', expense: '경비' }
export interface LaborRate { code: string; name: string; wage: number; as_of: string; low_sample: boolean; source: string }
export interface IlwiItem { id: string; code: string; trade_code: string | null; name: string; spec: string; unit: string; basis: string; note: string | null; active: boolean; updated_at: string; material: number; labor: number; expense: number; total: number; lines: number; missing: number }
export interface IlwiLine { id: string; item_id: string; kind: IlwiKind; ref_code: string | null; name: string; spec: string; unit: string; qty: number; unit_price: number | null; pct: number | null; sort: number; price: number | null; price_source: string | null; price_date: string | null; amount: number | null }
export type IlwiItemDraft = Pick<IlwiItem, 'code' | 'trade_code' | 'name' | 'spec' | 'unit' | 'basis' | 'note'>
export type IlwiLineDraft = Pick<IlwiLine, 'item_id' | 'kind' | 'ref_code' | 'name' | 'spec' | 'unit' | 'qty' | 'unit_price' | 'pct'>

export interface IlwiApi {
  listIlwiItems(): Promise<IlwiItem[]>
  listIlwiLines(itemId: string): Promise<IlwiLine[]>
  /** 관리자: 항목 만들기 · 고치기 (id 없으면 새로) — 만든 항목의 id */
  saveIlwiItem(id: string | null, draft: IlwiItemDraft): Promise<string>
  deleteIlwiItem(id: string): Promise<void>
  addIlwiLines(rows: IlwiLineDraft[]): Promise<void>
  updateIlwiLine(id: string, patch: Partial<Pick<IlwiLine, 'qty' | 'unit_price' | 'pct' | 'name' | 'spec' | 'unit'>>): Promise<void>
  deleteIlwiLine(id: string): Promise<void>
  listLaborRates(): Promise<LaborRate[]>
}

/** 줄 금액: %로 적은 경비는 노무비 합계가 나온 뒤에 계산하므로 null */
export const lineAmount = (l: Pick<IlwiLine, 'qty' | 'price' | 'pct'>) => (l.pct != null || l.price == null ? null : Math.round(Number(l.qty) * Number(l.price)))
/** 항목 합계 (DB 보기 design_ilwi_items 와 같은 규칙): 경비 = 금액 줄 + 노무비 × % 줄 */
export function ilwiTotals(lines: Pick<IlwiLine, 'kind' | 'qty' | 'price' | 'pct'>[]) {
  const sum = (k: IlwiKind) => lines.filter(l => l.kind === k).reduce((a, l) => a + (lineAmount(l) ?? 0), 0)
  const material = sum('material'), labor = sum('labor')
  const pct = lines.filter(l => l.kind === 'expense' && l.pct != null).reduce((a, l) => a + Number(l.pct), 0)
  const expense = sum('expense') + Math.round((pct / 100) * labor)
  return { material, labor, expense, total: material + labor + expense, missing: lines.filter(l => l.pct == null && l.price == null).length }
}
/** 다음 항목 번호 IW-001, IW-002 … */
export function nextIlwiCode(codes: string[]) {
  const max = codes.reduce((m, c) => Math.max(m, Number(/^IW-(\d+)$/.exec(c)?.[1] ?? 0)), 0)
  return `IW-${String(max + 1).padStart(3, '0')}`
}
/** 물가 기준 한 줄 → 재료 줄 (단가는 적지 않는다 — 기호로 이어 두어 물가가 바뀌면 따라 바뀜) */
export const materialLine = (itemId: string, r: PriceRef, qty: number): IlwiLineDraft => ({ item_id: itemId, kind: 'material', ref_code: r.code ?? null, name: r.item, spec: r.spec, unit: r.unit, qty, unit_price: r.code ? null : r.price, pct: null })
export const laborLine = (itemId: string, w: LaborRate, qty: number): IlwiLineDraft => ({ item_id: itemId, kind: 'labor', ref_code: w.code, name: w.name, spec: '', unit: '인', qty, unit_price: null, pct: null })
/**
 * 조달청 시장시공가격(재료 · 노무 · 경비가 나뉜 시공 단가) 한 줄을 일위대가로 가져올 때의 항목 · 줄.
 * 그때의 금액을 그대로 적어 둔다(직접 입력) — 근거에 기호 · 기준일을 남긴다.
 */
export function fromMarketRef(r: PriceRef, code: string): { item: IlwiItemDraft; lines: Omit<IlwiLineDraft, 'item_id'>[] } {
  const part = (kind: IlwiKind, v: number | null): Omit<IlwiLineDraft, 'item_id'>[] => (v && v > 0 ? [{ kind, ref_code: null, name: `${ILWI_KINDS[kind]} (조달청 시장시공가격)`, spec: '', unit: r.unit, qty: 1, unit_price: Math.round(v), pct: null }] : [])
  const lines = [...part('material', r.material), ...part('labor', r.labor), ...part('expense', r.expense)]
  return {
    item: { code, trade_code: null, name: r.item, spec: r.spec, unit: r.unit, basis: `${r.source_name} ${r.code ?? ''} · ${r.notice_date ?? ''}`.trim(), note: null },
    lines: lines.length ? lines : [{ kind: 'material', ref_code: r.code ?? null, name: r.item, spec: r.spec, unit: r.unit, qty: 1, unit_price: r.code ? null : r.price, pct: null }],
  }
}
