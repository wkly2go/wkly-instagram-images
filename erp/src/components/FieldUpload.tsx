// 취재 자료 올리기 (대표 지시 2026-10-31 "인트라넷에 취재 자료 구분없이 올리기가 좋은 거 같아,
//   에이전트와 사람 팀원이 모두 편리하게 사용 가능하도록")
//  - 사람: 파일만 끌어다 놓거나 고르면 끝. 장소 · 메모 · 프로젝트는 적고 싶을 때만 (휴대폰에서도 됨)
//  - 드라이브: #WKLY_2026 / 01. 매거진 촬영본 / 📥 취재 자료 (인트라넷 올리기) / YYMMDD_장소 / 원본
//    날짜 = 파일의 촬영(수정) 날짜 중 가장 이른 날, 장소가 없으면 'YYMMDD_<이름> 취재'
//  - 기록: field_uploads (폴더 1곳 = 1줄, 같은 날 · 같은 장소면 같은 폴더에 더함)
//  - 에이전트(콘텐츠 제작 팀)는 status='새 자료' 를 읽어 분류 · 기획에 쓰고 결과를 agent_note 에 남김 → 아래 목록에 보임
import { useMemo, useRef, useState } from 'react'
import { Camera, ExternalLink, UploadCloud } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { ensureDriveFolder, folderUrl, uploadLarge } from '../lib/gdrive'
import type { FieldUpload as Upload } from '../lib/types'
import { useExplorerToken } from './DriveExplorer'
import { useDriveToken } from './DriveFiles'
import { Badge, Button } from './ui'

const kst = (ms: number) => new Date(ms + 9 * 3600_000)
const ymd = (ms: number) => kst(ms).toISOString().slice(0, 10)
const yymmdd = (iso: string) => iso.slice(2, 10).replace(/-/g, '')
const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)}GB` : `${Math.max(0.1, n / 1024 ** 2).toFixed(1)}MB`)

export function FieldUploadBox() {
  const { api, me, profileName, toast, version, bump } = useApp()
  const browserToken = useDriveToken()
  const ex = useExplorerToken(browserToken)
  const { data: root } = useAsync(() => api.fieldUploadFolder(), [], null as string | null)
  const { data: recent } = useAsync(() => api.listFieldUploads(12).catch(() => [] as Upload[]), [version], [] as Upload[])
  const { data: projects } = useAsync(() => api.listProjects(), [], [])
  const open = useMemo(() => projects.filter(p => p.status === '기획' || p.status === '진행').sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')), [projects])

  const pick = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [place, setPlace] = useState('')
  const [memo, setMemo] = useState('')
  const [project, setProject] = useState('')
  const [more, setMore] = useState(false)
  const [drag, setDrag] = useState(false)
  const [prog, setProg] = useState<{ done: number; total: number; ratio: number } | null>(null)

  const shotOn = files.length ? ymd(Math.min(...files.map(f => f.lastModified || Date.now()))) : ymd(Date.now())
  const label = (place.trim() || `${me.name} 취재`).replace(/[\\/]/g, '·').slice(0, 60)
  const folderName = `${yymmdd(shotOn)}_${label}`
  const size = files.reduce((s, f) => s + f.size, 0)
  const ready = !!ex.token && !!root

  const add = (list: FileList | null) => list && setFiles(prev => [...prev, ...Array.from(list).filter(f => !prev.some(p => p.name === f.name && p.size === f.size))])

  const send = async () => {
    if (!ex.token || !root || !files.length || prog) return
    const token = ex.token
    setProg({ done: 0, total: files.length, ratio: 0 })
    const done: Upload['files'] = []
    try {
      const shoot = await ensureDriveFolder(token, folderName, root)
      const orig = await ensureDriveFolder(token, '원본', shoot)
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const g = await uploadLarge(token, f, orig, x => api.fieldUploadSession(x), r => setProg({ done: i, total: files.length, ratio: r }))
        done.push({ id: g.id, name: f.name, mime: f.type || g.mimeType || '', size: f.size })
      }
      await api.saveFieldUpload({ shot_on: shotOn, place: place.trim() || null, memo: memo.trim() || null, project_id: project || null, folder_id: shoot, folder_url: folderUrl(shoot), files: done })
      toast(`${done.length}개를 올렸습니다 · ${folderName}`)
      setFiles([])
      setMemo('')
      bump()
    } catch (e) {
      // 일부만 올라갔어도 기록은 남겨 에이전트 · 사람이 찾을 수 있게
      if (done.length) {
        const shoot = await ensureDriveFolder(token, folderName, root).catch(() => null)
        if (shoot) await api.saveFieldUpload({ shot_on: shotOn, place: place.trim() || null, memo: memo.trim() || null, project_id: project || null, folder_id: shoot, folder_url: folderUrl(shoot), files: done }).catch(() => undefined)
        setFiles(prev => prev.filter(f => !done.some(d => d.name === f.name && d.size === f.size)))
        bump()
      }
      toast(`${done.length}개까지 올렸습니다. ${e instanceof Error ? e.message : '다시 시도해 주세요.'}`)
      if (/만료|401/.test(String(e))) ex.refresh()
    } finally {
      setProg(null)
    }
  }

  return (
    <section className="section fieldup" aria-label="취재 자료 올리기">
      <div className="section-h">
        <span className="t-bodyb">
          <Camera size={14} /> 취재 자료 올리기
        </span>
        <span className="cap">구분 없이 올리면 콘텐츠 에이전트가 분류 · 기획에 씁니다</span>
        {root && (
          <a className="t-cap" href={folderUrl(root)} target="_blank" rel="noreferrer">
            드라이브 폴더 <ExternalLink size={11} />
          </a>
        )}
      </div>

      {!ready ? (
        <div className="note">{root ? '회사 구글 계정 연결을 확인하는 중입니다…' : '올릴 폴더가 아직 정해지지 않았습니다. 관리자에게 알려 주세요.'}</div>
      ) : (
        <>
          <div
            className={`fieldup-drop${drag ? ' on' : ''}`}
            onClick={() => pick.current?.click()}
            onDragOver={e => (e.preventDefault(), setDrag(true))}
            onDragLeave={() => setDrag(false)}
            onDrop={e => (e.preventDefault(), setDrag(false), add(e.dataTransfer.files))}
            role="button"
            tabIndex={0}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && pick.current?.click()}
          >
            <UploadCloud size={22} />
            {files.length ? (
              <span>
                <b>{files.length}개</b> · {mb(size)} · 저장 위치 <b>{folderName}/원본</b>
              </span>
            ) : (
              <span>사진 · 영상 · 녹음 · 문서를 여기에 끌어다 놓거나 눌러서 고르세요 (휴대폰은 앨범에서 여러 장 선택)</span>
            )}
            <input ref={pick} type="file" multiple hidden onChange={e => (add(e.target.files), (e.target.value = ''))} />
          </div>

          <div className="row wrap gap-6">
            <input className="input" style={{ flex: '2 1 180px' }} value={place} onChange={e => setPlace(e.target.value)} placeholder="장소 · 브랜드 (선택, 예: 성수 아무아쥬 팝업)" maxLength={60} aria-label="장소 · 브랜드" />
            <button type="button" className="t-cap link-btn" onClick={() => setMore(v => !v)}>
              {more ? '메모 · 프로젝트 접기' : '+ 메모 · 프로젝트'}
            </button>
            <span className="grow" />
            {files.length > 0 && !prog && (
              <button type="button" className="t-cap link-btn" onClick={() => setFiles([])}>
                비우기
              </button>
            )}
            <Button size="sm" disabled={!files.length || !!prog} onClick={() => void send()}>
              {prog ? `올리는 중 ${prog.done + 1}/${prog.total} · ${Math.round(prog.ratio * 100)}%` : '올리기'}
            </Button>
          </div>
          {more && (
            <div className="row wrap gap-6">
              <input className="input" style={{ flex: '3 1 220px' }} value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모 (선택, 예: 대표 인터뷰 15분 · 릴스용 세로 영상 3개)" maxLength={300} aria-label="메모" />
              <select className="input" style={{ flex: '1 1 160px' }} value={project} onChange={e => setProject(e.target.value)} aria-label="프로젝트">
                <option value="">프로젝트 (선택)</option>
                {open.map(p => (
                  <option key={p.id} value={p.id}>
                    {[p.code, p.name].filter(Boolean).join(' ')}
                  </option>
                ))}
              </select>
            </div>
          )}
          {prog && <progress className="fieldup-prog" value={prog.done + prog.ratio} max={prog.total} />}
        </>
      )}

      {recent.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>날짜 · 장소</th>
                <th>올린 사람</th>
                <th className="num">파일</th>
                <th>상태 · 에이전트 메모</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map(u => (
                <tr key={u.id}>
                  <td className="max">
                    <span className="strong">
                      {yymmdd(u.shot_on)} {u.place ?? `${profileName(u.uploaded_by)} 취재`}
                    </span>
                    {u.memo && <span className="t-cap" style={{ display: 'block' }}>{u.memo}</span>}
                  </td>
                  <td>{profileName(u.uploaded_by)}</td>
                  <td className="num">{u.file_count}</td>
                  <td>
                    <Badge tone={u.status === '새 자료' ? 'yellow' : 'acid'}>{u.status}</Badge>
                    {u.category && <span className="t-cap"> {u.category}</span>}
                    {u.agent_note && <span className="t-cap" style={{ display: 'block' }}>{u.agent_note}</span>}
                  </td>
                  <td>
                    <a className="t-cap" href={u.folder_url} target="_blank" rel="noreferrer">
                      열기 <ExternalLink size={11} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
