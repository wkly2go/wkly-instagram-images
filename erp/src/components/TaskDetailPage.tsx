import {useState} from 'react'
import {useApp} from '../lib/app'
import {Link} from '../lib/router'
import type {Project,Task} from '../lib/types'
import {Button,StatusBadge} from './ui'
import {TaskAssignModal} from '../pages/Schedule'

export function TaskDetailPage({task,projects,tasks,onBack}:{task:Task;projects:Project[];tasks:Task[];onBack:()=>void}){
 const {profileName}=useApp(),[editing,setEditing]=useState(false)
 const project=projects.find(p=>p.id===task.project_id)
 return <section className="section task-detail-page" aria-label="업무 상세">
  <div className="row wrap"><Button kind="outline" onClick={onBack}>← 업무 목록</Button><span className="grow"/><Button onClick={()=>setEditing(true)}>업무 수정</Button></div>
  <p className="t-cap">업무 상세</p><h1 className="t-title">{task.title}</h1><StatusBadge status={task.status}/>
  <dl className="task-detail-facts"><div><dt>담당자</dt><dd>{task.assignee_id?profileName(task.assignee_id):'미정'}</dd></div><div><dt>프로젝트</dt><dd>{project?<Link to={`/projects?id=${project.id}`}>{project.code&&`${project.code} · `}{project.name}</Link>:'프로젝트 미지정'}</dd></div><div><dt>진행 단계</dt><dd>{task.phase||'미지정'}</dd></div><div><dt>시작일</dt><dd>{task.start_date||'미정'}</dd></div><div><dt>마감일</dt><dd>{task.due_date||'미정'}</dd></div><div><dt>알림</dt><dd>{task.remind_at?new Date(task.remind_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'설정 없음'}</dd></div></dl>
  <h2 className="t-sub">업무 내용</h2><p className="task-detail-memo">{task.memo||'등록된 상세 내용이 없습니다.'}</p>
  {task.origin&&<p className="t-cap">출처: {task.origin}{task.origin_ref&&` · ${task.origin_ref}`}</p>}
  {editing&&<TaskAssignModal task={task} projects={projects} tasks={tasks} onClose={()=>setEditing(false)}/>}
 </section>
}
