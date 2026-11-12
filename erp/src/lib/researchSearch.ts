import { useEffect, useState } from 'react'
import { useApp, useAsync } from './app'
import type { ResearchBodyMatch } from './types'

/** 검색할 때만 서버가 본문을 검색하고 일치한 ID만 돌려준다. */
export function useResearchBodyMatches(query: string) {
  const { api, me, version } = useApp()
  const normalized = [...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))].join(' ')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(normalized), 350)
    return () => window.clearTimeout(timer)
  }, [normalized])
  const { data, loading, error } = useAsync(async () => ({
    query: debounced, matches: debounced ? await api.findResearchBodies(debounced.split(' ')) : [],
  }), [debounced, me.id, version], { query: '', matches: [] as ResearchBodyMatch[] })
  return {
    matches: normalized && data.query === normalized ? data.matches : [],
    loading: !!normalized && (normalized !== debounced || loading), error: normalized ? error : null,
  }
}
