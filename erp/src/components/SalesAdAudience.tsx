import {useState} from 'react'
import type {Api} from '../lib/api'
import {googleAudienceCsv,type AdAudienceRow} from '../lib/salesStrategy'
import {Button} from './ui'
import './SalesMethodProposals.css'

function save(name:string,text:string,type:string){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a')
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
/** Customer lists for Google Ads and Naver, built on the administrator's device from directly held contacts only. */
export function SalesAdAudience({api,enabled}:{api:Api;enabled:boolean}){
 const [rows,setRows]=useState<AdAudienceRow[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const load=async()=>{setBusy(true);setError('');try{setRows(await api.getAdAudience())}catch(e){setError(e instanceof Error?e.message:'목록을 불러오지 못했습니다.')}finally{setBusy(false)}}
 const phones=rows?.filter(r=>r.phone)??[],day=new Date().toISOString().slice(0,10)
 return <details className="sales-bid-qualifications">
  <summary>광고 고객 목록 내려받기 <span>구글 · 네이버 광고 타겟용</span></summary>
  <p>직접 거래하거나 연락을 주고받은 상대만 담습니다. 공개 사이트에서 찾은 주소, 수신 거부, 자동 발신 · 서비스 업체 주소는 넣지 않습니다. 파일은 이 기기에서 만들어지며 다른 곳으로 보내지 않습니다.</p>
  {error&&<p role="alert">{error}</p>}
  {!rows?<div className="row wrap"><Button disabled={busy||!enabled} onClick={()=>void load()}>{busy?'불러오는 중…':'목록 만들기'}</Button></div>:<>
   <p role="status"><strong>메일 {rows.length.toLocaleString()}개</strong> · 전화 {phones.length.toLocaleString()}개</p>
   <div className="row wrap">
    <Button disabled={!rows.length} onClick={()=>save(`google-customer-match-${day}.csv`,googleAudienceCsv(rows),'text/csv;charset=utf-8')}>구글용 CSV</Button>
    <Button kind="outline" disabled={!rows.length} onClick={()=>save(`naver-email-${day}.txt`,rows.map(r=>r.email).join('\r\n')+'\r\n','text/plain;charset=utf-8')}>네이버용 메일 목록</Button>
    <Button kind="outline" disabled={!phones.length} onClick={()=>save(`naver-phone-${day}.txt`,phones.map(r=>'0'+r.phone.slice(3)).join('\r\n')+'\r\n','text/plain;charset=utf-8')}>네이버용 전화 목록</Button>
   </div>
   <p>구글: 잠재고객 관리자 › 고객 목록에 CSV를 올립니다(머리글 Email · Phone). 네이버: 업로드 화면의 양식과 암호화 안내에 맞춰 올려 주세요.</p>
  </>}
 </details>
}
