import { useApp } from '../lib/app'
import { Avatar } from './ui'

/**
 * 팀원 사진 (대표 지시 2026-10-28 "개인의 사진을 팀원들과 공유")
 * - 프로필 사진이 있으면 사진, 없으면 이름 첫 글자
 * - 채팅 · 업무 팀원 목록 · 팀 화면 · 1:1 대화방에 같이 씀
 */
export function UserPic({ id, size = 24 }: { id: string | null | undefined; size?: number }) {
  const { profiles } = useApp()
  const p = id ? profiles.find(x => x.id === id) : undefined
  if (p?.photo) return <img className="user-pic" src={p.photo} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" />
  return (
    <span className="user-pic-fallback" style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}>
      <Avatar name={p?.name} size="xs" />
    </span>
  )
}
