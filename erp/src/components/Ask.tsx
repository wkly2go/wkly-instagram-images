import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

/**
 * 인트라넷 확인 · 입력 창 (2026-10-22 UI 개선): 브라우저 기본 확인창(window.confirm · prompt) 대신
 *  - 디자인 통일, PC 프로그램에서 인터넷 칸 뒤로 가려지지 않음 (.scrim 이 뜨면 인터넷 칸을 숨김)
 *  - ask('삭제할까요?') → Promise<boolean> · askText('새 이름', '기본값') → Promise<string | null>
 */
type Req = { kind: 'confirm' | 'text'; message: string; value?: string; resolve: (v: boolean | string | null) => void }
let current: Req | null = null
const listeners = new Set<() => void>()
const set = (r: Req | null) => {
  current = r
  listeners.forEach(l => l())
}
export const ask = (message: string) =>
  new Promise<boolean>(resolve => {
    current?.resolve(current.kind === 'confirm' ? false : null)
    set({ kind: 'confirm', message, resolve: v => resolve(v === true) })
  })
export const askText = (message: string, value = '') =>
  new Promise<string | null>(resolve => {
    current?.resolve(current.kind === 'confirm' ? false : null)
    set({ kind: 'text', message, value, resolve: v => resolve(typeof v === 'string' ? v : null) })
  })

export function AskHost() {
  const req = useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
  const [text, setText] = useState('')
  const okRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!req) return
    setText(req.value ?? '')
    const t = window.setTimeout(() => (req.kind === 'text' ? inputRef.current?.select() : okRef.current?.focus()), 30)
    return () => window.clearTimeout(t)
  }, [req])
  if (!req) return null
  const close = (v: boolean | string | null) => {
    req.resolve(v)
    set(null)
  }
  const ok = () => close(req.kind === 'text' ? text : true)
  const cancel = () => close(req.kind === 'text' ? null : false)
  return createPortal(
    <div className="scrim ask-scrim" onMouseDown={e => e.target === e.currentTarget && cancel()} onKeyDown={e => e.key === 'Escape' && cancel()}>
      <div className="ask" role="alertdialog" aria-modal="true" aria-label="확인">
        <p className="ask-msg">{req.message}</p>
        {req.kind === 'text' && (
          <input ref={inputRef} className="input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && ok()} aria-label={req.message} />
        )}
        <div className="ask-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
            취소
          </button>
          <button ref={okRef} type="button" className="btn btn-blue btn-sm" onClick={ok}>
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
