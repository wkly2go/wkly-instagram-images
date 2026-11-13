import { useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { useDraftNavigation } from '../lib/useDraftNavigation'
import { Button } from './ui'
export function InstagramContacts({onChanged}:{onChanged:()=>void}){
 const {api}=useApp(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 useDraftNavigation(false,busy)
 const state=useAsync(()=>open?api.instagramContacts('status'):Promise.resolve(null),[open],null)
 const sync=async()=>{if(busy||!state.data?.configured)return;setBusy(true);setMessage('');try{const r=await api.instagramContacts('sync');setMessage(`새 후보 ${r.inserted??0}건 · 기존 후보 ${r.kept??0}건 유지. ${r.hasMore?'다음 대화를 이어서 가져올 수 있습니다.':'이번 조회 범위를 모두 확인했습니다.'}`);onChanged()}catch(e){setMessage(friendlyError(e))}finally{setBusy(false);state.reload()}}
 return <details className="growth-ai" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>인스타그램 담당자 후보 연결</summary>
 <p>연결된 업무용 인스타그램 대화의 참여자를 연락처 검토함에 저장합니다. 대화 본문·사진은 가져오지 않으며, 브랜드 담당자 여부는 검토 후 확정합니다.</p>
 {state.loading?<p>연결 상태 확인 중…</p>:state.error?<p role="alert">{state.error}</p>:<p>{state.data?.configured?'서버 설정 있음 · 실제 권한은 가져올 때 확인합니다.':'서버 함수·계정 권한·담당자 설정이 필요합니다.'}</p>}
 {state.data?.lastSyncedAt&&<p className="t-cap">최근 후보 저장: {new Date(state.data.lastSyncedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</p>}
 <div className="row wrap"><Button kind="outline" disabled={busy||state.loading} onClick={state.reload}>연결 상태 다시 확인</Button><Button disabled={api.mode==='demo'||busy||state.loading||!state.data?.configured||!!state.error} onClick={sync}>{busy?'후보 확인·저장 중…':state.data?.hasMore?'다음 대화 후보 가져오기':'대화 후보 가져오기'}</Button><a className="btn btn-outline" href="/manual/growth.html#contact" target="_blank" rel="noreferrer">설정·사용 안내</a></div>
 <p role="status">{message}</p><p className="t-cap">한 번에 대화 25개를 확인합니다. 저장 후 다음 위치로 이동하며 기존 연락처는 덮어쓰지 않습니다. 자동 예약은 서버에서 별도로 연결해야 합니다.</p>
 </details>
}
