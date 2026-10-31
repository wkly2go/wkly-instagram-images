import { Fragment, type ReactNode } from 'react'
import { Empty } from './ui'

/**
 * 게시판 표: 번호 · 구분 · 제목 · 작성자 · 날짜 · 상태 처럼 열이 고정된 표.
 *  - 모든 목록 화면이 같은 모양이 되도록 여기 하나로 그린다
 *  - 줄을 누르면 onRow, 고른 줄은 노랑. 번호는 최신이 큰 수(게시판 관례)
 */
export interface BoardCol<T> {
  key: string
  /** 머리글 */
  label: ReactNode
  /** 셀 내용 */
  cell: (row: T, index: number) => ReactNode
  /** 열 폭 (px 또는 %). 없으면 내용대로 */
  width?: number | string
  /** 'num' 오른쪽 정렬 · 'center' 가운데 · 'title' 제목(넓게, 말줄임) */
  kind?: 'num' | 'center' | 'title'
  /** 좁은 화면(800px 미만)에서 숨김 */
  hideNarrow?: boolean
}

export function Board<T>({ rows, cols, rowKey, onRow, selectedId, numbered = true, empty, className = '', rowClass, compact, expand }: {
  rows: T[]
  cols: BoardCol<T>[]
  rowKey: (row: T) => string
  onRow?: (row: T) => void
  selectedId?: string | null
  /** 번호 열 (최신 글이 큰 번호) */
  numbered?: boolean
  empty?: ReactNode
  className?: string
  rowClass?: (row: T) => string | undefined
  compact?: boolean
  /** 줄 바로 아래로 펼쳐 보일 내용 (없으면 null) */
  expand?: (row: T) => ReactNode | null
}) {
  const total = rows.length
  return (
    <div className={`board-wrap ${className}`}>
      <table className={`board${compact ? ' compact' : ''}${onRow ? ' clickable' : ''}`}>
        <colgroup>
          {numbered && <col style={{ width: 44 }} />}
          {cols.map(c => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {numbered && <th className="center">번호</th>}
            {cols.map(c => (
              <th key={c.key} className={`${c.kind ?? ''}${c.hideNarrow ? ' hide-narrow' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const id = rowKey(r)
            const more = expand?.(r)
            return (
              <Fragment key={id}>
              <tr
                key={id}
                className={`${selectedId === id ? 'sel' : ''} ${rowClass?.(r) ?? ''}`}
                onClick={onRow ? () => onRow(r) : undefined}
                tabIndex={onRow ? 0 : undefined}
                onKeyDown={onRow ? e => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onRow(r)) : undefined}
              >
                {numbered && <td className="center num-col">{total - i}</td>}
                {cols.map(c => (
                  <td key={c.key} className={`${c.kind ?? ''}${c.hideNarrow ? ' hide-narrow' : ''}`}>
                    {c.cell(r, i)}
                  </td>
                ))}
              </tr>
              {more && (
                <tr className="board-expand">
                  <td colSpan={cols.length + (numbered ? 1 : 0)}>{more}</td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <Empty>{empty ?? '글이 없습니다.'}</Empty>}
    </div>
  )
}

/** 게시판 위 띠: 제목 · 건수 · 오른쪽 버튼 */
export function BoardHead({ title, count, right, children }: { title: ReactNode; count?: number | string; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="board-head">
      <span className="t-bodyb">{title}</span>
      {count !== undefined && <span className="board-count">{count}</span>}
      {children}
      {right && <span className="more">{right}</span>}
    </div>
  )
}
