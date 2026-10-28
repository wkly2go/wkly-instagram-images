import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { todayKey } from '../lib/date'
import { openGmail } from '../lib/links'
import { LOG_KINDS, type Client, type LogKind, type Project } from '../lib/types'
import { Button, Chip, Field } from './ui'

export interface LogDraft {
  kind: LogKind
  content: string
  counterpart: string
  subject: string
  clientId: string
  projectId: string
  minutes: string
}

const empty = (kind: LogKind = '업무', clientId = '', projectId = ''): LogDraft => ({ kind, content: '', counterpart: '', subject: '', clientId, projectId, minutes: '' })

export const isMail = (k: LogKind) => k === '메일 발신' || k === '메일 수신'

function useLookups() {
  const { api, version } = useApp()
  return useAsync<{ clients: Client[]; projects: Project[] }>(
    async () => {
      const [clients, projects] = await Promise.all([api.listClients(), api.listProjects()])
      return { clients, projects }
    },
    [version],
    { clients: [], projects: [] },
  ).data
}

/** 기록 저장 + (선택) Gmail 작성창 / 메일 발송 승인 요청 */
function useSubmit(date: string | undefined, onDone: () => void) {
  const { api, bump, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const submit = async (d: LogDraft, mode: 'log' | 'gmail' | 'approval') => {
    const content = d.content.trim() || d.subject.trim()
    if (!content) {
      toast('무엇을 했는지 적어 주세요.')
      return
    }
    // 팝업 차단을 피하려면 클릭 직후 바로 열어야 함
    if (mode === 'gmail') openGmail({ to: d.counterpart, subject: d.subject, body: d.content })
    setBusy(true)
    try {
      if (mode === 'approval') {
        await api.createApproval({
          kind: '메일 발송',
          title: d.subject.trim() || content.slice(0, 40),
          content: null,
          target_id: d.clientId || null,
          payload: { to: d.counterpart.trim(), subject: d.subject.trim(), body: d.content.trim() },
        })
        toast('메일 발송 승인을 요청했습니다.')
      } else {
        await api.saveWorkLog({
          log_date: date ?? todayKey(),
          kind: d.kind,
          content,
          email_counterpart: isMail(d.kind) ? d.counterpart.trim() || null : null,
          email_subject: isMail(d.kind) ? d.subject.trim() || null : null,
          client_id: d.clientId || null,
          project_id: d.projectId || null,
          minutes: d.minutes ? Math.max(0, parseInt(d.minutes, 10) || 0) : null,
        })
        toast('기록했습니다.')
      }
      bump()
      onDone()
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, submit }
}

// ---------------------------------------------------------------------
// 검색해서 고르는 칸 (거래처 · 프로젝트)
// ---------------------------------------------------------------------
export interface PickItem {
  id: string
  label: string
  sub?: string
  group?: string
}

const norm = (s: string) => s.toLowerCase().replace(/[\s·.,()[\]'"‘’“”_-]/g, '')

export function SearchPick({ items, value, onChange, placeholder, label, groups }: { items: PickItem[]; value: string; onChange: (id: string) => void; placeholder: string; label: string; groups?: string[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const selected = items.find(i => i.id === value)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  const list = useMemo(() => {
    const k = norm(q)
    const hit = k ? items.filter(i => norm(i.label).includes(k) || (i.sub && norm(i.sub).includes(k))) : items
    const order = groups ?? []
    return [...hit].sort((a, b) => order.indexOf(a.group ?? '') - order.indexOf(b.group ?? ''))
  }, [items, q, groups])
  // 묶음 접기: 검색 중이 아니면 완료 · 보류 묶음은 접어 둠
  const [userFold, setUserFold] = useState<Record<string, boolean>>({})
  const folded = useMemo(() => {
    const f = new Set<string>()
    for (const g of groups ?? []) {
      const def = !q.trim() && (g === '완료' || g === '보류')
      if (userFold[g] ?? def) f.add(g)
    }
    return f
  }, [groups, userFold, q])
  const toggle = (g: string) => setUserFold(m => ({ ...m, [g]: !folded.has(g) }))
  const groupCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of list) m.set(it.group ?? '', (m.get(it.group ?? '') ?? 0) + 1)
    return m
  }, [list])
  // 접힌 묶음은 머리만 남김
  const shown = useMemo(() => list.filter((it, i) => !folded.has(it.group ?? '') || i === 0 || list[i - 1].group !== it.group), [list, folded])
  const pick = (id: string) => {
    onChange(id)
    setQ('')
    setOpen(false)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHi(h => Math.min(h + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && open && shown[hi] && !folded.has(shown[hi].group ?? '')) {
      e.preventDefault()
      pick(shown[hi].id)
    } else if (e.key === 'Escape') setOpen(false)
  }
  return (
    <div className="pick" ref={box}>
      {selected && !open ? (
        <button type="button" className="pick-chosen" onClick={() => setOpen(true)} title={`${label} 바꾸기`}>
          <span className="truncate">{selected.label}</span>
          <span
            className="pick-x"
            role="button"
            aria-label={`${label} 지우기`}
            onClick={e => {
              e.stopPropagation()
              onChange('')
            }}
          >
            <X size={12} />
          </span>
        </button>
      ) : (
        <label className="pick-input">
          <Search size={13} aria-hidden="true" />
          <input
            className="input"
            value={q}
            placeholder={placeholder}
            autoFocus={open && !!selected}
            onFocus={() => setOpen(true)}
            onChange={e => {
              setQ(e.target.value)
              setHi(0)
              setOpen(true)
            }}
            onKeyDown={onKey}
            aria-label={`${label} 검색`}
          />
        </label>
      )}
      {open && (
        <div className="pick-list" role="listbox" aria-label={label}>
          {list.length === 0 && <div className="pick-empty">'{q}' 검색 결과가 없습니다.</div>}
          {shown.slice(0, 80).map((it, i) => {
            const head = it.group && (i === 0 || shown[i - 1].group !== it.group)
            const g = it.group ?? ''
            return (
              <div key={it.id}>
                {head && (
                  // 묶음 머리: 이름 · 개수 · 접기 (완료 · 보류는 처음에 접힘)
                  <button type="button" className={`pick-group g${(groups ?? []).indexOf(g)}`} onMouseDown={e => e.preventDefault()} onClick={() => toggle(g)} aria-expanded={!folded.has(g)}>
                    <span>{folded.has(g) ? '▸' : '▾'}</span>
                    <span className="grow">{g}</span>
                    <span className="pick-count">{groupCount.get(g) ?? 0}</span>
                  </button>
                )}
                {!folded.has(g) && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={it.id === value}
                    className={`pick-item ${i === hi ? 'hi' : ''} ${it.id === value ? 'on' : ''}`}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(it.id)}
                  >
                    <span className="truncate grow">{it.label}</span>
                    {it.sub && <span className="t-cap truncate">{it.sub}</span>}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 프로젝트 묶음: 진행 중(진행 · 기획) · NIC(계약 전) · 보류 · 완료 */
export const PROJECT_GROUPS = ['진행 중', 'NIC · 계약 전', '보류', '완료']
export const projectGroup = (p: Project) => (p.status === '진행' || p.status === '기획' ? '진행 중' : p.status === 'NIC' ? 'NIC · 계약 전' : p.status)

/** 업무 내용에서 프로젝트 · 거래처 찾기: 이름이 통째로 들어 있거나, 이름의 주요 단어가 들어 있으면 연결 */
export function guessLinks(text: string, projects: Project[], clients: Client[]): { projectId?: string; clientId?: string } {
  const t = norm(text)
  if (t.length < 2) return {}
  const words = (name: string) => name.split(/[\s·.,()[\]'"‘’“”_/-]+/).map(norm).filter(w => w.length >= 2)
  const score = (name: string) => {
    const n = norm(name)
    if (n.length >= 2 && t.includes(n)) return 100 + n.length
    const ws = words(name)
    const hit = ws.filter(w => t.includes(w))
    // 긴 단어 하나(3자 이상) 또는 단어 두 개 이상이 맞을 때만
    if (hit.length >= 2) return 50 + hit.join('').length
    if (hit.length === 1 && hit[0].length >= 3) return 20 + hit[0].length
    return 0
  }
  const live = projects.filter(p => p.status !== '완료')
  let best: { p: Project; s: number } | null = null
  for (const p of live) {
    const s = score(p.name)
    if (s > 0 && (!best || s > best.s)) best = { p, s }
  }
  let client: Client | null = null
  let cs = 0
  for (const c of clients) {
    const s = score(c.name)
    if (s > cs) {
      cs = s
      client = c
    }
  }
  if (best) return { projectId: best.p.id, clientId: best.p.client_id ?? client?.id }
  if (client) {
    const theirs = live.filter(p => p.client_id === client!.id)
    return { clientId: client.id, projectId: theirs.length === 1 ? theirs[0].id : undefined }
  }
  return {}
}

function Selects({ d, set, clients, projects }: { d: LogDraft; set: (p: Partial<LogDraft>) => void; clients: Client[]; projects: Project[] }) {
  const clientName = (id: string | null) => clients.find(c => c.id === id)?.name
  return (
    <>
      <SearchPick
        label="거래처"
        placeholder="거래처 검색"
        value={d.clientId}
        onChange={id => set({ clientId: id })}
        items={clients.map(c => ({ id: c.id, label: c.name, sub: c.category }))}
      />
      <SearchPick
        label="프로젝트"
        placeholder="프로젝트 검색"
        value={d.projectId}
        groups={PROJECT_GROUPS}
        onChange={id => {
          const p = projects.find(x => x.id === id)
          // 프로젝트를 고르면 그 거래처도 함께
          set({ projectId: id, ...(p?.client_id && !d.clientId ? { clientId: p.client_id } : {}) })
        }}
        items={projects.map(p => ({ id: p.id, label: p.name, sub: [p.code, clientName(p.client_id)].filter(Boolean).join(' · ') || undefined, group: projectGroup(p) }))}
      />
    </>
  )
}

/** 업무 내용을 쓰는 동안 프로젝트 · 거래처를 자동으로 연결 (직접 고르면 그대로 둠) */
function useAutoLink(d: LogDraft, set: (p: Partial<LogDraft>) => void, projects: Project[], clients: Client[]) {
  const manual = useRef({ project: false, client: false })
  const [auto, setAuto] = useState<{ project: boolean; client: boolean }>({ project: false, client: false })
  useEffect(() => {
    const id = window.setTimeout(() => {
      const g = guessLinks(`${d.content} ${d.subject}`, projects, clients)
      const patch: Partial<LogDraft> = {}
      const next = { ...auto }
      if (!manual.current.project && g.projectId && g.projectId !== d.projectId) {
        patch.projectId = g.projectId
        next.project = true
      }
      if (!manual.current.client && g.clientId && g.clientId !== d.clientId) {
        patch.clientId = g.clientId
        next.client = true
      }
      if (Object.keys(patch).length) {
        set(patch)
        setAuto(next)
      }
    }, 350)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.content, d.subject, projects, clients])
  // 사람이 고르면 자동 연결을 멈춤
  const setManual = (p: Partial<LogDraft>) => {
    if ('projectId' in p) manual.current.project = true
    if ('clientId' in p) manual.current.client = true
    setAuto({ project: false, client: false })
    set(p)
  }
  const reset = () => {
    manual.current = { project: false, client: false }
    setAuto({ project: false, client: false })
  }
  return { setManual, reset, auto: auto.project || auto.client }
}

/** 업무 일지 화면 하단: 채팅처럼 쓰는 입력줄 */
export function LogComposer({ date, initialClientId = '' }: { date: string; initialClientId?: string }) {
  const { clients, projects } = useLookups()
  const [d, setD] = useState<LogDraft>(() => empty('업무', initialClientId))
  const set = (p: Partial<LogDraft>) => setD(prev => ({ ...prev, ...p }))
  const link = useAutoLink(d, set, projects, clients)
  const { busy, submit } = useSubmit(date, () => {
    setD(prev => empty(prev.kind))
    link.reset()
  })
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit(d, 'log')
    }
  }
  return (
    // 좁은 칸에서도 한눈에: ① 종류 풀다운 · 분 · 기록 ② 내용 ③ 거래처 · 프로젝트 (2026-10-28 "사용성 개선")
    <div className="col gap-6 log-composer">
      <div className="row log-composer-top">
        <select className="select log-kind" value={d.kind} onChange={e => set({ kind: e.target.value as LogKind })} aria-label="기록 종류">
          {LOG_KINDS.map(k => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input className="input log-min" inputMode="numeric" placeholder="분" value={d.minutes} onChange={e => set({ minutes: e.target.value.replace(/\D/g, '') })} aria-label="소요 시간(분)" title="걸린 시간(분)" />
        <span className="grow" />
        {d.kind === '메일 발신' && (
          <Button kind="outline" size="sm" disabled={busy} onClick={() => submit(d, 'gmail')} title="Gmail 작성창을 열고 기록도 남깁니다">
            Gmail
          </Button>
        )}
        <Button size="sm" disabled={busy || !d.content.trim()} onClick={() => submit(d, 'log')}>
          기록
        </Button>
      </div>
      {isMail(d.kind) && (
        <div className="row wrap">
          <input className="input grow" placeholder={d.kind === '메일 발신' ? '받는 사람 이메일' : '보낸 사람 이메일'} value={d.counterpart} onChange={e => set({ counterpart: e.target.value })} />
          <input className="input grow" placeholder="메일 제목" value={d.subject} onChange={e => set({ subject: e.target.value })} />
        </div>
      )}
      <textarea
        className="textarea log-text"
        rows={2}
        placeholder="무엇을 했나요? (Enter 기록 · Shift+Enter 줄바꿈)"
        value={d.content}
        onChange={e => set({ content: e.target.value })}
        onKeyDown={onKey}
        aria-label="기록 내용"
      />
      <div className="row log-links">
        <Selects d={d} set={link.setManual} clients={clients} projects={projects} />
      </div>
      {link.auto && (d.projectId || d.clientId) && <span className="auto-link t-cap">업무 내용으로 자동 연결했습니다. 다르면 위에서 바꾸세요.</span>}
    </div>
  )
}

/** 빠른 기록 창(PiP·팝업)용 세로 폼 */
export function QuickLogForm() {
  const { clients, projects } = useLookups()
  const [d, setD] = useState<LogDraft>(() => empty())
  const set = (p: Partial<LogDraft>) => setD(prev => ({ ...prev, ...p }))
  const link = useAutoLink(d, set, projects, clients)
  const { busy, submit } = useSubmit(undefined, () => {
    setD(prev => empty(prev.kind))
    link.reset()
  })
  return (
    <div className="col gap-10">
      <div className="chips" role="group" aria-label="기록 종류">
        {LOG_KINDS.slice(0, 5).map(k => (
          <Chip key={k} active={d.kind === k} onClick={() => set({ kind: k })}>
            {k}
          </Chip>
        ))}
      </div>
      {isMail(d.kind) && (
        <>
          <Field label={d.kind === '메일 발신' ? '받는 사람' : '보낸 사람'}>
            <input className="input" value={d.counterpart} onChange={e => set({ counterpart: e.target.value })} placeholder="name@example.com" />
          </Field>
          <Field label="제목">
            <input className="input" value={d.subject} onChange={e => set({ subject: e.target.value })} />
          </Field>
        </>
      )}
      <Field label={isMail(d.kind) ? '내용 메모' : '무엇을 했나요?'}>
        <textarea
          className="textarea"
          rows={3}
          value={d.content}
          onChange={e => set({ content: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(d, 'log')
          }}
          placeholder="Ctrl+Enter 로 바로 기록"
        />
      </Field>
      <div className="row">
        <Selects d={d} set={link.setManual} clients={clients} projects={projects} />
      </div>
      {link.auto && (d.projectId || d.clientId) && <span className="auto-link t-cap">업무 내용으로 자동 연결했습니다.</span>}
      <div className="row">
        <input className="input" style={{ width: 90 }} inputMode="numeric" placeholder="소요(분)" value={d.minutes} onChange={e => set({ minutes: e.target.value.replace(/\D/g, '') })} aria-label="소요 시간(분)" />
        <span className="grow" />
      </div>
      <div className="row">
        {d.kind === '메일 발신' && (
          <>
            <Button kind="outline" className="grow" disabled={busy} onClick={() => submit(d, 'gmail')}>
              Gmail로 작성
            </Button>
            <Button kind="yellow" className="grow" disabled={busy} onClick={() => submit(d, 'approval')}>
              승인 요청
            </Button>
          </>
        )}
        <Button className="grow" disabled={busy} onClick={() => submit(d, 'log')}>
          기록
        </Button>
      </div>
    </div>
  )
}
