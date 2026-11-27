// 외부 협업방 화면 시험용 자료 — 개발 서버에서 VITE_COLLAB_HARNESS=1 일 때만 (운영 · 체험 모드 배포에는 들어가지 않음).
// 체험 모드에는 자료를 두지 않으므로 화면 확인 · 캡처는 이 파일로 한다. 이름 · 회사는 모두 지어낸 시험용.
//   VITE_COLLAB_HARNESS=1 npx vite --port 5182  →  '관리자 (대표)로 입장' → 프로젝트 › 외부 협업방
//                                                 /c  → 외부인 화면 (기기 열쇠를 미리 넣어 둠)
import { api } from '../lib/app'
import { guestApi, type GuestSync } from '../lib/collabGuest'
import type { CollabDriveFile, CollabEvent, CollabGuest, CollabLink, CollabMessage, CollabRoom } from '../lib/types'

const ADMIN = '00000000-0000-4000-8000-000000000001'
const SEOYEON = '00000000-0000-4000-8000-000000000004'
const ROOM = 'cccccccc-0000-4000-8000-000000000001'
const G1 = 'cccccccc-0000-4000-8000-0000000000a1'
const G2 = 'cccccccc-0000-4000-8000-0000000000a2'
const day = (offset: number) => new Date(Date.now() + offset * 86400e3 + 9 * 3600e3).toISOString().slice(0, 10)
const at = (offsetMin: number) => new Date(Date.now() - offsetMin * 60e3).toISOString()

const room: CollabRoom = { id: ROOM, project_id: '', title: '시험 카페 발주처방', intro: '공사 기간 중 문의 · 자료는 이 방에 남겨 주세요. 담당: 박서연 실장 (평일 9–18시)', drive_folder_id: 'harnessFolder0001', closed_at: null, created_by: ADMIN, created_at: at(4000) }
const guests: CollabGuest[] = [
  { id: G1, room_id: ROOM, name: '김지현 과장', org: '시험커피', role: '발주처', can_upload: true, expires_at: new Date(Date.now() + 50 * 86400e3).toISOString(), revoked_at: null, last_seen_at: at(12), read_upto: 6, invited_by: ADMIN, created_at: at(3000) },
  { id: G2, room_id: ROOM, name: '이도현 팀장', org: '시험커피', role: '발주처', can_upload: false, expires_at: new Date(Date.now() + 50 * 86400e3).toISOString(), revoked_at: null, last_seen_at: null, read_upto: 0, invited_by: ADMIN, created_at: at(200) },
]
const files: CollabDriveFile[] = [
  { id: 'harnessFile00001', name: '시험카페_평면도_1차.pdf', mime: 'application/pdf', size: 2_340_000, modified: at(1500), folder: '', user_id: SEOYEON, guest_id: null },
  { id: 'harnessFile00002', name: '현장 사진 (기존 상태).jpg', mime: 'image/jpeg', size: 1_820_000, modified: at(900), folder: '', user_id: null, guest_id: G1 },
  { id: 'harnessFile00003', name: '디자인 1차 보고서.pdf', mime: 'application/pdf', size: 8_100_000, modified: at(300), folder: '보고서', user_id: ADMIN, guest_id: null },
  { id: 'harnessFile00004', name: '공정표.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 48_000, modified: at(200), folder: '보고서', user_id: null, guest_id: null },
]
const messages: CollabMessage[] = [
  { id: 1, room_id: ROOM, user_id: SEOYEON, guest_id: null, body: '안녕하세요, 아트리어디자인스튜디오 박서연입니다. 이 방에서 일정 · 자료를 함께 나누겠습니다.', files: [], created_at: at(2900), deleted_at: null },
  { id: 2, room_id: ROOM, user_id: null, guest_id: G1, body: '네 반갑습니다. 기존 매장 사진 올려 드립니다.', files: [{ id: 'harnessFile00002', name: '현장 사진 (기존 상태).jpg', mime: 'image/jpeg', size: 1_820_000 }], created_at: at(900), deleted_at: null },
  { id: 3, room_id: ROOM, user_id: SEOYEON, guest_id: null, body: '감사합니다. 평면도 1차안 공유드립니다. 카운터 위치 두 가지 안을 비교해 보시고 의견 주세요.', files: [{ id: 'harnessFile00001', name: '시험카페_평면도_1차.pdf', mime: 'application/pdf', size: 2_340_000 }], created_at: at(600), deleted_at: null },
  { id: 4, room_id: ROOM, user_id: null, guest_id: G1, body: 'B안이 동선이 좋아 보입니다. 다음 주 미팅 때 자세히 이야기 나눠요.', files: [], created_at: at(80), deleted_at: null },
  { id: 5, room_id: ROOM, user_id: ADMIN, guest_id: null, body: '네, 목요일 오후 2시 현장에서 뵙겠습니다. 일정 탭에 넣어 두었습니다.', files: [], created_at: at(30), deleted_at: null },
  { id: 6, room_id: ROOM, user_id: null, guest_id: G1, body: '확인했습니다 👍', files: [], created_at: at(12), deleted_at: null },
]
const events: CollabEvent[] = [
  { id: 'e1', room_id: ROOM, kind: '미팅', title: '현장 실측', day: day(-6), end_day: null, start_time: '10:00', place: '현장', note: null },
  { id: 'e2', room_id: ROOM, kind: '미팅', title: '디자인 1차 보고 · B안 확정', day: day(2), end_day: null, start_time: '14:00', place: '현장', note: '샘플 마감재 지참' },
  { id: 'e3', room_id: ROOM, kind: '마일스톤', title: '착공', day: day(12), end_day: null, start_time: null, place: null, note: null },
  { id: 'e4', room_id: ROOM, kind: '일정', title: '공사 기간', day: day(12), end_day: day(33), start_time: null, place: null, note: '야간 작업 없음' },
  { id: 'e5', room_id: ROOM, kind: '마일스톤', title: '준공 · 인수인계', day: day(34), end_day: null, start_time: '11:00', place: '현장', note: null },
]
const links: CollabLink[] = [
  { id: 'l1', guest_id: G1, pending: false, invite_expires_at: at(-10000), device: '아이폰 · 카카오톡', created_at: at(3000), redeemed_at: at(2950), last_seen_at: at(12), revoked_at: null },
  { id: 'l2', guest_id: G2, pending: true, invite_expires_at: at(-20000), device: null, created_at: at(200), redeemed_at: null, last_seen_at: null, revoked_at: null },
]

// 방에 공유한 화이트보드 (지어낸 시험용)
const rect = (id: string, x: number, y: number, w: number, h: number, bg: string) => ({ id, type: 'rectangle', x, y, width: w, height: h, angle: 0, strokeColor: '#1f6b4a', backgroundColor: bg, fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: { type: 3 }, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false, index: null })
const text = (id: string, x: number, y: number, t: string, size = 20) => ({ id, type: 'text', x, y, width: t.length * size * 0.9, height: size * 1.25, angle: 0, strokeColor: '#151d18', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 2, version: 1, versionNonce: 2, isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false, index: null, text: t, fontSize: size, fontFamily: 2, textAlign: 'left', verticalAlign: 'top', containerId: null, originalText: t, autoResize: true, lineHeight: 1.25 })
const boardRows = [
  { id: 'bbbbbbbb-0000-4000-8000-000000000001', title: '[시험] 카운터 배치 A · B안', version: 3, updated_at: at(40), shared: true, can_edit: true, scene: { elements: [text('t0', 40, 20, '[시험] 카운터 배치 비교', 28), rect('r1', 40, 90, 360, 220, '#e7f2ec'), text('t1', 60, 110, 'A안 — 입구 정면'), rect('r2', 460, 90, 360, 220, '#fff4e0'), text('t2', 480, 110, 'B안 — 창가 쪽 (동선 좋음)'), text('t3', 40, 340, '의견을 이 보드에 바로 적어 주세요.')] as Record<string, unknown>[], files: {} } },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', title: '[시험] 마감재 보드', version: 1, updated_at: at(600), shared: true, can_edit: false, scene: { elements: [text('m0', 40, 20, '[시험] 마감재 (보기만)', 28), rect('m1', 40, 90, 200, 140, '#d9cfc1'), rect('m2', 260, 90, 200, 140, '#8a9a8f')] as Record<string, unknown>[], files: {} } },
  { id: 'bbbbbbbb-0000-4000-8000-000000000003', title: '[시험] 내부 검토 (공유 안 함)', version: 1, updated_at: at(900), shared: false, can_edit: true, scene: { elements: [] as Record<string, unknown>[], files: {} } },
]

export function installCollabHarness() {
  Object.assign(api, {
    listCollab: async (projectId: string) => ({ rooms: [{ ...room, project_id: projectId }], guests, events }),
    listCollabMessages: async () => messages,
    listCollabFiles: async () => ({ folder: true, files }),
    listCollabLinks: async () => links,
    postCollabMessage: async (_room: string, body: string) => {
      const m: CollabMessage = { id: messages.length + 1, room_id: ROOM, user_id: ADMIN, guest_id: null, body, files: [], created_at: new Date().toISOString(), deleted_at: null }
      messages.push(m)
      return m
    },
    inviteCollabGuest: async (_room: string, g: { name: string; org?: string }) => ({ guest: { ...guests[0], id: 'new', name: g.name, org: g.org ?? null, last_seen_at: null }, token: 'HarnessInviteToken_0123456789abcdefghijklmnopq' }),
    relinkCollabGuest: async () => 'HarnessInviteToken_0123456789abcdefghijklmnopq',
    listBoards: async () => boardRows.map(b => ({ id: b.id, project_id: 'x', title: b.title, version: b.version, created_by: ADMIN, updated_by: ADMIN, created_at: b.updated_at, updated_at: b.updated_at, count: (b.scene.elements as unknown[]).length })),
    createBoard: async (_p: string, title: string) => { const b = { id: `bbbbbbbb-0000-4000-8000-00000000000${boardRows.length + 1}`, title, version: 1, updated_at: new Date().toISOString(), shared: false, can_edit: true, scene: { elements: [] as Record<string, unknown>[], files: {} } }; boardRows.push(b); return { id: b.id, project_id: 'x', title, version: 1, created_by: ADMIN, updated_by: ADMIN, created_at: b.updated_at, updated_at: b.updated_at } },
    listCollabBoards: async () => boardRows.filter(b => b.shared).map(b => ({ room_id: ROOM, board_id: b.id, can_edit: b.can_edit })),
    setCollabBoard: async (_room: string, id: string, share: boolean, canEdit = true) => {
      const b = boardRows.find(x => x.id === id)
      if (b) { b.shared = share; b.can_edit = canEdit }
    },
  })
}

/** 외부인 화면: 이 브라우저에 시험 열쇠를 넣고 서버 대신 시험 자료로 응답 */
export function installGuestHarness() {
  try {
    localStorage.setItem('wkly-collab-keys', JSON.stringify([{ room_id: ROOM, key: 'harness', invite: 'harness', title: room.title, saved_at: new Date().toISOString() }]))
  } catch {
    /* 저장 못 하면 화면이 '초대 링크로 들어와 주세요'로 보임 */
  }
  const sync: GuestSync = {
    me: { id: G1, name: '김지현 과장', org: '시험커피', role: '발주처', can_upload: true, read_upto: 4 },
    messages,
    people: { u: { [ADMIN]: { name: '박기호', title: '대표', org: '아트리어디자인스튜디오' }, [SEOYEON]: { name: '박서연', title: '실장', org: '아트리어디자인스튜디오' } }, g: { [G1]: { name: '김지현 과장', org: '시험커피', role: '발주처' }, [G2]: { name: '이도현 팀장', org: '시험커피', role: '발주처' } } },
    room: { id: ROOM, title: room.title, intro: room.intro, company: '아트리어디자인스튜디오', division: 'AR', project: { name: '시험 카페 리뉴얼 (개발 서버 전용)', start_date: day(-10), end_date: day(34) }, files: true },
    events,
  }
  Object.assign(guestApi, {
    sync: async (_k: string, since: number) => (since ? { ...sync, messages: messages.filter(m => m.id > since), room: undefined, events: undefined } : sync),
    read: async () => ({ ok: true }),
    boards: async () => boardRows.filter(b => b.shared).map(b => ({ id: b.id, title: b.title, version: b.version, updated_at: b.updated_at, can_edit: b.can_edit })),
    boardGet: async (_k: string, id: string) => { const b = boardRows.find(x => x.id === id)!; return { board: { id: b.id, title: b.title, version: b.version, updated_at: b.updated_at, can_edit: b.can_edit }, scene: b.scene, urls: {} } },
    boardVersion: async (_k: string, id: string) => boardRows.find(x => x.id === id)!.version,
    boardSave: async (_k: string, id: string, scene: unknown, version: number) => {
      const b = boardRows.find(x => x.id === id)!
      if (b.version !== version) return { ok: false, version: b.version, scene: b.scene, updated_by_name: '박서연' }
      b.scene = scene as typeof b.scene; b.version += 1; b.updated_at = new Date().toISOString()
      return { ok: true, version: b.version }
    },
    boardUpload: async () => ({ exists: true }),
    files: async () => ({ folder: true, files }),
    post: async (_k: string, body: string) => {
      const m: CollabMessage = { id: messages.length + 1, room_id: ROOM, user_id: null, guest_id: G1, body, files: [], created_at: new Date().toISOString(), deleted_at: null }
      messages.push(m)
      return { message: m }
    },
  })
}
