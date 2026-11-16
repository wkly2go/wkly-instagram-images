import {useState} from 'react'
import type {Api} from '../lib/api'
import {useAsync} from '../lib/app'
import type {RecipientScope} from '../lib/salesStrategy'
import {Field} from './ui'
import './SalesMethodProposals.css'

const notes:Record<RecipientScope,string>={
 '미정':'고객에게는 어떤 메일도 나가지 않습니다. 실행 묶음은 준비까지만 됩니다.',
 '거래·문의':'기존 거래처와 담당자로 저장된 주소에만 보낼 수 있습니다.',
 '공개 창구 포함':'기존 거래처·담당자에 더해, 브랜드 공식 사이트가 공개한 문의 주소에도 보낼 수 있습니다. 광고성 메일의 사전 동의 문제는 따로 확인해 주세요.',
}
/** Who an approved sales mail may go to. The administrator decides; until then nothing reaches a customer. */
export function SalesRecipientScope({api,canEdit}:{api:Api;canEdit:boolean}){
 const state=useAsync(()=>api.getRecipientScope(),[api],'미정' as RecipientScope)
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 if(state.loading||state.error)return null
 const save=async(scope:RecipientScope)=>{
  if(busy||scope===state.data)return
  setBusy(true);setError('')
  try{await api.setRecipientScope(scope)}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false);state.reload()}
 }
 return <details className="sales-bid-qualifications" open={state.data==='미정'}>
  <summary>메일 수신자 범위 {state.data==='미정'?<strong>정해야 발송 준비가 끝납니다</strong>:<span>{state.data}</span>}</summary>
  <p>승인한 영업 메일을 누구에게까지 보낼 수 있는지 정합니다. 범위를 정해도 묶음마다 대표님 승인이 있어야 하고, 발송 스위치가 켜져 있어야 실제로 나갑니다.</p>
  {error&&<p role="alert">{error}</p>}
  <fieldset disabled={busy||!canEdit}>
   <Field label="보낼 수 있는 대상"><select className="select" value={state.data} onChange={e=>void save(e.target.value as RecipientScope)}><option value="미정">아직 정하지 않음</option><option value="거래·문의">기존 거래처·담당자만</option><option value="공개 창구 포함">공식 사이트의 공개 문의 주소까지</option></select></Field>
   <p role="status">{notes[state.data]}</p>
  </fieldset>
 </details>
}
