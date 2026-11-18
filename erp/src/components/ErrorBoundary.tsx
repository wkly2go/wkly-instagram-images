// 화면 오류 막이 (2026-11-19 대표 지시 '안정적인 시스템을 만들어')
// 한 화면이 그리다 멈춰도 인트라넷 전체가 하얗게 비지 않게, 그 자리에만 안내와 다시 시도 단추를 보여 준다.
//  - 새 버전이 배포된 뒤 예전 화면에서 아직 열지 않은 메뉴를 누르면 예전 조각 파일이 없어 화면을 못 불러온다
//    → '새 버전으로 열기' 단추 (저절로 새로고침하지 않는다 · 2026-11-17 대표 지시 '필요한 사람만 업데이트')
//  - 그 밖의 오류는 '다시 시도'(같은 화면 다시 그리기) · '홈으로'. 다른 메뉴로 옮기면 저절로 풀린다(key)
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isStaleChunkError } from '../lib/staleChunk'

interface Props { children: ReactNode; area?: string; full?: boolean }
interface State { error: unknown }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: unknown): State {
    return { error: error ?? new Error('알 수 없는 오류') }
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[화면 오류] ${this.props.area ?? '화면'}`, error, info.componentStack)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isStaleChunkError(error)
    const detail = error instanceof Error ? error.message : String(error)
    return (
      <div role="alert" className={this.props.full ? 'center-page' : undefined} style={{ padding: this.props.full ? 24 : '24px 16px' }}>
        <div className="note" style={{ maxWidth: 560, lineHeight: 1.7 }}>
          <b>{stale ? '인트라넷이 새 버전으로 바뀌었습니다.' : `${this.props.area ?? '이'} 화면을 여는 중 문제가 생겼습니다.`}</b>
          <p style={{ margin: '6px 0 12px' }}>
            {stale
              ? '이 메뉴는 새 버전에서만 열 수 있습니다. 아래 단추를 누르면 새 버전으로 다시 엽니다. 쓰던 글이 있으면 먼저 저장해 주세요.'
              : '다른 메뉴는 그대로 쓸 수 있습니다. 다시 시도해도 같으면 관리자에게 알려 주세요.'}
          </p>
          <div className="row wrap" style={{ gap: 6 }}>
            {stale ? (
              <button type="button" className="btn btn-blue btn-sm" onClick={() => window.location.reload()}>새 버전으로 열기</button>
            ) : (
              <button type="button" className="btn btn-blue btn-sm" onClick={() => this.setState({ error: null })}>다시 시도</button>
            )}
            {!this.props.full && <a className="btn btn-outline btn-sm" href="/">홈으로</a>}
            {this.props.full && !stale && <button type="button" className="btn btn-outline btn-sm" onClick={() => window.location.reload()}>새로고침</button>}
          </div>
          {!stale && <small style={{ display: 'block', marginTop: 10, color: 'var(--tx-sub)', overflowWrap: 'anywhere' }}>오류 내용: {detail.slice(0, 200)}</small>}
        </div>
      </div>
    )
  }
}
