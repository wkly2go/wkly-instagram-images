// 영상 편집 요청 (2026-11-27 대표 지시 '인트라넷에서 명령을 내려 완성 · 폰으로도 사용 가능 · 완전 자동')
// 광고·콘텐츠 › 콘텐츠·배포 › 영상 편집 (팀원 모두)
// ① 드라이브 촬영 폴더와 틀을 골라 요청 (영상은 올리지 않음) ② 항상 켜 둔 맥이 편집 ③ 완성본은 드라이브 '편집본' 폴더 + 여기서 미리보기 · 내려받기
// 음악은 넣지 않는다 — 게시와 음악 선택은 사람이 앱에서
import { useEffect, useMemo, useState } from 'react'
import { Clapperboard, Download, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { VIDEO_SECONDS, VIDEO_TEMPLATES, folderLabel, videoInputProblem, workerState, type VideoEditInput, type VideoEditJob, type VideoSourceFolder } from '../lib/videoEditsApi'
import { Button, SectionHead } from './ui'
import './VideoEdits.css'

const EMPTY: VideoEditInput = { title: '', source_folder: '', template: 'cuts', instructions: '', target_seconds: 20 }
const gb = (n: number | null) => (n == null ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : `${Math.max(1, Math.round(n / 1e6))}MB`)

export function VideoEdits() {
  const { api, me, version, bump, toast } = useApp()
  const jobs = useAsync<VideoEditJob[]>(() => api.videoJobs().catch(() => []), [api, version], [])
  const folders = useAsync<VideoSourceFolder[]>(() => api.videoFolders().catch(() => []), [api, version], [])
  const seen = useAsync<string | null>(() => api.videoWorkerSeen().catch(() => null), [api, version], null)
  const [form, setForm] = useState<VideoEditInput>(EMPTY)
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  // 대기 · 편집 중인 요청이 있으면 화면이 보일 때 20초마다 다시 읽음
  const waiting = jobs.data.some(j => j.status === '대기' || j.status === '편집 중')
  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(() => { if (!document.hidden) bump() }, 20_000)
    return () => window.clearInterval(t)
  }, [waiting, bump])

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    return folders.data.filter(f => !q || f.path.toLowerCase().includes(q)).slice(0, 40)
  }, [folders.data, find])
  const worker = workerState(seen.data)
  const problem = videoInputProblem(form)

  const submit = async () => {
    if (problem) { toast(problem); return }
    setBusy(true)
    try {
      await api.videoRequest(form)
      toast(worker === 'on' ? '요청했습니다. 끝나면 알림이 옵니다.' : '요청을 쌓아 두었습니다. 작업 처리기(맥)가 켜지면 편집합니다.')
      setForm(EMPTY); setFind(''); bump()
    } catch (e) { toast(e instanceof Error ? e.message : '요청하지 못했습니다.') } finally { setBusy(false) }
  }
  const again = (job: VideoEditJob) => {
    setForm({ title: job.title, source_folder: job.source_folder, template: job.template, instructions: '', target_seconds: job.target_seconds, parent_id: job.status === '완료' ? job.id : null })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="ve">
      <section className="card ve-card">
        <SectionHead title="영상 편집 요청" right={<Button kind="outline" size="sm" onClick={bump}><RefreshCw size={13} /> 새로고침</Button>} />
        <p className={`ve-worker ${worker}`} role="status">
          {worker === 'on' ? '작업 처리기(맥)가 켜져 있습니다. 요청하면 몇 분 안에 편집을 시작합니다.'
            : worker === 'off' ? `작업 처리기(맥)가 꺼져 있습니다 (마지막 확인 ${seen.data ? dateTimeLabel(seen.data) : '–'}). 요청은 쌓였다가 켜지면 처리됩니다.`
            : '작업 처리기(맥)가 아직 연결되지 않았습니다. 요청은 쌓였다가 연결되면 처리됩니다.'}
        </p>
        {form.parent_id && <p className="ve-note">완성본을 고쳐 다시 만듭니다. 아래 '지시'에 고칠 곳을 적어 주세요. <button type="button" className="ve-link" onClick={() => setForm({ ...form, parent_id: null })}>새 요청으로 바꾸기</button></p>}

        <label className="ve-field"><span>제목</span>
          <input value={form.title} maxLength={120} placeholder="예: 성수 ○○ 팝업 둘러보기" onChange={e => setForm({ ...form, title: e.target.value })} />
        </label>

        <div className="ve-field"><span>촬영 폴더 (구글 드라이브)</span>
          {form.source_folder ? (
            <div className="ve-picked">
              <div><b>{folderLabel(form.source_folder).name}</b><small>{folderLabel(form.source_folder).parent}</small></div>
              <Button kind="outline" size="sm" onClick={() => setForm({ ...form, source_folder: '' })}><X size={13} /> 다시 고르기</Button>
            </div>
          ) : <>
            <input value={find} placeholder="폴더 이름으로 찾기 (예: 성수, 4주차)" onChange={e => setFind(e.target.value)} />
            {folders.data.length === 0
              ? <p className="ve-empty">아직 폴더 목록이 없습니다. 작업 처리기가 드라이브의 촬영본 폴더를 읽으면 여기에 나옵니다.</p>
              : <ul className="ve-folders">
                {shown.map(f => { const l = folderLabel(f.path); return (
                  <li key={f.path}><button type="button" onClick={() => setForm({ ...form, source_folder: f.path, title: form.title || l.name.replace(/ \/ .*$/, '') })}>
                    <b>{l.name}</b><small>{l.parent}</small><em>영상 {f.files}개{f.bytes ? ` · ${gb(f.bytes)}` : ''}</em>
                  </button></li>) })}
                {shown.length === 0 && <li className="ve-empty">맞는 폴더가 없습니다.</li>}
              </ul>}
          </>}
        </div>

        <div className="ve-field"><span>틀</span>
          <div className="ve-chips" role="radiogroup" aria-label="편집 틀">
            {VIDEO_TEMPLATES.map(t => <button key={t.key} type="button" role="radio" aria-checked={form.template === t.key} className={`chip${form.template === t.key ? ' active' : ''}`} onClick={() => setForm({ ...form, template: t.key })}>{t.label}</button>)}
          </div>
          <small className="ve-help">{VIDEO_TEMPLATES.find(t => t.key === form.template)!.help}</small>
        </div>

        <div className="ve-field"><span>길이</span>
          <div className="ve-chips" role="radiogroup" aria-label="목표 길이">
            {VIDEO_SECONDS.map(s => <button key={s} type="button" role="radio" aria-checked={form.target_seconds === s} className={`chip${form.target_seconds === s ? ' active' : ''}`} onClick={() => setForm({ ...form, target_seconds: s })}>{s}초</button>)}
          </div>
        </div>

        <label className="ve-field"><span>지시 (선택)</span>
          <textarea rows={3} maxLength={2000} value={form.instructions} placeholder="예: 입구 간판부터 시작하고 굿즈 장면을 길게. 자막은 넣지 말 것." onChange={e => setForm({ ...form, instructions: e.target.value })} />
        </label>

        <div className="ve-actions">
          <Button kind="blue" disabled={busy || !!problem} onClick={() => void submit()}><Clapperboard size={14} /> {busy ? '요청 중…' : '편집 요청'}</Button>
          <small className="ve-help">세로 9:16 · 음악 없음 (게시할 때 앱에서 음악을 붙입니다) · 원본은 고치지 않고 '편집본' 폴더에 새 파일로 저장합니다.</small>
        </div>
      </section>

      <section className="card ve-card">
        <SectionHead title={`요청 기록${jobs.data.length ? ` ${jobs.data.length}` : ''}`} />
        {jobs.data.length === 0 ? <p className="ve-empty">아직 요청이 없습니다.</p> : (
          <ul className="ve-jobs">
            {jobs.data.map(job => <JobRow key={job.id} job={job} open={open === job.id} mine={job.created_by === me.id || me.role === 'admin'}
              onToggle={() => setOpen(open === job.id ? null : job.id)} onAgain={() => again(job)}
              onCancel={async () => { try { await api.videoCancel(job.id); toast('요청을 취소했습니다.'); bump() } catch (e) { toast(e instanceof Error ? e.message : '취소하지 못했습니다.') } }} />)}
          </ul>
        )}
      </section>
    </div>
  )
}

function JobRow({ job, open, mine, onToggle, onAgain, onCancel }: { job: VideoEditJob; open: boolean; mine: boolean; onToggle: () => void; onAgain: () => void; onCancel: () => void }) {
  const { api, toast } = useApp()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !job.preview_path || url) return
    let alive = true
    api.videoPreviewUrl(job.preview_path).then(u => { if (alive) setUrl(u) }).catch(e => toast(e instanceof Error ? e.message : '미리보기를 열지 못했습니다.'))
    return () => { alive = false }
  }, [open, job.preview_path, url, api, toast])
  const l = folderLabel(job.source_folder)
  const template = VIDEO_TEMPLATES.find(t => t.key === job.template)?.label ?? job.template
  return (
    <li className={`ve-job s-${job.status.replace(' ', '')}${open ? ' on' : ''}`}>
      <button type="button" className="ve-job-head" aria-expanded={open} onClick={onToggle}>
        <span className="ve-status">{job.status}</span>
        <b>{job.title}</b>
        <small>{template} · {job.duration_seconds ? `${job.duration_seconds}초` : `목표 ${job.target_seconds}초`} · {dateTimeLabel(job.created_at)}</small>
      </button>
      {open && <div className="ve-job-body">
        <p className="ve-meta">촬영 폴더: {l.parent ? `${l.parent} › ` : ''}{l.name}</p>
        {job.instructions && <p className="ve-meta">지시: {job.instructions}</p>}
        {job.status === '실패' && <p className="ve-error">실패한 이유: {job.error ?? '알 수 없음'}</p>}
        {job.status === '편집 중' && <p className="ve-meta">맥이 편집하고 있습니다. 영상 길이에 따라 몇 분에서 십여 분 걸립니다.</p>}
        {job.status === '완료' && <>
          {job.preview_path ? (url ? <video className="ve-video" src={url} controls playsInline preload="metadata" /> : <p className="ve-meta">미리보기를 여는 중…</p>) : <p className="ve-meta">미리보기는 없습니다. 드라이브에서 열어 주세요.</p>}
          {job.result_path && <p className="ve-meta">완성본 (드라이브): {job.result_path}</p>}
          {job.plan?.segments && <p className="ve-meta">장면 {job.plan.segments.length}개 · {job.plan.by === 'claude' ? 'AI 가 장면을 골랐습니다' : 'AI 를 쓰지 못해 고르게 나눠 잘랐습니다'}{job.plan.note ? ` · ${job.plan.note}` : ''}</p>}
        </>}
        <div className="ve-actions">
          {job.status === '완료' && url && <a className="btn btn-outline btn-sm" href={url} download={`${job.title}.mp4`}><Download size={13} /> 미리보기 내려받기</a>}
          {(job.status === '완료' || job.status === '실패' || job.status === '취소') && <Button kind="outline" size="sm" onClick={onAgain}><RotateCcw size={13} /> {job.status === '완료' ? '고쳐서 다시 요청' : '다시 요청'}</Button>}
          {job.status === '대기' && mine && <Button kind="outline" size="sm" onClick={onCancel}><X size={13} /> 요청 취소</Button>}
        </div>
      </div>}
    </li>
  )
}
