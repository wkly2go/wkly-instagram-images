import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Briefcase, Building2, FileText, FolderKanban, Globe, Hash, HardDrive, ListTodo, Search, User, LayoutGrid } from 'lucide-react'
import { useApp } from '../lib/app'
import { useRouter } from '../lib/router'
import type { AgentInstruction, ChatRoomSummary, Client, Contact, DriveIndexFile, Project, ResearchItem, Task } from '../lib/types'
import { useOpenDoc } from './DriveFiles'
import { TABS } from './Shell'
import { useMyAgents } from './AgentDesk'
import { runWebSearch } from './WebSearch'
import { Linkify } from './ui'

/**
 * 전체 검색 · 빠른 이동 (Ctrl+K · ⌘K) — 슬랙 '빠른 전환' 참고 (2026-10-22)
 *  - 사람 · 채팅방 · 프로젝트(연번) · 거래처 · 연락처 · 할 일 · 자료 · 메뉴를 한 칸에서 찾고 Enter 로 이동
 *  - 한글 초성으로도 찾음 (예: ㅎㄴ → 한남)
 *  - 상단 입력칸 하나로 통합 (2026-10-23): 인트라넷 찾기 + 'AI 총괄에게 묻기' + '구글 · 인터넷 검색'
 *    Enter = 맨 위 결과 · Ctrl+Enter = AI 에게 · Shift+Enter = 인터넷 검색
 *  - AI 에게 지시하면 창을 옮기지 않고 이 검색창 안에서 바로 답을 보여 줌 (대표 지시 2026-10-28)
 */
type Hit = { key: string; group: string; icon: typeof Search; label: string; sub?: string; to: string; score: number; /** 주소 대신 할 일 (드라이브 파일 열기) */ run?: () => void }

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const chosung = (s: string) =>
  [...s].map(c => {
    const code = c.charCodeAt(0) - 0xac00
    return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : c
  }).join('')
const isCho = (q: string) => /^[ㄱ-ㅎ\s]+$/.test(q)
function score(text: string, q: string): number {
  const t = text.toLowerCase()
  if (!q) return 1
  if (t.startsWith(q)) return 3
  if (t.includes(q)) return 2
  if (isCho(q) && chosung(t).replace(/\s/g, '').includes(q.replace(/\s/g, ''))) return 1.5
  return 0
}

let openSet: ((v: boolean) => void) | null = null
let initialQ = ''
export const openCommandPalette = (q = '') => {
  initialQ = q
  openSet?.(true)
}

export function CommandPalette() {
  const { api, profiles, me, bump } = useApp()
  const { navigate } = useRouter()
  const openDoc = useOpenDoc()
  // 팀원은 자기 팀 AI 팀장, 대표는 총괄 (대표 지시 2026-10-28)
  const agents = useMyAgents()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [data, setData] = useState<{ projects: Project[]; clients: Client[]; contacts: Contact[]; rooms: ChatRoomSummary[]; tasks: Task[]; research: ResearchItem[]; drive: DriveIndexFile[] } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  // 검색창 안 AI 답변: 보낸 지시 id → 답이 오면 그 자리에서 보여 줌
  const [ai, setAi] = useState<{ id: string | null; name: string; text: string; row?: AgentInstruction; error?: string } | null>(null)
  openSet = setOpen

  useEffect(() => {
    if (!ai?.id) return
    const id = ai.id
    const load = () =>
      api.listAgentInstructions().then(list => {
        const row = list.find(i => i.id === id)
        if (row) setAi(a => (a && a.id === id ? { ...a, row } : a))
      }, () => undefined)
    const off = api.subscribeChanges(['agent_instructions'], load)
    // 실시간이 끊겨도 답을 놓치지 않게 잠깐씩 다시 확인
    const t = window.setInterval(load, 4000)
    return () => {
      off()
      window.clearInterval(t)
    }
  }, [api, ai?.id])
  const aiDone = ai?.row && ai.row.status !== '대기' && ai.row.status !== '진행 중'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!open) return
    setQ(initialQ)
    initialQ = ''
    setAi(null)
    setSel(0)
    window.setTimeout(() => input.current?.focus(), 20)
    // 열 때마다 최신으로 (가벼운 목록만)
    void Promise.all([
      api.listProjects().catch(() => []),
      api.listClients().catch(() => []),
      api.listContacts().catch(() => []),
      api.listRooms().catch(() => []),
      api.listTasks().catch(() => []),
      api.listResearch().catch(() => []),
      api.listDriveIndex().catch(() => []),
    ]).then(([projects, clients, contacts, rooms, tasks, research, drive]) => setData({ projects, clients, contacts, rooms, tasks, research, drive }))
  }, [open, api])

  const hits = useMemo(() => {
    const k = q.trim().toLowerCase()
    const out: Hit[] = []
    const add = (h: Omit<Hit, 'score'>, ...texts: (string | null | undefined)[]) => {
      const s = Math.max(...texts.filter(Boolean).map(t => score(t!, k)))
      if (s > 0) out.push({ ...h, score: s })
    }
    TABS.filter(t => !t.admin || me.role === 'admin').forEach(t => add({ key: `m${t.key}`, group: '메뉴', icon: LayoutGrid, label: t.label, to: t.path }, t.label))
    // 다른 탭 안으로 옮긴 메뉴
    add({ key: 'm-clients', group: '메뉴', icon: LayoutGrid, label: '거래처 · 연락처', sub: '프로젝트', to: '/clients' }, '거래처', '연락처')
    add({ key: 'm-library', group: '메뉴', icon: LayoutGrid, label: '자료실', sub: '보고서 결제', to: '/library' }, '자료실', '리서치')
    if (k) {
      profiles.filter(p => p.active && p.id !== me.id).forEach(p => add({ key: `u${p.id}`, group: '사람', icon: User, label: p.name, sub: [p.title, p.is_agent ? 'AI' : null].filter(Boolean).join(' · '), to: `/chat?dm=${p.id}` }, p.name, p.title))
      data?.rooms.filter(r => !r.members?.length).forEach(r => add({ key: `r${r.id}`, group: '채팅방', icon: Hash, label: r.name, to: `/chat?room=${r.id}` }, r.name))
      data?.projects.forEach(p => add({ key: `p${p.id}`, group: '프로젝트', icon: FolderKanban, label: p.name, sub: [p.code, p.status, p.location].filter(Boolean).join(' · '), to: `/projects?id=${p.id}` }, p.name, p.code, p.location))
      data?.clients.forEach(c => add({ key: `c${c.id}`, group: '거래처', icon: Building2, label: c.name, sub: c.category, to: `/clients?id=${c.id}` }, c.name))
      data?.contacts.forEach(c => add({ key: `ct${c.id}`, group: '연락처', icon: Briefcase, label: c.name, sub: [c.title, data.clients.find(x => x.id === c.client_id)?.name, c.email].filter(Boolean).join(' · '), to: `/clients?view=people&pid=${c.id}` }, c.name, c.email, c.phone))
      data?.tasks.filter(t => t.status !== '완료').forEach(t => add({ key: `t${t.id}`, group: '할 일', icon: ListTodo, label: t.title, sub: [t.due_date, profiles.find(p => p.id === t.assignee_id)?.name].filter(Boolean).join(' · '), to: t.project_id ? `/projects?id=${t.project_id}` : '/projects?view=mine' }, t.title))
      // 프로젝트 폴더 파일 (드라이브 자동 동기화 목록)
      data?.drive.forEach(f => f.url && f.mime_type !== 'application/vnd.google-apps.folder' && add({ key: `g${f.id}`, group: '드라이브', icon: HardDrive, label: f.name, sub: [data.projects.find(p => p.id === f.project_id)?.name, f.path].filter(Boolean).join(' / '), to: `/projects?id=${f.project_id}`, run: () => openDoc(f.url!) }, f.name))
      data?.research.forEach(r => add({ key: `d${r.id}`, group: '자료', icon: FileText, label: r.title, sub: [r.kind, r.brand_name].filter(Boolean).join(' · '), to: `/library?id=${r.id}` }, r.title, r.brand_name))
    }
    // 찾는 게 없어도 바로 할 수 있는 일: AI 에게 묻기 · 인터넷 검색 (맨 아래, 결과가 없으면 맨 위)
    const raw = q.trim()
    const acts: Hit[] = []
    if (raw)
      agents.forEach((agent, i) =>
        acts.push({ key: i === 0 ? 'act-ai' : `act-ai-${agent.id}`, group: 'AI', icon: Bot, label: `${agent.name}에게 묻기 · 지시`, sub: raw, to: '', score: 0.2, run: () => void askAi(agent.id, agent.name, raw) }),
      )
    if (raw) acts.push({ key: 'act-web', group: '인터넷', icon: Globe, label: '구글 · 인터넷 검색', sub: raw, to: '', score: 0.1, run: () => runWebSearch(raw) })
    const order = ['메뉴', '사람', '채팅방', '프로젝트', '거래처', '연락처', '할 일', '자료', '드라이브', 'AI', '인터넷']
    return [...out.sort((a, b) => b.score - a.score || order.indexOf(a.group) - order.indexOf(b.group)).slice(0, k ? 40 : 12), ...acts]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data, profiles, me, agents])

  useEffect(() => setSel(0), [q])
  async function askAi(id: string, name: string, text: string) {
    setAi({ id: null, name, text })
    setQ('')
    try {
      const insId = await api.instructAgent(id, text)
      bump()
      setAi(a => (a && a.text === text ? { ...a, id: insId } : a))
    } catch (e) {
      setAi(a => (a && a.text === text ? { ...a, error: e instanceof Error ? e.message : '보내지 못했습니다.' } : a))
    }
    window.setTimeout(() => input.current?.focus(), 20)
  }
  if (!open) return null
  const go = (h: Hit | undefined) => {
    if (!h) return
    // AI 에게: 창을 닫지 않고 아래에 답을 보여 줌
    if (h.key.startsWith('act-ai')) return h.run?.()
    setOpen(false)
    if (h.run) h.run()
    else navigate(h.to)
  }
  return createPortal(
    <div className="scrim cmdk-scrim" onMouseDown={e => e.target === e.currentTarget && setOpen(false)}>
      <div className="cmdk" role="dialog" aria-label="전체 검색 · 빠른 이동">
        <label className="cmdk-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setSel(s => Math.min(hits.length - 1, s + 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setSel(s => Math.max(0, s - 1)))
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                // 답을 보는 중이면 Enter 는 이어서 묻기
                if (ai && aiDone && !e.ctrlKey && !e.metaKey) go(hits.find(h => h.key.startsWith('act-ai') && h.label.startsWith(ai.name)))
                else if (e.ctrlKey || e.metaKey) go(hits.find(h => h.key === 'act-ai'))
                else if (e.shiftKey) go(hits.find(h => h.key === 'act-web'))
                else go(hits[sel])
              }
              else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder={ai ? `${ai.name}에게 이어서 묻기 (Enter) · 찾기` : '사람 · 프로젝트 · 파일 찾기, AI 에게 묻기, 인터넷 검색 (초성도 됨)'}
            aria-label="전체 검색"
          />
          <kbd>Esc</kbd>
        </label>
        {ai && !q.trim() ? (
          <div className="cmdk-ai" aria-live="polite">
            <div className="cmdk-ai-q">
              <Bot size={15} aria-hidden="true" />
              <span className="grow">{ai.text}</span>
              <span className="cmdk-group">{ai.name}</span>
            </div>
            <div className="cmdk-ai-a pre">
              {ai.error ? (
                <span className="t-red">{ai.error}</span>
              ) : ai.row?.response ? (
                <Linkify text={ai.row.response} />
              ) : (
                <span className="cmdk-ai-wait">{ai.name}이(가) 처리하는 중…</span>
              )}
            </div>
            <div className="cmdk-ai-foot">
              <span className="grow">{aiDone ? '이어서 물어보려면 위에 입력 후 Enter' : '닫아도 처리는 계속되고, 답은 알림으로도 옵니다.'}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setOpen(false), navigate('/?agent=1'))}>
                지시 기록
              </button>
            </div>
          </div>
        ) : (
        <div className="cmdk-list" role="listbox">
          {hits.length === 0 && <div className="cmdk-empty">{data ? '찾는 결과가 없습니다.' : '불러오는 중…'}</div>}
          {hits.map((h, i) => (
            <button key={h.key} type="button" role="option" aria-selected={i === sel} className={`cmdk-item${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
              <h.icon size={15} aria-hidden="true" />
              <span className="cmdk-label">{h.label}</span>
              {h.sub && <span className="cmdk-sub">{h.sub}</span>}
              <span className="cmdk-group">{h.group}</span>
            </button>
          ))}
        </div>
        )}
        <div className="cmdk-foot">↑↓ 고르기 · Enter 이동 · Ctrl+Enter AI 에게 (여기서 바로 답) · Shift+Enter 인터넷 검색 · ? 단축키</div>
      </div>
    </div>,
    document.body,
  )
}
