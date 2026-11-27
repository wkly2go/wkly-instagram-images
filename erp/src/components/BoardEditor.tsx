// 협업 화이트보드 편집기 — 팀원 화면용 (/board 화면 · 프로젝트 화면이 함께 씀)
// 실제 편집기는 BoardEditorCore.tsx (외부 협업방의 외부인 화면도 같이 씀 · 2026-11-27). 여기는 인트라넷 API · 로그인한 사람 · 알림 · 피그마 불러오기를 넘겨 줄 뿐.
import { useApp } from '../lib/app'
import BoardEditorCore from './BoardEditorCore'
import { BoardFigmaImport } from './BoardFigmaImport'

export default function BoardEditor({ id, embedded = false, onClose }: { id: string; embedded?: boolean; onClose?: () => void }) {
  const { api, me, toast } = useApp()
  return <BoardEditorCore id={id} embedded={embedded} onClose={onClose} api={api} me={{ id: me.id, name: me.name }} toast={toast} figma={p => <BoardFigmaImport {...p} />} />
}
