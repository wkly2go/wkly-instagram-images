import {useState} from 'react'
import type {Api} from '../lib/api'
import {useAsync} from '../lib/app'
import type {BidQualification} from '../lib/salesStrategy'
import {Field} from './ui'
import './SalesMethodProposals.css'

/** Which tender licences the company holds. The collector lists what notices ask for; the administrator answers once. */
export function SalesBidQualifications({api,canEdit}:{api:Api;canEdit:boolean}){
 const state=useAsync(()=>api.listBidQualifications(),[api],[] as BidQualification[])
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 if(state.loading||state.error||!state.data.length)return null
 const regions=state.data.filter(r=>r.kind==='지역'),licences=state.data.filter(r=>r.kind==='업종'),home=regions.find(r=>r.status==='보유')?.name??''
 const waiting=licences.filter(r=>r.status==='확인 필요').length+(home?0:1)
 const save=async(kind:BidQualification['kind'],name:string,status:BidQualification['status'])=>{
  if(busy||!name)return
  setBusy(true);setError('')
  try{await api.setBidQualification(kind,name,status)}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false);state.reload()}
 }
 return <details className="sales-bid-qualifications" open={waiting>0}>
  <summary>입찰 참가 자격 {waiting>0?<strong>확인할 항목 {waiting}개</strong>:<span>모두 확인됨</span>}</summary>
  <p>나라장터 공고가 요구하는 업종과 지역입니다. 한 번 답해 두면 공고마다 참여 가능 여부를 자동으로 판정하고, 참여할 수 없는 공고는 목록에서 뺍니다.</p>
  {error&&<p role="alert">{error}</p>}
  <fieldset disabled={busy||!canEdit}>
   <Field label="본사 소재지 (지역 제한 공고 판정)"><select className="select" value={home} onChange={e=>void save('지역',e.target.value,'보유')}><option value="">선택해 주세요</option>{regions.map(r=><option key={r.name} value={r.name}>{r.name}</option>)}</select></Field>
   {licences.length===0?<p>아직 업종을 요구한 공고가 없습니다. 다음 수집부터 표시됩니다.</p>:<ul>{licences.map(r=><li key={r.name}><span>{r.name}</span><select className="select" aria-label={r.name+' 보유 여부'} value={r.status} onChange={e=>void save('업종',r.name,e.target.value as BidQualification['status'])}><option value="확인 필요">확인 필요</option><option value="보유">나라장터에 등록함</option><option value="미보유">등록 안 함</option></select></li>)}</ul>}
  </fieldset>
 </details>
}
