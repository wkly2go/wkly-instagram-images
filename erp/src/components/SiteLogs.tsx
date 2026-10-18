import { Fragment, useMemo, useState } from 'react'
import { Plus, Printer, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate, todayKey, weekday } from '../lib/date'
import { SITE_MATERIAL_ITEMS, SITE_SIGNERS, SITE_TRADES, type Project, type SiteLabor, type SiteLog, type SiteMaterial, type SiteSigner } from '../lib/types'
import { Board } from './Board'
import { Button, SectionHead } from './ui'
import { useSuppressDetail } from './RightPanel'

/**
 * 인테리어 현장 작업일지 (대표 지시 2026-10-18 · 엑셀 '작업일지' 양식)
 *  - 프로젝트 · 날짜마다 한 장, 새 장은 직전 장의 공종 · 협력사 · 단가를 이어받고 인원 · 금액만 비움
 *  - 금일 계 = 주간 + 야간, 금일 지급 = 금일 계 × 단가, 누계 = 이 날짜까지 모든 장의 합
 *  - 주민번호 · 계좌번호는 적지 않음 (지급은 결제 대장)
 */
const won = (n: number) => (n ? Math.round(n).toLocaleString('ko-KR') : '-')
const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v.replace(/[^\d.]/g, '')) || 0))
const laborKey = (l: Pick<SiteLabor, 'group' | 'trade'>) => `${l.group}|${l.trade}`
const dayTotal = (l: SiteLabor) => (l.day || 0) + (l.night || 0)

function blankLabor(): SiteLabor[] {
  return SITE_TRADES.map(([group, trade, contract]) => ({ group, trade, contract, day: 0, night: 0, unit_price: 0, vendor: '' }))
}
function blankMaterials(): SiteMaterial[] {
  return SITE_MATERIAL_ITEMS.map(item => ({ item, spec: '', qty: 0, amount: 0, vendor: '' }))
}

/** 프로젝트 상세 안 '현장 작업일지' 칸. always 가 아니면 작업일지가 있을 때만 보임 */
export function SiteLogsSection({ project, always }: { project: Project; always?: boolean }) {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const { data: logs } = useAsync(() => api.listSiteLogs(project.id), [project.id, version], [] as SiteLog[])
  const [open, setOpen] = useState<SiteLog | 'new' | null>(null)
  useSuppressDetail(!!open)
  if (!always && logs.length === 0) return null
  const create = async () => {
    const today = todayKey()
    const exist = logs.find(l => l.log_date === today)
    if (exist) return setOpen(exist)
    const prev = logs[0]
    let created: SiteLog | null = null
    const ok = await run(async () => {
      created = await api.saveSiteLog({
        project_id: project.id,
        log_date: today,
        weather: null,
        site_manager: prev?.site_manager ?? null,
        staff: prev?.staff ?? null,
        // 직전 장의 공종 · 계약 · 단가 · 협력사는 이어받고 인원 · 금액만 비움
        labor: prev ? prev.labor.map(l => ({ ...l, day: 0, night: 0 })) : blankLabor(),
        materials: prev ? prev.materials.map(m => ({ ...m, qty: 0, amount: 0 })) : blankMaterials(),
        today_work: null,
        next_work: prev?.next_work ?? null,
        photos: [],
        signs: {},
      })
    }, '오늘 작업일지를 만들었습니다.')
    if (ok && created) setOpen(created)
  }
  return (
    <div className="col gap-6">
      <SectionHead
        title="현장 작업일지"
        count={logs.length ? `${logs.length}장` : undefined}
        right={
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={create}>
            <Plus size={12} /> 오늘 작업일지
          </button>
        }
      />
      <Board<SiteLog>
        rows={logs}
        rowKey={l => l.id}
        compact
        onRow={l => setOpen(l)}
        empty="아직 작업일지가 없습니다. '오늘 작업일지'를 누르면 엑셀 양식과 같은 일지가 만들어집니다."
        cols={[
          { key: 'date', label: '작성일자', width: 90, cell: l => <span className="t-meta">{shortDate(l.log_date)} ({weekday(l.log_date)})</span> },
          { key: 'weather', label: '날씨', width: 56, cell: l => l.weather || '-' },
          {
            key: 'work',
            label: '금일 공정',
            kind: 'title',
            cell: l => <span className="t-small">{(l.today_work ?? '').split('\n')[0] || '-'}</span>,
          },
          { key: 'crew', label: '인원(주/야)', width: 80, kind: 'num', cell: l => `${l.labor.reduce((n, x) => n + (x.day || 0), 0)} / ${l.labor.reduce((n, x) => n + (x.night || 0), 0)}` },
          { key: 'pay', label: '금일 지급', width: 96, kind: 'num', cell: l => won(l.labor.reduce((n, x) => n + dayTotal(x) * (x.unit_price || 0), 0) + l.materials.reduce((n, m) => n + (m.amount || 0), 0)) },
          {
            key: 'sign',
            label: '결재',
            width: 64,
            kind: 'center',
            cell: l => (
              <span className="site-sign-dots" title={SITE_SIGNERS.map(k => `${k} ${l.signs[k] ? '✓' : '-'}`).join(' · ')}>
                {SITE_SIGNERS.map(k => (
                  <i key={k} className={l.signs[k] ? 'on' : ''} />
                ))}
              </span>
            ),
          },
        ]}
      />
      {open && open !== 'new' && <SiteLogSheet key={open.id} log={open} all={logs} project={project} onClose={() => setOpen(null)} />}
    </div>
  )
}

function SiteLogSheet({ log, all, project, onClose }: { log: SiteLog; all: SiteLog[]; project: Project; onClose: () => void }) {
  const { api, me, profileName } = useApp()
  const { busy, run } = useAction()
  const [d, setD] = useState<SiteLog>(() => structuredClone(log))
  const set = (p: Partial<SiteLog>) => setD(prev => ({ ...prev, ...p }))
  const setLabor = (i: number, p: Partial<SiteLabor>) => set({ labor: d.labor.map((l, j) => (j === i ? { ...l, ...p } : l)) })
  const setMat = (i: number, p: Partial<SiteMaterial>) => set({ materials: d.materials.map((m, j) => (j === i ? { ...m, ...p } : m)) })
  const canDelete = me.role === 'admin' || log.created_by === me.id

  // 누계: 이 날짜까지의 다른 장 + 지금 고치는 장
  const before = useMemo(() => all.filter(x => x.id !== log.id && x.log_date <= d.log_date), [all, log.id, d.log_date])
  const laborCum = (l: SiteLabor) => before.reduce((n, x) => n + x.labor.filter(y => laborKey(y) === laborKey(l)).reduce((a, y) => a + dayTotal(y), 0), 0) + dayTotal(l)
  const matCum = (m: SiteMaterial) => before.reduce((n, x) => n + x.materials.filter(y => y.item === m.item).reduce((a, y) => a + (y.amount || 0), 0), 0) + (m.amount || 0)
  const groups = useMemo(() => {
    const out: { group: string; rows: { l: SiteLabor; i: number }[] }[] = []
    d.labor.forEach((l, i) => {
      const g = out.find(x => x.group === l.group)
      if (g) g.rows.push({ l, i })
      else out.push({ group: l.group, rows: [{ l, i }] })
    })
    return out
  }, [d.labor])
  const tot = {
    day: d.labor.reduce((n, l) => n + (l.day || 0), 0),
    night: d.labor.reduce((n, l) => n + (l.night || 0), 0),
    pay: d.labor.reduce((n, l) => n + dayTotal(l) * (l.unit_price || 0), 0),
    mat: d.materials.reduce((n, m) => n + (m.amount || 0), 0),
    matCum: d.materials.reduce((n, m) => n + matCum(m), 0),
  }
  const save = async () => {
    const ok = await run(
      () =>
        api.saveSiteLog({
          id: d.id,
          log_date: d.log_date,
          weather: d.weather?.trim() || null,
          site_manager: d.site_manager?.trim() || null,
          staff: d.staff?.trim() || null,
          labor: d.labor.filter(l => l.trade.trim()),
          materials: d.materials.filter(m => m.item.trim()),
          today_work: d.today_work?.trim() || null,
          next_work: d.next_work?.trim() || null,
          photos: d.photos.filter(p => p.label.trim() || p.url.trim()),
        }),
      '작업일지를 저장했습니다.',
    )
    if (ok) onClose()
  }
  const sign = (k: SiteSigner) => {
    const cur = d.signs[k]
    if (k === '대표' && me.role !== 'admin') return
    if (cur && cur.by !== me.id && me.role !== 'admin') return
    const signs = { ...d.signs }
    if (cur) delete signs[k]
    else signs[k] = { by: me.id, at: new Date().toISOString() }
    set({ signs })
    run(() => api.saveSiteLog({ id: d.id, signs }), cur ? `${k} 결재를 취소했습니다.` : `${k} 결재했습니다.`)
  }
  return (
    <div className="sitelog-panel">
      <div className="sitelog-bar no-print">
        <b className="grow">
          작업일지 · {shortDate(d.log_date)} ({weekday(d.log_date)})
        </b>
        {canDelete && (
          <Button kind="ghost" size="sm" disabled={busy} onClick={async () => window.confirm('이 작업일지를 삭제할까요?') && (await run(() => api.deleteSiteLog(d.id), '삭제했습니다.')) && onClose()}>
            <Trash2 size={12} /> 삭제
          </Button>
        )}
        <Button kind="outline" size="sm" onClick={() => window.print()}>
          <Printer size={12} /> 인쇄
        </Button>
        <Button kind="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
        <Button size="sm" disabled={busy} onClick={save}>
          저장
        </Button>
      </div>
      <div className="site-sheet">
        <h3 className="sitelog-title">작 업 일 지</h3>
        <div className="site-head">
          <dl className="site-info">
            <dt>프로젝트명</dt>
            <dd className="span3">
              {project.code && <b>{project.code} </b>}
              {project.name}
            </dd>
            <dt>현장 주소</dt>
            <dd className="span3">{project.location || '-'}</dd>
            <dt>작성 일자</dt>
            <dd>
              <input className="site-in" type="date" value={d.log_date} onChange={e => e.target.value && set({ log_date: e.target.value })} /> <span className="t-cap">({weekday(d.log_date)})</span>
            </dd>
            <dt>날씨</dt>
            <dd>
              <input className="site-in" value={d.weather ?? ''} onChange={e => set({ weather: e.target.value })} placeholder="맑음" />
            </dd>
            <dt>현장소장</dt>
            <dd>
              <input className="site-in" value={d.site_manager ?? ''} onChange={e => set({ site_manager: e.target.value })} placeholder="이름 · 연락처" />
            </dd>
            <dt>담당</dt>
            <dd>
              <input className="site-in" value={d.staff ?? ''} onChange={e => set({ staff: e.target.value })} placeholder="아트리어 담당" />
            </dd>
          </dl>
          <div className="site-signs" aria-label="결재">
            <span className="site-signs-label">결 재</span>
            {SITE_SIGNERS.map(k => {
              const s = d.signs[k]
              return (
                <button key={k} type="button" className={`site-sign${s ? ' on' : ''}`} onClick={() => sign(k)} disabled={busy || (k === '대표' && me.role !== 'admin')} title={s ? '다시 누르면 결재 취소' : k === '대표' ? '대표(관리자)만 결재' : '눌러서 결재'}>
                  <span className="k">{k}</span>
                  <span className="v">{s ? `${profileName(s.by)}\n${shortDate(s.at.slice(0, 10))}` : ''}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="site-sec">가. 용역비 지급 현황</div>
        <div className="site-scroll">
          <table className="site-table">
            <colgroup>
              <col style={{ width: 56 }} />
              <col className="c-trade" />
              <col className="c-contract" />
              <col className="c-n" />
              <col className="c-n" />
              <col className="c-n" />
              <col className="c-n" />
              <col className="c-price" />
              <col className="c-pay" />
              <col />
              <col className="c-del no-print" />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} colSpan={2}>공 종</th>
                <th rowSpan={2}>계약</th>
                <th colSpan={2}>금 일</th>
                <th rowSpan={2}>금일 계</th>
                <th rowSpan={2}>누 계</th>
                <th rowSpan={2}>용역 단가</th>
                <th rowSpan={2}>금일 지급</th>
                <th rowSpan={2}>협력사</th>
                <th rowSpan={2} className="no-print" />
              </tr>
              <tr>
                <th>주간</th>
                <th>야간</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g =>
                g.rows.map(({ l, i }, r) => (
                  <tr key={i}>
                    {r === 0 && (
                      <th rowSpan={g.rows.length} className="grp">
                        {g.group}
                      </th>
                    )}
                    <td>
                      <input className="site-in" value={l.trade} onChange={e => setLabor(i, { trade: e.target.value })} />
                    </td>
                    <td>
                      <input className="site-in c" value={l.contract} onChange={e => setLabor(i, { contract: e.target.value })} placeholder="-" />
                    </td>
                    <td>
                      <input className="site-in n" inputMode="numeric" value={l.day || ''} onChange={e => setLabor(i, { day: num(e.target.value) })} />
                    </td>
                    <td>
                      <input className="site-in n" inputMode="numeric" value={l.night || ''} onChange={e => setLabor(i, { night: num(e.target.value) })} />
                    </td>
                    <td className="n calc">{dayTotal(l) || '-'}</td>
                    <td className="n calc">{laborCum(l) || '-'}</td>
                    <td>
                      <input className="site-in n" inputMode="numeric" value={l.unit_price ? l.unit_price.toLocaleString('ko-KR') : ''} onChange={e => setLabor(i, { unit_price: num(e.target.value) })} />
                    </td>
                    <td className="n calc">{won(dayTotal(l) * (l.unit_price || 0))}</td>
                    <td>
                      <input className="site-in" value={l.vendor} onChange={e => setLabor(i, { vendor: e.target.value })} />
                    </td>
                    <td className="no-print">
                      <button type="button" className="icon-btn sm" aria-label="줄 삭제" onClick={() => set({ labor: d.labor.filter((_, j) => j !== i) })}>
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>총 합 계</th>
                <td className="n">{tot.day || '-'}</td>
                <td className="n">{tot.night || '-'}</td>
                <td className="n">{tot.day + tot.night || '-'}</td>
                <td />
                <td />
                <td className="n">{won(tot.pay)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <LaborAdder groups={groups.map(g => g.group)} onAdd={(group, trade) => set({ labor: [...d.labor, { group, trade, contract: '', day: 0, night: 0, unit_price: 0, vendor: '' }].sort((a, b) => groupOrder(a.group) - groupOrder(b.group)) })} />

        <div className="site-sec">나. 자재 반출입 / 인건비 지급 사항</div>
        <div className="site-scroll">
          <table className="site-table">
            <colgroup>
              <col style={{ width: 32 }} />
              <col style={{ width: 130 }} />
              <col />
              <col className="c-n" />
              <col className="c-price" />
              <col className="c-pay" />
              <col />
              <col className="c-del no-print" />
            </colgroup>
            <thead>
              <tr>
                <th>번호</th>
                <th>품 목</th>
                <th>규 격</th>
                <th>수 량</th>
                <th>금일 지급액</th>
                <th>지급액 누계</th>
                <th>협력사</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {d.materials.map((m, i) => (
                <tr key={i}>
                  <td className="c">{i + 1}</td>
                  <td>
                    <input className="site-in" value={m.item} onChange={e => setMat(i, { item: e.target.value })} placeholder="지급 업체 · 품목" />
                  </td>
                  <td>
                    <input className="site-in" value={m.spec} onChange={e => setMat(i, { spec: e.target.value })} />
                  </td>
                  <td>
                    <input className="site-in n" inputMode="numeric" value={m.qty || ''} onChange={e => setMat(i, { qty: num(e.target.value) })} />
                  </td>
                  <td>
                    <input className="site-in n" inputMode="numeric" value={m.amount ? m.amount.toLocaleString('ko-KR') : ''} onChange={e => setMat(i, { amount: num(e.target.value) })} />
                  </td>
                  <td className="n calc">{won(matCum(m))}</td>
                  <td>
                    <input className="site-in" value={m.vendor} onChange={e => setMat(i, { vendor: e.target.value })} />
                  </td>
                  <td className="no-print">
                    <button type="button" className="icon-btn sm" aria-label="줄 삭제" onClick={() => set({ materials: d.materials.filter((_, j) => j !== i) })}>
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>총 합 계</th>
                <td className="n">{won(tot.mat)}</td>
                <td className="n">{won(tot.matCum)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <button type="button" className="link-btn t-cap no-print" onClick={() => set({ materials: [...d.materials, { item: '', spec: '', qty: 0, amount: 0, vendor: '' }] })}>
          + 줄 추가
        </button>

        <div className="site-work">
          <label>
            <span className="site-sec">금일 공정</span>
            <textarea className="site-area" rows={5} value={d.today_work ?? ''} onChange={e => set({ today_work: e.target.value })} placeholder="예) 2층 경량 칸막이 설치, 1층 전기 배관" />
          </label>
          <label>
            <span className="site-sec">익일 공정</span>
            <textarea className="site-area" rows={5} value={d.next_work ?? ''} onChange={e => set({ next_work: e.target.value })} placeholder="예) 2층 석고보드 마감, 3층 철거" />
          </label>
        </div>

        <div className="site-sec">현장 사진</div>
        <div className="site-photos">
          {d.photos.map((p, i) => (
            <div key={i} className="site-photo">
              <input className="site-in" value={p.label} onChange={e => set({ photos: d.photos.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="위치 (예: 1층 · 계단실)" />
              <input className="site-in" value={p.url} onChange={e => set({ photos: d.photos.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="사진 링크 (구글 드라이브)" />
              {/^https?:\/\//.test(p.url) && (
                <a href={p.url} target="_blank" rel="noreferrer noopener" className="t-cap">
                  열기
                </a>
              )}
              <button type="button" className="icon-btn sm no-print" aria-label="사진 삭제" onClick={() => set({ photos: d.photos.filter((_, j) => j !== i) })}>
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button type="button" className="link-btn t-cap no-print" onClick={() => set({ photos: [...d.photos, { label: '', url: '' }] })}>
            + 사진 링크
          </button>
        </div>
        <span className="t-cap no-print">주민번호 · 계좌번호는 작업일지에 적지 않습니다. 지급 정보는 결제 대장에서 관리하세요.</span>
      </div>
      <div className="row gap-6 no-print" style={{ justifyContent: 'flex-end' }}>
        <Button kind="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
        <Button size="sm" disabled={busy} onClick={save}>
          저장
        </Button>
      </div>
    </div>
  )
}

const GROUPS = Array.from(new Set(SITE_TRADES.map(t => t[0])))
const groupOrder = (g: string) => {
  const i = GROUPS.indexOf(g)
  return i < 0 ? GROUPS.length : i
}

function LaborAdder({ groups, onAdd }: { groups: string[]; onAdd: (group: string, trade: string) => void }) {
  const all = Array.from(new Set([...GROUPS, ...groups]))
  const [group, setGroup] = useState(all[0])
  const [trade, setTrade] = useState('')
  return (
    <div className="row gap-6 no-print" style={{ flexWrap: 'wrap' }}>
      <select className="select" style={{ width: 'auto' }} value={group} onChange={e => setGroup(e.target.value)} aria-label="공종 묶음">
        {all.map(g => (
          <Fragment key={g}>
            <option value={g}>{g}</option>
          </Fragment>
        ))}
      </select>
      <input className="input" style={{ width: 160 }} value={trade} onChange={e => setTrade(e.target.value)} placeholder="세부 공종 (예: 철거 2)" aria-label="세부 공종" />
      <button
        type="button"
        className="btn btn-outline btn-sm"
        disabled={!trade.trim()}
        onClick={() => {
          onAdd(group, trade.trim())
          setTrade('')
        }}
      >
        + 공종 추가
      </button>
    </div>
  )
}
