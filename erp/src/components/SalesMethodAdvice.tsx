import { useState } from 'react'
import { recommendSalesMethod, salesMethodDraft, SALES_METHODS, type MethodInput } from '../lib/salesMethods'
import { Button } from './ui'
import './SalesMethodAdvice.css'

export function SalesMethodAdvice({input,onApplyNext,disabled=false}:{input:MethodInput;onApplyNext?:(value:string)=>void;disabled?:boolean}){
 const recommended=recommendSalesMethod(input)
 const [chosen,setChosen]=useState('')
 const method=recommended.id==='hold'?recommended:SALES_METHODS.find(m=>m.id===chosen)??recommended
 return <section className="sales-method-advice" aria-label="영업 방법 제안">
  <h3>제안할 영업 방법 · {method.title}</h3>
  <p>{method.intent}</p><p className="sales-method-caveat">기록의 단서로 제안한 방법입니다. 실제 수요·담당 역할은 아래 질문과 원문으로 확인하세요.</p>
  {recommended.id!=='hold'&&<label className="sales-method-choice">다른 방법 검토 <select className="select" value={chosen} onChange={e=>setChosen(e.target.value)} disabled={disabled}><option value="">기록에 맞춘 추천</option>{SALES_METHODS.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label>}
  <dl className="sales-method-facts"><div><dt>누구에게</dt><dd>{method.buyer}</dd></div><div><dt>연락 경로</dt><dd>{method.channel}</dd></div><div><dt>제안할 내용</dt><dd>{method.offer}</dd></div><div><dt>준비할 근거</dt><dd>{method.proof}</dd></div></dl>
  <h4>먼저 확인할 질문</h4><ol>{method.questions.map(q=><li key={q}>{q}</li>)}</ol>
  <h4>진행 순서</h4><ol>{method.steps.map(s=><li key={s}>{s}</li>)}</ol>
  <p><b>다음 단계로 넘어가는 기준</b> · {method.exit}</p>
  <details><summary>상대 답변에 따른 대응</summary><p>“{method.objection}”</p><p>{method.response}</p></details>
  {recommended.id!=='hold'&&<details><summary>첫 연락 문안 미리보기</summary><p className="sales-method-caveat">검토용 초안입니다. 사실과 연락 가능 여부를 확인한 뒤 수정해 사용하세요.</p><pre>{salesMethodDraft(input,method)}</pre></details>}
  {onApplyNext&&recommended.id!=='hold'&&<Button kind="outline" disabled={disabled} onClick={()=>onApplyNext(method.nextAction)}>이 방법을 다음 행동에 적용</Button>}
 </section>
}
