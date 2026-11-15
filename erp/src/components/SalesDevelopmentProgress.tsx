import {developmentGates,developmentProgress,salesDevelopmentCheckpoint as checkpoint} from '../lib/salesDevelopment'
import './SalesDevelopmentProgress.css'

export function SalesDevelopmentProgress(){
 const progress=developmentProgress(checkpoint.milestones)
 return <aside className="sales-development" aria-label="영업 자동화 개발 현황">
  <details>
   <summary>
    <strong>영업 자동화 개발 <b>{progress.percent}% 완료 · {progress.remaining}% 남음</b></strong>
    <span className="sales-development-meter" aria-hidden="true"><span style={{width:`${progress.percent}%`}}/></span>
    <span>{checkpoint.status}</span><span className="sales-development-toggle">진행 내역</span>
   </summary>
   <div className="sales-development-details">
    <p><strong>최근 저장된 개발 상태</strong> · <time dateTime={checkpoint.updatedAt}>{new Date(checkpoint.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time> (한국 시간)</p>
    <p>실시간 작업 감시가 아닙니다. 새 개발 기록이 배포되면 화면을 다시 열어 확인합니다. 아래 비율은 소요 시간 예측이 아닌 완료 기준 체크리스트입니다.</p>
    <p><strong>현재 대기 사유:</strong> {checkpoint.blocker}</p>
    <p><strong>다음 개발:</strong> {checkpoint.next}</p>
    <p>{checkpoint.milestones.length}개 기능 × 4개 기준 = {progress.total}개 중 {progress.completed}개 완료 · 각 기준 동일 가중치 · 소수점 버림</p>
    <ul className="sales-development-counts">{developmentGates.map((gate,index)=><li key={gate}>{gate} <strong>{progress.byGate[index]}/{checkpoint.milestones.length}</strong></li>)}</ul>
    <ol className="sales-development-list">{checkpoint.milestones.map(row=><li key={row.name}>
     <strong>{row.name}</strong>
     <ul>{developmentGates.map((gate,index)=><li key={gate} data-done={row.gates[index]}>{gate}: {row.gates[index]?'완료':'미완료'}</li>)}</ul>
     <p>{row.evidence}</p>
    </li>)}</ol>
    <p><a href={checkpoint.source} target="_blank" rel="noreferrer">개발 변경 기록 PR #399</a> · 외부 이메일·DM 발송은 아직 실행되지 않습니다.</p>
   </div>
  </details>
 </aside>
}
