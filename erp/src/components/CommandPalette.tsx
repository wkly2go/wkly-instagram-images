import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Briefcase, Building2, FileText, FolderKanban, Hash, ListTodo, Search, User, LayoutGrid } from 'lucide-react'
import { useApp } from '../lib/app'
import { useRouter } from '../lib/router'
import type { ChatRoomSummary, Client, Contact, Project, ResearchItem, Task } from '../lib/types'
import { TABS } from './Shell'

/**
 * 전체 검색 · 빠른 이동 (Ctrl+K · ⌘K) — 슬랙 '빠른 전환' 참고 (2026-10-22)
 *  - 사람 · 채팅방 · 프로젝트(연번) · 거래처 · 연락처 · 할 일 · 자료 · 메뉴를 한 칸에서 찾고 Enter 로 이동
 *  - 한글 초성으로도 찾음 (예: ㅎㄴ → 한남)
 */
type Hit = { key: string; group: string; icon: typeof Search; label: string; sub?: string; to: string; score: number }

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
export const openCommandPalette = () => openSet?.(true)

export function CommandPalette() {
  const { api, profiles, me } = useApp()
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [data, setData] = useState<{ projects: Project[]; clients: Client[]; contacts: Contact[]; rooms: ChatRoomSummary[]; tasks: Task[]; research: ResearchItem[] } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  openSet = setOpen

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
    setQ('')
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
    ]).then(([projects, clients, contacts, rooms, tasks, research]) => setData({ projects, clients, contacts, rooms, tasks, research }))
  }, [open, api])

  const hits = useMemo(() => {
    const k = q.trim().toLowerCase()
    const out: Hit[] = []
    const add = (h: Omit<Hit, 'score'>, ...texts: (string | null | undefined)[]) => {
      const s = Math.max(...texts.filter(Boolean).map(t => score(t!, k)))
      if (s > 0) out.push({ ...h, score: s })
    }
    TABS.filter(t => !t.admin || me.role === 'admin').forEach(t => add({ key: `m${t.key}`, group: '메뉴', icon: LayoutGrid, label: t.label, to: t.path }, t.label))
    if (k) {
      profiles.filter(p => p.active && p.id !== me.id).forEach(p => add({ key: `u${p.id}`, group: '사람', icon: User, label: p.name, sub: [p.title, p.is_agent ? 'AI' : null].filter(Boolean).join(' · '), to: `/chat?dm=${p.id}` }, p.name, p.title))
      data?.rooms.filter(r => !r.members?.length).forEach(r => add({ key: `r${r.id}`, group: '채팅방', icon: Hash, label: r.name, to: `/chat?room=${r.id}` }, r.name))
      data?.projects.forEach(p => add({ key: `p${p.id}`, group: '프로젝트', icon: FolderKanban, label: p.name, sub: [p.code, p.status, p.location].filter(Boolean).join(' · '), to: `/projects?id=${p.id}` }, p.name, p.code, p.location))
      data?.clients.forEach(c => add({ key: `c${c.id}`, group: '거래처', icon: Building2, label: c.name, sub: c.category, to: `/clients?id=${c.id}` }, c.name))
      data?.contacts.forEach(c => add({ key: `ct${c.id}`, group: '연락처', icon: Briefcase, label: c.name, sub: [c.title, data.clients.find(x => x.id === c.client_id)?.name, c.email].filter(Boolean).join(' · '), to: `/clients?view=people&pid=${c.id}` }, c.name, c.email, c.phone))
      data?.tasks.filter(t => t.status !== '완료').forEach(t => add({ key: `t${t.id}`, group: '할 일', icon: ListTodo, label: t.title, sub: [t.due_date, profiles.find(p => p.id === t.assignee_id)?.name].filter(Boolean).join(' · '), to: t.project_id ? `/projects?id=${t.project_id}` : '/projects?view=mine' }, t.title))
      data?.research.forEach(r => add({ key: `d${r.id}`, group: '자료', icon: FileText, label: r.title, sub: [r.kind, r.brand_name].filter(Boolean).join(' · '), to: `/library?id=${r.id}` }, r.title, r.brand_name))
    }
    const order = ['메뉴', '사람', '채팅방', '프로젝트', '거래처', '연락처', '할 일', '자료']
    return out.sort((a, b) => b.score - a.score || order.indexOf(a.group) - order.indexOf(b.group)).slice(0, k ? 40 : 12)
  }, [q, data, profiles, me])

  useEffect(() => setSel(0), [q])
  if (!open) return null
  const go = (h: Hit | undefined) => {
    if (!h) return
    setOpen(false)
    navigate(h.to)
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
              else if (e.key === 'Enter') go(hits[sel])
              else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="사람 · 채팅방 · 프로젝트 · 거래처 · 연락처 · 할 일 · 자료 찾기 (초성도 됨)"
            aria-label="전체 검색"
          />
          <kbd>Esc</kbd>
        </label>
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
        <div className="cmdk-foot">↑↓ 고르기 · Enter 이동 · Ctrl+K 열고 닫기</div>
      </div>
    </div>,
    document.body,
  )
}
