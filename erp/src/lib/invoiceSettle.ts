// 세금계산서 ↔ 은행 · 카드 거래 대사 (대표 지시 2026-11-12 "계산서와 은행거래장부와 대조해서 장부 완성해")
// 계산서마다 실제로 받은 · 낸 돈(settled)과 짝지어진 장부 줄(ledger_ids)을 정함. 단계:
//  0) 수정 발행(마이너스) 계산서 ↔ 같은 거래처 · 같은 금액 원 계산서 서로 지움
//  1) 한 번에: 같은 금액 · 발행 45일 전 ~ 60일 뒤 (이름이 맞거나, 이미 증빙이 붙었거나, 7일 안 개인 사업자 · 신탁사)
//  2) 나눠서: 거래처 이름이 같은 입출금을 날짜순으로 계산서 순서대로 채움 (계약금 · 잔금)
//  3) 개인 사업자: 통장에 대표 이름으로 찍힌 같은 금액 (발행 30일 전 ~ 90일 뒤, 가까운 것부터)
//  4) 같은 금액이 그 기간에 계산서도 거래도 하나뿐
//  5) 카드로 낸 것 (±10일)
//  6) 두 번에 나눠 낸 돈 (같은 상대에게 두 번 = 계산서 금액)
//  7) 계산서 두 장을 한 번에 낸 돈
//  8) 늦게 받은 계산서: 이름이 맞는 거래가 발행 200일 전까지 있으면 (한 번 또는 두 번 합)
//  9) 끝전 차이: 남은 돈이 계산서의 1% 이하이면서 20만 원 이하 (끝자리 떼고 보냄 · 수수료)
export interface SettleInvoice {
  id: string
  direction: '매출' | '매입'
  write_date: string
  partner_name: string | null
  total: number
}
export interface SettleRow {
  id: number
  entry_date: string
  direction: '입금' | '출금'
  amount: number
  method: string
  evidence?: string | null
  counterparty: string | null
  memo: string | null
}
export interface Settlement {
  settled: number
  ledger_ids: number[]
  how: string[]
}

const day = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / 864e5)
const norm = (s: string) => s.toLowerCase().replace(/\(주\)|（주）|주식회사|㈜|\s/g, '')
export const partnerKey = (s: string | null) => norm((s ?? '').replace(/[(（][^)）]*[)）]/g, '')).slice(0, 4)

export function settleInvoices(invoices: SettleInvoice[], rows: SettleRow[], staff: string[] = []): Map<string, Settlement> {
  const staffSet = new Set(staff)
  const iv = invoices
    .filter(i => i.total)
    .map(i => ({ id: i.id, dir: (i.direction === '매출' ? '입금' : '출금') as '입금' | '출금', wd: day(i.write_date), tot: Math.abs(i.total), neg: i.total < 0, p: partnerKey(i.partner_name) }))
    .sort((a, b) => a.wd - b.wd)
  const lg = rows.map(r => ({
    id: r.id,
    dir: r.direction,
    d: day(r.entry_date),
    amt: r.amount,
    card: r.method === '카드',
    ev: r.evidence ?? null,
    n: norm(`${r.counterparty ?? ''}${r.memo ?? ''}`),
    cp: (r.counterparty ?? '').replace(/\s/g, ''),
  }))
  const out = new Map<string, Settlement>(iv.map(i => [i.id, { settled: 0, ledger_ids: [], how: [] }]))
  const usedRow = new Map<number, number>()
  const ileft = (i: (typeof iv)[number]) => i.tot - out.get(i.id)!.settled
  const lleft = (l: (typeof lg)[number]) => l.amt - (usedRow.get(l.id) ?? 0)
  const fresh = (i: (typeof iv)[number]) => out.get(i.id)!.settled === 0 && !out.get(i.id)!.how.length
  const person = (cp: string) => /^[가-힣]{2,4}([（(].*)?$/.test(cp) && !staffSet.has(cp)
  const hit = (l: (typeof lg)[number], p: string) => !!p && l.n.includes(p)
  const give = (i: (typeof iv)[number], l: (typeof lg)[number] | null, amt: number, how: string) => {
    const s = out.get(i.id)!
    s.settled += amt
    if (l) {
      if (!s.ledger_ids.includes(l.id)) s.ledger_ids.push(l.id)
      usedRow.set(l.id, (usedRow.get(l.id) ?? 0) + amt)
    }
    if (!s.how.includes(how)) s.how.push(how)
  }
  const bank = lg.filter(l => !l.card)

  // 0) 수정 발행
  for (const neg of iv.filter(i => i.neg)) {
    if (!fresh(neg)) continue
    const pair = iv
      .filter(i => !i.neg && i.dir === neg.dir && i.p === neg.p && i.tot === neg.tot && fresh(i))
      .sort((a, b) => Math.abs(a.wd - neg.wd) - Math.abs(b.wd - neg.wd) || (a.wd <= neg.wd ? -1 : 1))[0]
    give(neg, null, neg.tot, '수정 발행 취소')
    if (pair) give(pair, null, pair.tot, '수정 발행 취소')
  }
  // 1) 한 번에
  for (const i of iv) {
    if (!fresh(i)) continue
    const c = bank
      .filter(l => l.dir === i.dir && l.amt === i.tot && l.d - i.wd >= -45 && l.d - i.wd <= 60 && lleft(l) === l.amt)
      .filter(l => hit(l, i.p) || l.ev === '세금계산서' || (Math.abs(l.d - i.wd) <= 7 && (person(l.cp) || l.n.includes('신탁'))))
      .sort((a, b) => Number(hit(b, i.p)) - Number(hit(a, i.p)) || Math.abs(a.d - i.wd) - Math.abs(b.d - i.wd))[0]
    if (c) give(i, c, i.tot, '한 번에')
  }
  // 2) 나눠서
  const groups = new Map<string, typeof iv>()
  for (const i of iv) if (i.p && ileft(i) > 0 && !i.neg) groups.set(`${i.dir}|${i.p}`, [...(groups.get(`${i.dir}|${i.p}`) ?? []), i])
  for (const list of groups.values()) {
    const first = list[0].wd
    const pays = bank.filter(l => l.dir === list[0].dir && hit(l, list[0].p) && l.d >= first - 45 && lleft(l) > 0).sort((a, b) => a.d - b.d)
    for (const l of pays) {
      let pot = lleft(l)
      for (const i of list) {
        if (pot <= 0) break
        const take = Math.min(pot, ileft(i))
        if (take <= 0) continue
        give(i, l, take, '나눠서')
        pot -= take
      }
    }
  }
  // 가까운 짝부터 하나씩 (같은 금액 · 한 줄)
  const greedy = (cands: { i: (typeof iv)[number]; l: (typeof lg)[number]; gap: number }[], how: string) => {
    for (const c of cands.sort((a, b) => a.gap - b.gap)) if (fresh(c.i) && lleft(c.l) === c.l.amt) give(c.i, c.l, c.i.tot, how)
  }
  const open = () => iv.filter(i => !i.neg && fresh(i))
  // 3) 개인 사업자
  greedy(
    open().flatMap(i => bank.filter(l => l.dir === i.dir && l.amt === i.tot && l.d - i.wd >= -30 && l.d - i.wd <= 90 && !l.ev && person(l.cp)).map(l => ({ i, l, gap: Math.abs(l.d - i.wd) }))),
    '한 번에 (대표 이름)',
  )
  // 4) 금액이 하나뿐
  {
    const cands: { i: (typeof iv)[number]; l: (typeof lg)[number]; gap: number }[] = []
    for (const i of open()) {
      const ls = bank.filter(l => l.dir === i.dir && l.amt === i.tot && l.d - i.wd >= -30 && l.d - i.wd <= 90 && lleft(l) === l.amt)
      if (ls.length !== 1 || ls[0].ev) continue
      const l = ls[0]
      const others = open().filter(j => j.dir === i.dir && j.tot === l.amt && l.d - j.wd >= -30 && l.d - j.wd <= 90)
      if (others.length === 1) cands.push({ i, l, gap: Math.abs(l.d - i.wd) })
    }
    greedy(cands, '한 번에 (금액 하나뿐)')
  }
  // 5) 카드
  greedy(
    open()
      .filter(i => i.dir === '출금')
      .flatMap(i => {
        const ls = lg.filter(l => l.card && l.dir === '출금' && l.amt === i.tot && Math.abs(l.d - i.wd) <= 10 && lleft(l) === l.amt)
        return ls.filter(l => hit(l, i.p) || ls.length === 1).map(l => ({ i, l, gap: Math.abs(l.d - i.wd) }))
      }),
    '카드',
  )
  // 6) 두 번에
  for (const i of open()) {
    const ls = bank.filter(l => l.dir === i.dir && l.d - i.wd >= -45 && l.d - i.wd <= 120 && l.cp && lleft(l) === l.amt && (hit(l, i.p) || person(l.cp)))
    let best: [typeof ls[number], typeof ls[number]] | null = null
    let bg = Infinity
    for (let a = 0; a < ls.length; a++)
      for (let b = a + 1; b < ls.length; b++) {
        if (ls[a].cp !== ls[b].cp || ls[a].amt + ls[b].amt !== i.tot) continue
        const g = Math.abs(ls[a].d - i.wd) + Math.abs(ls[b].d - i.wd)
        if (g < bg) {
          bg = g
          best = [ls[a], ls[b]]
        }
      }
    if (best) for (const l of best) give(i, l, l.amt, '두 번에')
  }
  // 7) 계산서 두 장을 한 번에
  const rest = open()
  for (let a = 0; a < rest.length; a++)
    for (let b = a + 1; b < rest.length; b++) {
      const i = rest[a]
      const j = rest[b]
      if (!fresh(i) || !fresh(j) || i.dir !== j.dir || !i.p || i.p !== j.p) continue
      const lo = Math.min(i.wd, j.wd) - 15
      const hi = Math.max(i.wd, j.wd) + 90
      const l = bank
        .filter(x => x.dir === i.dir && x.amt === i.tot + j.tot && x.d >= lo && x.d <= hi && lleft(x) === x.amt && (hit(x, i.p) || person(x.cp)))
        .sort((x, y) => x.d - y.d)[0]
      if (!l) continue
      give(i, l, i.tot, '여러 계산서 한 번에')
      give(j, l, j.tot, '여러 계산서 한 번에')
    }
  // 8) 늦게 받은 계산서
  for (const i of open()) {
    if (!i.p) continue
    const ls = bank.filter(l => l.dir === i.dir && l.d - i.wd >= -200 && l.d - i.wd <= 120 && lleft(l) === l.amt && hit(l, i.p))
    const one = ls.filter(l => l.amt === i.tot).sort((a, b) => Math.abs(a.d - i.wd) - Math.abs(b.d - i.wd))[0]
    if (one) {
      give(i, one, i.tot, '늦게 받은 계산서')
      continue
    }
    pair: for (let a = 0; a < ls.length; a++)
      for (let b = a + 1; b < ls.length; b++)
        if (ls[a].amt + ls[b].amt === i.tot) {
          give(i, ls[a], ls[a].amt, '늦게 받은 계산서')
          give(i, ls[b], ls[b].amt, '늦게 받은 계산서')
          break pair
        }
  }
  // 9) 끝전 차이
  for (const i of iv) {
    const left = ileft(i)
    if (left > 0 && out.get(i.id)!.settled > 0 && left <= Math.min(200_000, i.tot * 0.01)) give(i, null, left, '끝전 차이')
  }
  return out
}

/** 운영 데이터로 대사를 다시 돌려 바뀐 계산서만 저장 (계산서 기준 탭 '다시 대사' · 자료를 새로 올린 뒤 자동) */
export async function runSettlement(api: import('./api').Api): Promise<{ changed: number; open: number }> {
  const [invoices, people] = await Promise.all([api.listTaxInvoices(), api.listProfiles().catch(() => [])])
  if (!invoices.length) return { changed: 0, open: 0 }
  const first = invoices.reduce((m, i) => (i.write_date < m ? i.write_date : m), '9999-12-31')
  const last = invoices.reduce((m, i) => (i.write_date > m ? i.write_date : m), '0000-01-01')
  const shift = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
  const rows = (await api.listLedger(shift(first, -200), shift(last, 120))).filter(r => !r.is_transfer && (r.method === '계좌' || r.method === '카드'))
  const res = settleInvoices(invoices, rows, people.map(p => p.name).filter(Boolean))
  const changed = invoices
    .filter(i => i.total)
    .map(i => {
      const s = res.get(i.id)!
      return { id: i.id, settled: s.settled, ledger_ids: s.ledger_ids.length ? s.ledger_ids : null, settle_how: s.how.length ? s.how.join(' · ') : null, before: i }
    })
    .filter(x => x.before.settled !== x.settled || (x.before.settle_how ?? null) !== x.settle_how || (x.before.ledger_ids ?? []).join(',') !== (x.ledger_ids ?? []).join(','))
  if (changed.length) await api.saveTaxSettlement(changed.map(({ before: _b, ...r }) => r))
  const open = invoices.filter(i => i.total > 0 && Math.abs(i.total) - (res.get(i.id)?.settled ?? 0) > 0).length
  return { changed: changed.length, open }
}
