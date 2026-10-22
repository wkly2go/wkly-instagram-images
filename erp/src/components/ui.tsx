import { useFirstLoading } from '../lib/app'
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { detailSlot, usePanelWide } from './RightPanel'
import type { ApprovalStatus, LogKind, ProjectStatus, TaskStatus, TodayStatus } from '../lib/types'

type BtnKind = 'blue' | 'yellow' | 'outline' | 'ghost'

export function Button({ kind = 'blue', size, block, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; size?: 'sm'; block?: boolean }) {
  return <button type="button" className={`btn btn-${kind} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`} {...rest} />
}

export type Tone = 'outline' | 'yellow' | 'acid' | 'blue' | 'red' | 'paper' | 'gray' | 'green'

export function Badge({ tone = 'outline', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  )
}

const STATUS_TONE: Record<string, Tone> = {
  대기: 'yellow',
  승인: 'acid',
  반려: 'gray',
  취소: 'paper',
  기획: 'outline',
  진행: 'blue',
  NIC: 'red',
  완료: 'acid',
  보류: 'paper',
  '할 일': 'outline',
  '진행 중': 'blue',
  지연: 'red',
}

export function StatusBadge({ status }: { status: ApprovalStatus | ProjectStatus | TaskStatus | '지연' }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'outline'} title={status === 'NIC' ? 'Not In Contract · 계약 전' : undefined}>
      {status}
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: LogKind | string }) {
  return <Badge tone={kind.startsWith('메일') ? 'yellow' : 'outline'}>{kind}</Badge>
}

const TODAY_TONE: Record<TodayStatus | '미출근', Tone> = { 출근: 'acid', 외근: 'yellow', 미팅: 'yellow', 재택: 'outline', 휴가: 'paper', 퇴근: 'paper', 미출근: 'gray' }
export function TodayBadge({ status }: { status: TodayStatus | '미출근' }) {
  return <Badge tone={TODAY_TONE[status] ?? 'outline'}>{status}</Badge>
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`chip ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={!!active}>
      {children}
    </button>
  )
}

/** 이름별 고정 색 (노랑 · 블루 · 그린 · acid · 연블루) — 같은 사람은 늘 같은 색 */
export function toneOf(name: string | null | undefined): string {
  const n = Array.from(name ?? '').reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7)
  return ['', 'c1', 'c2', 'c3', 'c4'][n % 5]
}

export function Avatar({ name, size }: { name: string | null | undefined; size?: 'sm' | 'xs' }) {
  const ch = Array.from((name ?? '?').trim())[0] ?? '?'
  return (
    <span className={`avatar ${size ?? ''} ${toneOf(name)}`} aria-hidden="true">
      {ch}
    </span>
  )
}

export function SectionHead({ title, count, right }: { title: string; count?: number | string; right?: ReactNode }) {
  return (
    <div className="section-h">
      <span className="t-bodyb">{title}</span>
      {count !== undefined && <Badge tone="yellow">{count}</Badge>}
      {right && <span className="more">{right}</span>}
    </div>
  )
}

/** 보고서 · 자료 종류별 색: 어디서나 같은 종류는 같은 색 */
const KIND_TONE: Record<string, Tone> = {
  '업무 보고': 'blue',
  '일일 보고': 'acid',
  회의록: 'green' as Tone,
  '메일 발송': 'yellow',
  프로젝트: 'green' as Tone,
  거래처: 'paper',
  '할 일': 'outline',
  지출: 'red',
  '거래처 리포트': 'blue',
  팝업: 'yellow',
  브랜드: 'acid',
  트렌드: 'green' as Tone,
  경쟁사: 'red',
  인터뷰: 'paper',
  기타: 'gray',
}
export function KindTag({ kind }: { kind: string }) {
  return <Badge tone={KIND_TONE[kind] ?? 'outline'}>{kind}</Badge>
}

export function Empty({ children }: { children: ReactNode }) {
  // 처음 불러오는 동안에는 '없습니다' 대신 뼈대 줄 (내용이 오면 바로 바뀜)
  if (useFirstLoading())
    return (
      <div className="empty loading" aria-busy="true" aria-label="불러오는 중">
        <i />
        <i />
        <i />
      </div>
    )
  return <div className="empty">{children}</div>
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`label ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Modal({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // 전체 공통 (대표 지시 2026-10-17): 넓은 화면에서는 팝업 대신 결과 칸 자리에 왼쪽→오른쪽으로 펼쳐짐
  const panelWide = usePanelWide()
  if (panelWide && detailSlot?.isConnected) {
    return createPortal(
      <aside className="detail-col modal-col" role="dialog" aria-label={title}>
        <div className="detail-head">
          <span className="grow truncate">{title}</span>
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label="닫기" title="닫기">
            <X size={14} />
          </button>
        </div>
        <div className="detail-body col gap-10">
          {children}
          {actions && <div className="dialog-actions">{actions}</div>}
        </div>
      </aside>,
      detailSlot,
    )
  }
  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="inner">
          <div className="row">
            <h2 className="t-title grow">{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
              <X size={18} />
            </button>
          </div>
          {children}
          {actions && <div className="dialog-actions">{actions}</div>}
        </div>
      </div>
    </div>
  )
}

export function Loading() {
  return <div className="empty">불러오는 중…</div>
}
