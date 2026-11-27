// 협업 화이트보드 화면 (로드맵 3단계 · 2026-11-20 · /board?id=<보드 id>) — 넓게 보기 + 공용 편집기(components/BoardEditor)
import { useEffect } from 'react'
import { useRouter } from '../lib/router'
import BoardEditor from '../components/BoardEditor'

export default function BoardPage() {
  const { query } = useRouter()
  // 넓게 보기: 채팅 칸 · 오른쪽 일정 칸 숨김
  useEffect(() => {
    document.documentElement.setAttribute('data-board-wide', '1')
    return () => document.documentElement.removeAttribute('data-board-wide')
  }, [])
  return <BoardEditor id={query.get('id') ?? ''} />
}
