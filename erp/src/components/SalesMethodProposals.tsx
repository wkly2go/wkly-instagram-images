import {useState} from 'react'
import type {Api} from '../lib/api'
import {useAsync} from '../lib/app'
import type {SalesMethodProposal} from '../lib/salesStrategy'
import {Button} from './ui'
import './SalesMethodProposals.css'

/** Weekly AI review of the sales methods. A proposal changes the playbook only when the administrator approves it. */
export function SalesMethodProposals({api,canDecide}:{api:Api;canDecide:boolean}){
 const state=useAsync(()=>api.listSalesMethodProposals(),[api],[] as SalesMethodProposal[])
 const [busy,setBusy]=useState(''),[error,setError]=useState('')
 if(state.loading||state.error||!state.data.length)return null
 const decide=async(row:SalesMethodProposal,decision:'승인'|'반려')=>{
  if(busy)return
  setBusy(row.id);setError('')
  try{await api.decideSalesMethodProposal(row.id,decision)}catch(e){setError(e instanceof Error?e.message:'결정을 저장하지 못했습니다.')}finally{setBusy('');state.reload()}
 }
 return <section className="sales-method-proposals" aria-label="영업 방법 개선 제안">
  <header><h2>영업 방법 개선 제안</h2><p>AI가 지난 승인·반려 결과를 검토해 영업 방법을 고치자고 제안했습니다. 승인하면 다음 기획부터 반영됩니다.</p></header>
  {error&&<p role="alert">{error}</p>}
  {state.data.map(row=><article key={row.id}>
   <h3><span>{row.action}</span>{row.name}</h3>
   {row.action!=='중지'&&<dl><div><dt>출발 신호</dt><dd>{row.signal}</dd></div><div><dt>제안 내용</dt><dd>{row.offer}</dd></div><div><dt>첫 접근</dt><dd>{row.first_step}</dd></div></dl>}
   <p><strong>판단 근거</strong> {row.reason}</p>
   {canDecide&&<div className="row wrap"><Button disabled={!!busy} onClick={()=>void decide(row,'승인')}>{busy===row.id?'저장 중…':'승인'}</Button><Button kind="outline" disabled={!!busy} onClick={()=>void decide(row,'반려')}>반려</Button></div>}
  </article>)}
 </section>
}
