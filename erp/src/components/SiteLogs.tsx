import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ExternalLink, Pencil, Plus, Printer, Trash2, X } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate, todayKey, weekday } from '../lib/date'
import { SITE_MATERIAL_ITEMS, SITE_SIGNERS, SITE_TRADES, type Project, type SiteLabor, type SiteLog, type SiteMaterial, type SiteSigner } from '../lib/types'
import { Board } from './Board'
import { Button, SectionHead } from './ui'
import { useSuppressDetail } from './RightPanel'
import { ask } from './Ask'

/**
 * 인테리어 현장 작업일지 (대표 지시 2026-10-18 · 엑셀 '작업일지' 양식)
 *  - 프로젝트 · 날짜마다 한 장, 새 장은 직전 장의 공종 · 협력사를 이어받고 인원 · 금액만 비움
 *  - 가. 공종별 인원은 업무 내용만 (용역 단가 · 지급 금액 칸 없음), 나. 자재 반출입은 지급액 · 누계 표시
 *  - 사진은 휴대폰 카메라 · 앨범에서 바로 올림, 저장한 일지는 예약 작업이 구글 드라이브에 문서로 저장하고
 *    인트라넷에는 드라이브 링크만 남겨 화면 안에서 미리 보기
 *  - 주민번호 · 계좌번호는 적지 않음 (지급은 결제 대장)
 */
const won = (n: number) => (n ? Math.round(n).toLocaleString('ko-KR') : '-')
const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v.replace(/[^\d.]/g, '')) || 0))
const laborKey = (l: Pick<SiteLabor, 'group' | 'trade'>) => `${l.group}|${l.trade}`
const dayTotal = (l: SiteLabor) => (l.day || 0) + (l.night || 0)

function blankLabor(): SiteLabor[] {
  return SITE_TRADES.map(([group, trade, contract]) => ({ group, trade, contract, day: 0, night: 0, vendor: '', note: '' }))
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
  const [preview, setPreview] = useState<SiteLog | null>(null)
  useSuppressDetail(!!open || !!preview)
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
        // 직전 장의 공종 · 계약 · 협력사는 이어받고 인원 · 금액만 비움
        labor: prev ? prev.labor.map(l => ({ ...l, day: 0, night: 0, note: '' })) : blankLabor(),
        materials: prev ? prev.materials.map(m => ({ ...m, qty: 0, amount: 0 })) : blankMaterials(),
        today_work: null,
        next_work: prev?.next_work ?? null,
        photos: [],
        events: null,
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
        // 드라이브에 저장된 일지는 화면 안에서 드라이브 문서로 보기, 아직이면 바로 일지 열기
        onRow={l => (driveId(l) ? (setOpen(null), setPreview(l)) : (setPreview(null), setOpen(l)))}
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
          { key: 'mat', label: '자재 지급', width: 90, kind: 'num', cell: l => won(l.materials.reduce((n, m) => n + (m.amount || 0), 0)) },
          {
            key: 'drive',
            label: '드라이브',
            width: 92,
            kind: 'center',
            cell: l =>
              l.drive_url ? (
                <span className="row" style={{ gap: 4, justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
                  <button type="button" className="link-btn t-cap" onClick={() => (setOpen(null), setPreview(l))}>
                    {l.synced_at && l.updated_at > l.synced_at ? '저장 대기' : '보기'}
                  </button>
                  <button type="button" className="icon-btn sm" aria-label="일지 수정" title="수정" onClick={() => (setPreview(null), setOpen(l))}>
                    <Pencil size={11} />
                  </button>
                </span>
              ) : (
                <span className="t-cap" title="저장한 일지는 평일 08 · 11 · 17시에 구글 드라이브에 문서로 저장됩니다">저장 대기</span>
              ),
          },
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
      {preview && <DrivePreview key={preview.id} log={preview} onEdit={() => (setPreview(null), setOpen(preview))} onClose={() => setPreview(null)} />}
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
          photos: d.photos.filter(p => p.label.trim() || p.url.trim() || p.path),
          events: d.events?.trim() || null,
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
          <Button kind="ghost" size="sm" disabled={busy} onClick={async () => (await ask('이 작업일지를 삭제할까요?')) && (await run(() => api.deleteSiteLog(d.id), '삭제했습니다.')) && onClose()}>
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

        <div className="site-sec">가. 공종별 투입 인원 · 작업 내용</div>
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
              <col className="c-work" />
              <col className="c-vendor" />
              <col className="c-del no-print" />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} colSpan={2}>공 종</th>
                <th rowSpan={2}>계약</th>
                <th colSpan={2}>금 일</th>
                <th rowSpan={2}>금일 계</th>
                <th rowSpan={2}>누 계</th>
                <th rowSpan={2}>금일 작업 내용</th>
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
                      <input className="site-in" value={l.note ?? ''} onChange={e => setLabor(i, { note: e.target.value })} placeholder={dayTotal(l) ? '예) 2층 칸막이' : ''} />
                    </td>
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
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
        <LaborAdder groups={groups.map(g => g.group)} onAdd={(group, trade) => set({ labor: [...d.labor, { group, trade, contract: '', day: 0, night: 0, vendor: '', note: '' }].sort((a, b) => groupOrder(a.group) - groupOrder(b.group)) })} />

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

        <label>
          <span className="site-sec">이벤트 · 특이사항</span>
          <textarea className="site-area" rows={3} value={d.events ?? ''} onChange={e => set({ events: e.target.value })} placeholder="예) 소방 검측, 건물주 방문, 민원 · 안전 점검, 자재 반입 지연" />
        </label>

        <div className="site-sec">현장 사진</div>
        <SitePhotos projectId={project.id} photos={d.photos} onChange={photos => set({ photos })} />
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

/** 현장 사진: 휴대폰 카메라 · 앨범에서 바로 올림 (여러 장), 위치 이름 붙이기 */
function SitePhotos({ projectId, photos, onChange }: { projectId: string; photos: SiteLog['photos']; onChange: (p: SiteLog['photos']) => void }) {
  const { api, toast } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    const added: SiteLog['photos'] = []
    try {
      for (const f of Array.from(files)) {
        const r = await api.uploadSitePhoto(projectId, f)
        added.push({ label: '', url: r.url, path: r.path })
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '사진을 올리지 못했습니다.')
    }
    setBusy(false)
    if (added.length) onChange([...photos, ...added])
    if (fileRef.current) fileRef.current.value = ''
  }
  return (
    <div className="site-photos">
      <div className="site-photo-grid">
        {photos.map((p, i) => (
          <figure key={i} className="site-photo-card">
            <PhotoThumb p={p} />
            <input className="site-in" value={p.label} onChange={e => onChange(photos.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="위치 (예: 1층 · 계단실)" />
            <button type="button" className="icon-btn sm no-print site-photo-x" aria-label="사진 빼기" onClick={() => onChange(photos.filter((_, j) => j !== i))}>
              <X size={12} />
            </button>
          </figure>
        ))}
        <button type="button" className="site-photo-add no-print" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Camera size={18} />
          <span>{busy ? '올리는 중…' : '사진 찍기 · 고르기'}</span>
        </button>
      </div>
      {/* capture 를 주지 않아 휴대폰에서 카메라 · 앨범 중 고를 수 있음 */}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => add(e.target.files)} />
    </div>
  )
}

function PhotoThumb({ p }: { p: SiteLog['photos'][number] }) {
  const { api } = useApp()
  const [src, setSrc] = useState(p.path ? '' : p.url)
  useEffect(() => {
    if (!p.path) return
    let live = true
    api.sitePhotoUrl(p.path).then(u => live && setSrc(u)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [api, p.path])
  if (!src) return <div className="site-photo-img empty" />
  if (!/^(https?:|data:image)/.test(src)) return <div className="site-photo-img empty" />
  return (
    <a href={src} target="_blank" rel="noreferrer noopener">
      <img className="site-photo-img" src={src} alt="현장 사진" loading="lazy" />
    </a>
  )
}

/** 드라이브에 저장된 작업일지를 화면 안에서 보기 (구글 문서 미리 보기) */
const driveId = (l: Pick<SiteLog, 'drive_file_id' | 'drive_url'>) => l.drive_file_id || l.drive_url?.match(/\/d\/([\w-]{20,})/)?.[1] || null
function DrivePreview({ log, onEdit, onClose }: { log: SiteLog; onEdit: () => void; onClose: () => void }) {
  const id = driveId(log)
  return (
    <div className="sitelog-panel">
      <div className="sitelog-bar">
        <b className="grow">
          작업일지 · {shortDate(log.log_date)} ({weekday(log.log_date)}) · 구글 드라이브
        </b>
        {log.drive_url && (
          <a className="btn btn-outline btn-sm" href={log.drive_url} target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'none' }}>
            <ExternalLink size={12} /> 드라이브에서 열기
          </a>
        )}
        <Button kind="outline" size="sm" onClick={onEdit}>
          <Pencil size={12} /> 수정
        </Button>
        <button type="button" className="icon-btn sm" aria-label="닫기" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {id ? <iframe className="drive-frame" title="작업일지 (구글 드라이브)" src={`https://docs.google.com/document/d/${id}/preview`} /> : <span className="t-cap">아직 드라이브에 저장되지 않았습니다.</span>}
      {log.synced_at && log.updated_at > log.synced_at && <span className="t-cap">고친 내용은 다음 저장(평일 08 · 11 · 17시) 때 드라이브에 반영됩니다.</span>}
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
