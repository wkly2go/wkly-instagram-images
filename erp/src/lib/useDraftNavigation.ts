import { useEffect, useRef } from 'react'
import { registerDraftNavigation } from './navigationGuard'

export function useDraftNavigation(dirty: boolean, busy: boolean) {
  const state = useRef({ dirty, busy })
  state.current = { dirty, busy }
  useEffect(() => registerDraftNavigation(window, () => state.current, () => window.confirm('저장하지 않은 내용이 있습니다. 이동할까요?')), [])
}
