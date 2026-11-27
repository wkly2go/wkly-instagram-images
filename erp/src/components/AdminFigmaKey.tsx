// 관리 › 외부 연결 · 피그마 열쇠 (2026-11-27 대표 '한 번 넣으면 모든 프로젝트에서 쓰니 관리 탭에')
// 열쇠는 회사에 하나(금고 FIGMA_TOKEN) — 피그잼 연결 · 제출용 PDF · 화이트보드 '피그마 불러오기'가 함께 씀.
// 피그마 개인 토큰은 최대 90일 → 만료일을 보여 주고 7일 · 1일 전 관리자 알림(서버 figma_token_expiry).
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { TokenForm } from './ProjectFigma'
import { SectionHead } from './ui'

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }) : '–')

export function AdminFigmaKey() {
  const { api, version, bump } = useApp()
  const info = useAsync(() => api.figmaTokenInfo().catch(() => null), [api, version], null)
  const [open, setOpen] = useState(false)
  const d = info.data
  const left = d?.expires_at ? Math.ceil((Date.parse(d.expires_at) - Date.now()) / 86400000) : null
  return (
    <section className="section" id="external-keys" aria-label="외부 연결 열쇠">
      <SectionHead title="외부 연결 · 피그마 열쇠" right={<button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}><KeyRound size={13} /> {d?.token ? '피그마 열쇠 바꾸기' : '피그마 열쇠 넣기'}</button>} />
      <table className="table pay-grid admin-keys">
        <tbody>
          <tr><th>상태</th><td>{info.loading ? '확인 중' : d?.token ? <b className="t-blue">넣음 · 모든 프로젝트에서 사용</b> : <b className="t-red">아직 없음</b>}</td></tr>
          <tr><th>넣은 날</th><td>{day(d?.set_at ?? null)}</td></tr>
          <tr><th>만료일</th><td>{d?.expires_at ? <>{day(d.expires_at)} {left != null && <span className={left <= 7 ? 't-red' : 't-cap'}>({left > 0 ? `${left}일 남음` : '만료됨'})</span>}</> : d?.token ? '모름 (예전에 넣은 열쇠 · 다시 넣으면 만료일이 기록됨)' : '–'}</td></tr>
          <tr><th>연결된 피그마 보드</th><td>{d ? `${d.boards}개` : '–'}</td></tr>
          <tr><th>쓰는 곳</th><td>프로젝트 화면 ‘피그잼 · 피그마’(보드 연결 · 제출용 PDF) · 모든 화이트보드의 ‘피그마 불러오기’</td></tr>
          <tr><th>만료 알림</th><td>만료 7일 · 1일 전에 관리자에게 알림 · 피그마 토큰은 최대 90일이라 새로 만들어 ‘바꾸기’로 넣으면 됩니다</td></tr>
        </tbody>
      </table>
      {open && <TokenForm hasToken={!!d?.token} onClose={() => { setOpen(false); bump() }} />}
    </section>
  )
}
