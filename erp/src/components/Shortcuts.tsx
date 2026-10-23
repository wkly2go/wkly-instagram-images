import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../lib/app'
import { useRouter } from '../lib/router'
import { TABS } from './Shell'

/**
 * 단축키 (2026-10-23 "손에 붙게")
 *  - ? 단축키 보기 · Alt+1~9 메뉴 이동 · Ctrl K 찾기
 *  - 채팅: Alt+↑↓ 방 이동 · Alt+Shift+↑↓ 안 읽은 방 · Esc 읽음 처리 (Chat 화면에서 처리)
 */
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

export const SHORTCUTS: [string, string][] = [
  ['Ctrl K', '찾기 · AI 에게 묻기 · 인터넷 검색'],
  ['Ctrl Enter', '(찾기 창에서) AI 에게 보내기'],
  ['Shift Enter', '(찾기 창에서) 인터넷 검색'],
  ['Alt 1 ~ 9', '메뉴 이동 (홈 · 보고서 결제 · 채팅 …)'],
  ['Alt ↑ ↓', '채팅방 위 · 아래로'],
  ['Alt Shift ↑ ↓', '안 읽은 채팅방으로'],
  ['Esc', '채팅방 읽음 처리 · 창 닫기'],
  ['/', '채팅 입력칸에서 명령 (/할일 · /결재 · /일정 · /ai)'],
  ['?', '이 단축키 보기'],
]

export function Shortcuts() {
  const { me } = useApp()
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) return setOpen(false)
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
        const tabs = TABS.filter(t => !t.admin || me.role === 'admin')
        const t = tabs[Number(e.code.slice(5)) - 1]
        if (t) {
          e.preventDefault()
          navigate(t.path)
        }
        return
      }
      if (e.key === '?' && !typing(e.target) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, me.role, navigate])
  if (!open) return null
  return createPortal(
    <div className="scrim cmdk-scrim" onMouseDown={e => e.target === e.currentTarget && setOpen(false)}>
      <div className="cmdk keys-help" role="dialog" aria-label="단축키">
        <div className="row gap-6" style={{ padding: '12px 14px', borderBottom: '1px dashed var(--line)' }}>
          <b className="t-bodyb grow">단축키</b>
          <kbd>Esc</kbd>
        </div>
        <dl className="keys-list">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>{k.split(' ').map(x => <kbd key={x}>{x}</kbd>)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  )
}
