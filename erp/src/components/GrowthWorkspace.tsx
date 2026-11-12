import { useEffect, useRef, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { Link } from '../lib/router'
import { requestViewChange } from '../lib/navigationGuard'
import { useDraftNavigation } from '../lib/useDraftNavigation'
import { Button, Field, Modal } from './ui'
import { AiAssist } from './GrowthAi'
import { CHANNELS, GROWTH_LABELS, GROWTH_STATUSES, koreaDateTimeInput, appendGrowthNote, changeChannel, contactCandidates, newGrowth, validateGrowth, type GrowthDraft, type GrowthItem, type GrowthKind, type GrowthDocument, type ChannelDraft } from '../lib/growth'
import './GrowthWorkspace.css'

export function GrowthWorkspace({ kind }: { kind: GrowthKind }) {
  const { api, me, profileName } = useApp()
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0), [status, setStatus] = useState('')
  const [selected, setSelected] = useState<string | null>(null), [adding, setAdding] = useState(false), [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const openPanel=(target:'new'|'import'|string)=>{if((target==='new'&&adding)||(target==='import'&&importing)||(target===selected&&!adding&&!importing))return;if(!requestViewChange(`growth:${kind}:${target}`))return;setSelected(target==='new'||target==='import'?null:target);setAdding(target==='new');setImporting(target==='import')}
  useEffect(() => { const t=setTimeout(()=>{setQuery(search);setPage(0)},350);return ()=>clearTimeout(t) },[search])
  const list=useAsync(()=>api.listGrowth({kind,page,search:query,status}),[kind,page,query,status],{items:[],hasMore:false})
  const backfill=async()=>{if(busy)return;setBusy(true);try{const n=await api.backfillMailLeads();setNotice(`과거 메일 ${n}건 확인 · 새 발신자는 검토함에 저장됩니다.`);list.reload()}catch(e){setNotice(friendlyError(e))}finally{setBusy(false)}}
  return <div className="growth-workspace">
    <header className="growth-heading"><div><h1>{GROWTH_LABELS[kind]}</h1><p>{kind==='tender'?'공고 확인부터 참가 조건 검토, 영업 연결까지.':kind==='content'?'원본 하나에서 채널별 글을 만들고 광고 준비와 연결합니다.':'모은 담당자 정보를 확인하고 영업 기회로 연결합니다.'}</p></div><div className="row wrap"><a href={`/manual/growth.html#${kind}`} className="btn btn-outline" target="_blank" rel="noreferrer">화면 사용설명</a><Button onClick={()=>openPanel('new')}>+ {kind==='tender'?'공고 등록':kind==='content'?'콘텐츠 만들기':'연락처 등록'}</Button></div></header>
    <p className="growth-notice">{api.mode==='demo'?'체험 모드 · 이 브라우저에만 저장됩니다. ':''}{kind==='tender'?'공고 원문과 참가 자격을 확인해 주세요. 실제 투찰은 담당자가 진행합니다.':kind==='content'?'발행 상태는 실제 게시 결과를 기록합니다. 자동 배포는 매체 계정 연결·검증 후 사용할 수 있습니다.':'메일 동기화 후 신규 발신자가 자동으로 쌓입니다. 연락처 수집은 발송 동의나 영업 대상 확정을 의미하지 않습니다.'}</p>
    {kind==='contact'&&<div className="row wrap"><Button kind="outline" onClick={()=>openPanel('import')}>메일·인스타 자료에서 추출</Button>{me.role==='admin'&&<Button kind="outline" disabled={busy||api.mode==='demo'} onClick={backfill}>{busy?'가져오는 중…':'기존 메일 500건 확인'}</Button>}<span className="t-cap">인스타 자동 수집 연결 전 · 내보낸 자료를 가져올 수 있습니다.</span></div>}
    <div className="growth-filters"><Field label="제목 검색"><input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="찾을 자료 이름" /></Field><Field label="상태"><select className="select" value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}><option value="">전체</option>{GROWTH_STATUSES[kind].map(s=><option key={s}>{s}</option>)}</select></Field></div>
    {notice&&<p role="status" className="growth-notice">{notice}</p>}{list.error&&<p role="alert">{list.error} <Button kind="outline" onClick={list.reload}>다시 확인</Button></p>}
    {list.loading?<p role="status">자료를 불러오는 중…</p>:!list.error&&<><div className="growth-list">{list.data.items.map(r=><button type="button" key={r.id} className="growth-row" onClick={()=>openPanel(r.id)}><span><strong>{r.title}</strong><small>{profileName(r.owner_id)} · {new Date(r.updated_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}</small></span><span className="badge green">{r.status}</span><span>{r.linked_sales_id?'영업 연결됨':r.campaign_id?'광고 연결됨':'상세 보기 →'}</span></button>)}{!list.data.items.length&&<div className="growth-empty"><strong>등록된 자료가 없습니다.</strong><p>위의 등록 버튼으로 시작해 주세요. 사용설명에서 연습 순서를 볼 수 있습니다.</p></div>}</div><div className="row wrap"><Button kind="outline" disabled={!page} onClick={()=>setPage(p=>p-1)}>이전</Button><span>{page+1}페이지 · {list.data.items.length}건</span><Button kind="outline" disabled={!list.data.hasMore} onClick={()=>setPage(p=>p+1)}>다음</Button></div></>}
    {adding&&<GrowthEditor kind={kind} initial={null} onClose={()=>setAdding(false)} onSaved={r=>{setAdding(false);setSelected(r.id);list.reload()}}/>}
    {selected&&<GrowthDetail key={selected} id={selected} onClose={()=>setSelected(null)} onChanged={list.reload}/>}
    {importing&&<ContactImport onClose={()=>setImporting(false)} onSaved={list.reload}/>}
  </div>
}

function GrowthDetail({id,onClose,onChanged}:{id:string;onClose:()=>void;onChanged:()=>void}){
  const {api}=useApp(),state=useAsync(()=>api.getGrowth(id),[id],null)
  if(state.loading)return <Modal title="자료 열기" onClose={onClose}><p>불러오는 중…</p></Modal>
  if(!state.data||state.error)return <Modal title="자료 열기" onClose={onClose}><p role="alert">{state.error??'자료가 없습니다.'}</p><Button onClick={state.reload}>다시 확인</Button></Modal>
  return <GrowthEditor key={state.data.revision} kind={state.data.kind} initial={state.data} onClose={onClose} onSaved={()=>{state.reload();onChanged()}}/>
}

function GrowthEditor({kind,initial,onClose,onSaved}:{kind:GrowthKind;initial:GrowthItem|null;onClose:()=>void;onSaved:(row:GrowthItem)=>void}){
  const {api,me,profiles}=useApp()
  const [draft,setDraft]=useState<GrowthDraft>(()=>initial?{kind:initial.kind,title:initial.title,owner_id:initial.owner_id,status:initial.status,document:structuredClone(initial.document),campaign_id:initial.campaign_id}:newGrowth(kind,me.id))
  const [channel,setChannel]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[aiBusy,setAiBusy]=useState(false),[aiDirty,setAiDirty]=useState(false)
  const working=busy||aiBusy
  const lock=useRef(false),id=useRef(initial?.id??crypto.randomUUID()),original=useRef(JSON.stringify(draft))
  const dirty=original.current!==JSON.stringify(draft)||aiDirty,editable=me.role==='admin'||draft.owner_id===me.id
  const campaigns=useAsync(()=>kind==='content'?api.listMarketingCampaigns():Promise.resolve([]),[kind],[])
  const patch=(p:Partial<GrowthDraft>)=>setDraft(d=>({...d,...p})),doc=(p:Partial<GrowthDocument>)=>patch({document:{...draft.document,...p}})
  const x=draft.document,v=x.versions?.[channel]
  const channelPatch=(p:Partial<ChannelDraft>)=>doc({versions:x.versions?.map((a,i)=>i===channel?changeChannel(a,p):a)})
  const close=()=>{if(!lock.current&&!aiBusy&&(!dirty||window.confirm('저장하지 않은 변경이 있습니다. 닫을까요?')))onClose()}
  useDraftNavigation(dirty,working)
  const save=async()=>{if(lock.current||aiBusy)return;if(aiDirty&&!window.confirm('AI 요청문·결과를 편집 내용에 적용하지 않았습니다. 적용하지 않고 현재 문서만 저장할까요?'))return;const e=validateGrowth(draft);if(e){setError(e);return}lock.current=true;setBusy(true);setError('');try{const r=await api.saveGrowth(id.current,draft,initial?.revision??0);original.current=JSON.stringify(draft);onSaved(r)}catch(e){setError(friendlyError(e))}finally{lock.current=false;setBusy(false)}}
  const link=async()=>{if(!initial||dirty||lock.current||aiBusy)return;lock.current=true;setBusy(true);setError('');try{await api.linkGrowthSales(initial.id,initial.revision);onSaved(await api.getGrowth(initial.id))}catch(e){setError(friendlyError(e))}finally{lock.current=false;setBusy(false)}}
  const input=(label:string,key:keyof GrowthDocument,opts:{type?:string;max?:number;area?:boolean}={})=>{
    const value=String(x[key]??'')
    return <Field label={label} className={opts.area?'full':''}>{opts.area?<textarea className="textarea" rows={4} maxLength={opts.max??10000} value={value} onChange={e=>doc({[key]:e.target.value})}/>:<input className="input" type={opts.type??'text'} maxLength={opts.max??200} value={opts.type==='datetime-local'?koreaDateTimeInput(value):value} onChange={e=>doc({[key]:opts.type==='datetime-local'&&e.target.value?e.target.value+':00+09:00':e.target.value})}/>}</Field>
  }
  return <Modal title={initial?draft.title:`새 ${GROWTH_LABELS[kind]}`} onClose={close} wide actions={<><Button kind="ghost" onClick={close} disabled={working}>닫기</Button>{editable&&<Button onClick={save} disabled={working}>{busy?'처리 중…':'저장'}</Button>}</>}>
    {error&&<p role="alert" className="growth-error">{error}</p>}
    <fieldset className="growth-fieldset form-grid" disabled={working||!editable}>
      <Field label="제목 *" className="full"><input className="input" maxLength={160} value={draft.title} onChange={e=>patch({title:e.target.value})}/></Field>
      <Field label="수행 회사"><select className="select" value={x.division} onChange={e=>patch({campaign_id:null,document:{...x,division:e.target.value as 'TW'|'AR'}})}><option value="TW">더위클리</option><option value="AR">아트리어</option></select></Field>
      <Field label="담당자"><select className="select" value={draft.owner_id} disabled={me.role!=='admin'} onChange={e=>patch({owner_id:e.target.value})}>{profiles.filter(p=>p.active&&!p.is_agent).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="관리 상태"><select className="select" value={draft.status} onChange={e=>patch({status:e.target.value})}>{GROWTH_STATUSES[kind].map(s=><option key={s}>{s}</option>)}</select></Field>
      {input('원문·출처 주소','source_url',{type:'url',max:2000})}
      {kind==='tender'&&<>{input('공고번호 *','number')}{input('공고 차수 *','round')}{input('발주처 *','agency')}{input('마감 시각 (한국시간)','deadline',{type:'datetime-local'})}<Field label="공고 금액 (원 · 미확인 빈칸)"><input className="input" type="number" min={0} step={1} value={x.amount??''} onChange={e=>doc({amount:e.target.value===''?null:Number(e.target.value)})}/></Field><Field label="참가 조건"><select className="select" value={x.qualification} onChange={e=>doc({qualification:e.target.value})}>{['추가 확인','충족','불충족'].map(s=><option key={s}>{s}</option>)}</select></Field>{input('검토 근거·필요 서류','evidence',{area:true})}</>}
      {kind==='contact'&&<>{input('브랜드','brand')}{input('담당자 이름','name')}{input('이메일','email',{type:'email',max:254})}{input('인스타 계정명','instagram',{max:31})}<Field label="고객군"><select className="select" value={x.segment} onChange={e=>doc({segment:e.target.value})}>{['미분류','브랜드 마케팅','팝업·공간','콘텐츠·광고','공공기관','협력사'].map(s=><option key={s}>{s}</option>)}</select></Field>{input('수집 경로','source')}</>}
      {kind==='content'&&<><Field label="원본 사실·출처 요약 *" className="full"><textarea className="textarea" rows={5} maxLength={20000} value={x.original} onChange={e=>doc({original:e.target.value,versions:x.versions?.map(a=>({...a,status:'초안',publication_url:'',external_id:''}))})}/></Field><Field label="연결 광고 캠페인" className="full"><select className="select" value={draft.campaign_id??''} onChange={e=>patch({campaign_id:e.target.value||null})}><option value="">미연결</option>{campaigns.data.filter(c=>c.brand===(x.division==='TW'?'wkly':'arterior')).map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select>{campaigns.error&&<span role="alert">{campaigns.error}</span>}</Field>
      <div className="full growth-channel-tabs" role="tablist" aria-label="콘텐츠 채널">{CHANNELS.map((c,i)=><button type="button" role="tab" aria-selected={i===channel} className={`btn ${i===channel?'':'btn-outline'}`} key={c} onClick={()=>setChannel(i)}>{c}</button>)}</div>
      {v&&<><Field label="채널 제목" className="full"><input className="input" maxLength={300} value={v.title} onChange={e=>channelPatch({title:e.target.value})}/></Field><Field label="채널 본문" className="full"><textarea className="textarea" rows={7} maxLength={10000} value={v.body} onChange={e=>channelPatch({body:e.target.value})}/></Field><Field label="태그"><input className="input" maxLength={500} value={v.tags} onChange={e=>channelPatch({tags:e.target.value})}/></Field><Field label="채널 상태"><select className="select" value={v.status} onChange={e=>channelPatch({status:e.target.value as ChannelDraft['status']})}>{['초안','검수','승인','발행'].map(s=><option key={s} disabled={s==='승인'&&me.role!=='admin'}>{s}</option>)}</select></Field><label className="full row"><input type="checkbox" checked={v.rights} onChange={e=>channelPatch({rights:e.target.checked})}/>이미지·영상·문구 사용 권리 확인</label><Field label="실제 발행 주소"><input className="input" type="url" maxLength={2000} value={v.publication_url} onChange={e=>channelPatch({publication_url:e.target.value})}/></Field><Field label="외부 게시물 ID"><input className="input" maxLength={300} value={v.external_id} onChange={e=>channelPatch({external_id:e.target.value})}/></Field><p className="full t-cap">내용 수정 시 승인이 해제됩니다. 초안 저장 → 관리자 승인 → 실제 게시 후 발행 주소를 기록해 주세요. 게시 승인과 광고비 승인은 별개입니다.</p></>}
      </>}
      {input(kind==='contact'?'연락 맥락·확인할 사항':'메모·체크리스트','note',{area:true})}
    </fieldset>
    {initial&&<div className="row wrap growth-links">{initial.linked_sales_id?<Link to={`/sales?id=${initial.linked_sales_id}`} className="btn btn-outline">연결 영업 기회 보기</Link>:kind!=='content'&&editable&&<Button kind="outline" disabled={working||dirty} onClick={link}>영업 기회로 연결</Button>}{draft.campaign_id&&<Link to={`/ads?tab=studio&id=${draft.campaign_id}`} className="btn btn-outline">연결 광고 캠페인</Link>}<small>저장 버전 {initial.revision}{dirty?' · 저장 후 연결 가능':''}</small></div>}
    {editable&&<AiAssist disabled={busy} onBusyChange={setAiBusy} onDraftChange={setAiDirty} resultScope={v?.channel??kind} task={kind==='contact'?'classify':'write'} context={kind==='content'?`${v?.channel}\n원본: ${x.original}`:JSON.stringify(x)} onResult={text=>kind==='content'?channelPatch({body:text}):doc({note:appendGrowthNote(x.note,text)})}/>}
  </Modal>
}

function ContactImport({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}){
 const {api,me}=useApp(),[text,setText]=useState(''),[source,setSource]=useState<'받은 메일'|'인스타그램'>('받은 메일'),[rows,setRows]=useState<GrowthDraft[]>([]),[result,setResult]=useState(''),[busy,setBusy]=useState(false)
 const ids=useRef<string[]>([]),lock=useRef(false),processed=useRef('')
 const dirty=rows.length>0||(!!text.trim()&&processed.current!==JSON.stringify([source,text]))
 useDraftNavigation(dirty,busy)
 const close=()=>{if(!lock.current&&(!dirty||window.confirm('저장하지 않은 가져오기 자료가 있습니다. 닫을까요?')))onClose()}
 const preview=()=>{try{const a=contactCandidates(text,source,me.id);setRows(a);ids.current=a.map(()=>crypto.randomUUID());setResult(`${a.length}개 후보 · 최대 50개. 이름·브랜드는 저장 후 확인해 주세요.`)}catch(e){setResult(friendlyError(e))}}
 const save=async()=>{if(lock.current)return;lock.current=true;setBusy(true);let saved=0;const errors:string[]=[];for(let i=0;i<rows.length;i++){try{await api.saveGrowth(ids.current[i],rows[i],0);saved++}catch(e){errors.push(`${rows[i].title}: ${friendlyError(e)}`)}}setResult(`${saved}개 저장, ${errors.length}개 미저장\n${errors.join('\n')}`);setRows([]);if(!errors.length)processed.current=JSON.stringify([source,text]);setBusy(false);lock.current=false;onSaved()}
 return <Modal title="연락처 자료 가져오기" onClose={close} wide actions={<><Button kind="ghost" disabled={busy} onClick={close}>닫기</Button><Button disabled={busy||!rows.length} onClick={save}>{busy?'저장 중…':'후보를 검토함에 저장'}</Button></>}><p>업무용으로 보관한 메일 또는 인스타 내보내기 자료를 붙여넣습니다. 추출 후보를 확인한 뒤 저장합니다.</p><Field label="자료 종류"><select className="select" disabled={busy} value={source} onChange={e=>{setSource(e.target.value as typeof source);setRows([])}}><option>받은 메일</option><option>인스타그램</option></select></Field><Field label="가져온 텍스트"><textarea className="textarea" rows={7} maxLength={100000} value={text} disabled={busy} onChange={e=>{setText(e.target.value);setRows([])}}/></Field><Button kind="outline" disabled={busy||!text.trim()} onClick={preview}>추출 미리보기</Button><ul>{rows.map((r,i)=><li key={r.title}>{r.title} <button type="button" disabled={busy} onClick={()=>{ids.current.splice(i,1);setRows(a=>a.filter((_,n)=>n!==i))}}>제외</button></li>)}</ul><p role="status" className="growth-copy">{result}</p></Modal>
}
