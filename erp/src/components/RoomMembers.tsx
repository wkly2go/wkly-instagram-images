import { useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { useRouter } from '../lib/router'
import type { ChatRoomSummary, Project, ProjectMember } from '../lib/types'
import { ask } from './Ask'
import { UserPic } from './UserPic'
import { Button, Modal } from './ui'

/**
 * 채팅방 참여 팀원 확인 · 추가 · 제외 (대표 지시 2026-11-10)
 *  - 여럿이 보는 비공개 방: 참여자 바로 추가 · 제외 (RPC chat_room_set_members · 0104)
 *  - 1:1 대화: 두 사람 고정 · 추가하면 함께하는 새 대화방
 *  - 프로젝트 방: 프로젝트 참여 팀원(담당 · 멤버) 추가 · 제외 → 이 방 알림을 모두 받음 (방은 팀원 모두 볼 수 있음)
 *  - 전체 공개 방: 팀원 모두 · 추가는 @불러서 알림
 */
export function RoomMembersModal({ room, onClose }: { room: ChatRoomSummary; onClose: () => void }) {
  const { api, me, profiles, profileName, version, bump, toast } = useApp()
  const { navigate } = useRouter()
  const { busy, run } = useAction()
  const [pick, setPick] = useState<string[]>([])
  const people = profiles.filter(p => p.active !== false)
  const isDm = !!room.members && room.name.startsWith('dm:')
  const isGroup = !!room.members && !isDm
  const isProject = !room.members && !!room.project_id
  const { data: proj } = useAsync(
    async () => {
      if (!isProject) return { project: null as Project | null, members: [] as ProjectMember[] }
      const [projects, members] = await Promise.all([api.listProjects(), api.listProjectMembers(room.project_id!)])
      return { project: projects.find(p => p.id === room.project_id) ?? null, members }
    },
    [room.id, version],
    { project: null as Project | null, members: [] as ProjectMember[] },
  )
  // 지금 참여자
  const current: string[] = room.members
    ? room.members
    : isProject
      ? [...new Set([...(proj.project?.owner_id ? [proj.project.owner_id] : []), ...proj.members.map(m => m.profile_id)])]
      : people.filter(p => !p.is_agent).map(p => p.id)
  const candidates = people.filter(p => !current.includes(p.id))
  const toggle = (id: string) => setPick(v => (v.includes(id) ? v.filter(x => x !== id) : [...v, id]))

  const remove = async (id: string) => {
    const name = profileName(id)
    if (!(await ask(`${name} 님을 이 대화방에서 뺄까요?${isGroup ? '\n빠지면 이 방을 더 볼 수 없습니다.' : ''}`))) return
    if (isGroup) {
      await run(async () => {
        await api.setRoomMembers(room.id, current.filter(x => x !== id))
        await api.sendMessage(room.id, `${profileName(me.id)} 님이 ${name} 님을 대화방에서 뺐습니다.`).catch(() => undefined)
      }, `${name} 님을 뺐습니다.`)
      bump()
      if (id === me.id) {
        onClose()
        navigate('/chat')
      }
    } else if (isProject) {
      await run(() => api.removeProjectMember(room.project_id!, id), `${name} 님을 프로젝트 참여에서 뺐습니다.`)
    }
  }
  const add = async () => {
    if (!pick.length) return
    const names = pick.map(profileName).join(', ')
    if (isGroup) {
      const ok = await run(async () => {
        await api.setRoomMembers(room.id, [...current, ...pick])
        await api.sendMessage(room.id, `${pick.map(id => `@${profileName(id)}`).join(' ')} 님을 이 대화방에 추가했습니다.`).catch(() => undefined)
      }, `${names} 님을 추가했습니다.`)
      if (ok) {
        bump()
        setPick([])
      }
      return
    }
    if (isProject) {
      const ok = await run(async () => {
        for (const id of pick) await api.addProjectMember(room.project_id!, id, null)
        await api.sendMessage(room.id, `${pick.map(id => `@${profileName(id)}`).join(' ')} 님을 이 프로젝트 방에 추가했습니다.`).catch(() => undefined)
      }, `${names} 님을 추가했습니다. 알림이 갑니다.`)
      if (ok) setPick([])
      return
    }
    if (isDm) {
      try {
        const r = await api.createGroupRoom([...current, ...pick])
        bump()
        toast(`${names} 님과 함께하는 새 대화방을 만들었습니다.`)
        onClose()
        navigate(`/chat?room=${r.id}`)
      } catch (e) {
        toast(friendlyError(e))
      }
      return
    }
    // 전체 공개 방: @불러 알림
    const ok = await run(() => api.sendMessage(room.id, `${pick.map(id => `@${profileName(id)}`).join(' ')} 님을 이 방에 초대했습니다.`), `${names} 님을 불렀습니다.`)
    if (ok) setPick([])
  }
  const canRemove = (id: string) => (isGroup && current.length > 2) || (isProject && proj.project?.owner_id !== id && proj.members.some(m => m.profile_id === id))
  const help = isGroup
    ? '참여한 사람만 볼 수 있는 대화방입니다. 빼면 그 사람은 이 방을 더 볼 수 없습니다.'
    : isDm
      ? '1:1 대화는 두 사람으로 고정입니다. 팀원을 추가하면 함께하는 새 대화방이 만들어집니다.'
      : isProject
        ? '프로젝트 참여 팀원(담당 · 멤버)은 이 방 새 글 알림을 모두 받습니다. 방 자체는 팀원 모두 볼 수 있습니다.'
        : '팀원 모두가 보는 방입니다. 추가하면 @이름으로 불러 알림을 보냅니다.'
  return (
    <Modal
      title={`참여 팀원 ${current.length}명`}
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button onClick={() => void add()} disabled={busy || !pick.length}>
            {pick.length ? `${pick.length}명 ${isDm ? '추가 (새 방)' : '추가'}` : '추가'}
          </Button>
        </>
      }
    >
      <span className="t-cap">{help}</span>
      <div className="rm-list">
        {current.map(id => (
          <div key={id} className="rm-item">
            <UserPic id={id} size={22} />
            <b>{profileName(id)}</b>
            {id === me.id && <span className="t-cap">나</span>}
            {isProject && proj.project?.owner_id === id && <span className="rm-tag">프로젝트 담당</span>}
            {profiles.find(p => p.id === id)?.is_agent && <span className="rm-tag ai">AI</span>}
            <span className="grow" />
            {canRemove(id) && (
              <button type="button" className="rm-out" disabled={busy} onClick={() => void remove(id)}>
                {id === me.id ? '나가기' : '빼기'}
              </button>
            )}
          </div>
        ))}
      </div>
      {candidates.length > 0 && (
        <>
          <span className="t-bodyb" style={{ marginTop: 6 }}>
            추가할 팀원
          </span>
          <div className="invite-list">
            {candidates.map(p => (
              <label key={p.id} className={`invite-item${pick.includes(p.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={pick.includes(p.id)} onChange={() => toggle(p.id)} />
                <UserPic id={p.id} size={22} />
                <span className="grow">
                  <b>{p.name}</b>
                  {p.is_agent ? <span className="t-cap"> · AI 팀원</span> : p.title && <span className="t-cap"> · {p.title}</span>}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
