import {useState} from 'react'
import type {Api} from '../lib/api'
import {useAsync} from '../lib/app'
import {Field} from './ui'
import './SalesMethodProposals.css'

const kst=(iso:string|null)=>iso?new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'-'
const WEBHOOK='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-instagram'

/** 영업 자동화가 하루 내내 정상으로 돌았는지: 단계마다 와야 했던 회차 대비 성공, 연속 실패, 연속 정상 일수. */
export function SalesOpsHealth({api}:{api:Api}){
 const state=useAsync(()=>api.getSalesOpsStatus(),[api],null)
 const s=state.data
 if(state.loading||state.error||!s)return null
 const failing=s.steps.filter(x=>x.consecutive_fails>0)
 const today=s.today
 return <details className="sales-bid-qualifications">
  <summary>운영 점검 <span>연속 정상 {s.streak}일 / 3일 · 오늘 {today?(today.healthy?'정상':`확인 ${today.problems.length}건`):'점검 전'}</span></summary>
  <p>영업 자동화 21개 단계를 매분 한 번 도는 맥박 하나로 돌립니다. 한 단계가 실패해도 다른 단계는 계속 돌고, 정해진 시각 작업은 놓치면 같은 회차 안에서 3번까지 다시 시도합니다. 3번 연속 실패하면 관리자에게 알립니다.</p>
  <ul className="sales-bid-list">{s.days.map(d=><li key={d.day}><strong>{d.day}</strong> <span>{d.healthy?'정상':`문제 ${d.problems}건`}{d.final?'':' (진행 중)'}{d.partial?' · 운영 시작일이라 연속 일수에서 제외':''}</span></li>)}</ul>
  {today&&today.problems.length>0&&<><p><strong>오늘 확인할 단계</strong></p><ul className="sales-bid-list">{today.problems.map(p=><li key={p.step}><strong>{p.label}</strong> <span>성공 {p.ok} / 예정 {p.expected} · 실패 {p.fails}</span></li>)}</ul></>}
  {failing.length>0&&<><p><strong>지금 실패 중</strong></p><ul className="sales-bid-list">{failing.map(f=><li key={f.step}><strong>{f.label}</strong> <span>{f.consecutive_fails}번 연속 · 마지막 성공 {kst(f.last_ok)}{f.last_error?` · ${f.last_error}`:''}</span></li>)}</ul></>}
 </details>
}

/** Instagram DM 연결: 상대가 먼저 보낸 DM 에만 24시간 안에 답장한다. 토큰 · 시크릿은 금고에만 저장하고 다시 보여 주지 않는다. */
export function SalesInstagramConnect({api}:{api:Api}){
 const state=useAsync(()=>api.getInstagramStatus(),[api],null)
 const [token,setToken]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState('')
 const [igResult]=useState(()=>{try{const q=new URLSearchParams(location.search);const r=q.get('ig');return r?{ok:r==='ok',msg:q.get('msg')??''}:null}catch{return null}})
 const s=state.data
 if(state.loading||state.error||!s)return null
 const ready=s.token&&s.app_secret&&!s.token_error
 const reconnect=async()=>{
  if(busy)return
  setBusy(true);setNote('')
  try{location.href=await api.instagramOauthStart()}catch(e){setNote(e instanceof Error?e.message:'연결을 시작하지 못했습니다.');setBusy(false)}
 }
 const save=async()=>{
  if(busy||(!token.trim()&&!secret.trim()))return
  setBusy(true);setNote('')
  try{
   if(token.trim())await api.setInstagramSecret('INSTAGRAM_ACCESS_TOKEN',token.trim())
   if(secret.trim())await api.setInstagramSecret('INSTAGRAM_APP_SECRET',secret.trim())
   setToken('');setSecret('');setNote('저장했습니다. 값은 다시 표시하지 않습니다.')
  }catch(e){setNote(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false);state.reload()}
 }
 return <details className="sales-bid-qualifications" open={!ready}>
  <summary>Instagram DM 연결 {ready?<span>연결됨 · 받은 DM {s.inbound}건 · 답장 가능 {s.open_windows}명 · 보낸 DM {s.sent}건</span>:<strong>연결하면 받은 DM 에 자동 답장 기획</strong>}</summary>
  <p>상대가 우리 계정에 먼저 DM 을 보낸 경우에만, 그 뒤 24시간 안에 답장합니다(Instagram 규칙). 받은 DM 의 보낸 사람은 영업 대상으로 자동 등록되고, 답장은 기획안 승인 · 실행 묶음 승인을 거쳐 발송 스위치가 켜져 있을 때만 나갑니다. '수신 거부 · 그만' 등의 답이 오면 더 보내지 않습니다.</p>
  <ol className="sales-bid-list">
   <li><strong>Meta 개발자 앱</strong> <span>Instagram 비즈니스 계정을 연결한 앱의 Webhooks 에서 콜백 주소 <code>{WEBHOOK}</code> · 확인 토큰 <code>{s.verify_token??'-'}</code> 를 넣고 messages 를 구독합니다.</span></li>
   <li><strong>접근 토큰 · 앱 시크릿</strong> <span>{s.token?'접근 토큰 저장됨':'접근 토큰 없음'} · {s.app_secret?'앱 시크릿 저장됨':'앱 시크릿 없음'} (값은 금고에만 저장)</span></li>
  </ol>
  {igResult&&<p role="status" className={igResult.ok?'ig-reconnect-ok':'ig-reconnect-fail'}>{igResult.ok?'✓ ':'✕ '}{igResult.msg||(igResult.ok?'연결을 마쳤습니다.':'연결하지 못했습니다.')}</p>}
  {s.token_error&&<p className="ig-reconnect-fail">지금 토큰이 쓸 수 없는 상태입니다 · {s.token_error}</p>}
  <div className="ig-reconnect">
   <button type="button" className="btn" disabled={busy||!s.app_secret} onClick={reconnect}>{busy?'인스타그램으로 이동 중…':'인스타그램 다시 연결 (로그인만)'}</button>
   <span>@theweekly_magazine 로 로그인 → [허용]을 누르면 60일 토큰이 서버 금고에 바로 저장됩니다(복사 · 붙여 넣기 없음). {!s.app_secret&&'앱 시크릿을 먼저 넣어 주세요.'}</span>
  </div>
  <div className="sales-bid-form">
   <Field label="접근 토큰 (instagram_business_manage_messages)"><input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder={s.token?'바꿀 때만 입력':''}/></Field>
   <Field label="앱 시크릿 (웹후크 서명 확인)"><input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} placeholder={s.app_secret?'바꿀 때만 입력':''}/></Field>
   <button type="button" className="btn small" disabled={busy||(!token.trim()&&!secret.trim())} onClick={save}>{busy?'저장 중…':'저장'}</button>
  </div>
  {note&&<p role="status">{note}</p>}
  {s.last_inbound&&<p>마지막으로 받은 DM · {kst(s.last_inbound)}</p>}
 </details>
}
