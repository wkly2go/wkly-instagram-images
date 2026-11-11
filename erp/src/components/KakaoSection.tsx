import { useMemo, useRef, useState } from 'react'
import { MessageSquareText, Paperclip, Upload } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { uploadLarge } from '../lib/gdrive'
import { kakaoHash, parseKakao, type KakaoMsg } from '../lib/kakao'
import type { KakaoImport, KakaoMessage, Project } from '../lib/types'
import { ask } from './Ask'
import { SectionHead } from './ui'

/**
 * 카카오톡 대화 가져오기 (로드맵 1-3 · 2026-11-11)
 *  - 카카오톡 › 채팅방 › 설정 › '대화 내용 내보내기'로 받은 .txt(.csv)를 사진 · 파일과 함께 골라 올리면
 *    대화는 프로젝트에 한 줄씩 저장(같은 메시지는 한 번만), 원본 · 사진 · 파일은 드라이브 프로젝트 수신방에 저장
 */
const KEEP = 40
const fmt = (iso: string) => {
  const d = new Date(iso)
  const k = new Date(d.getTime() + 9 * 3600e3).toISOString()
  return { day: k.slice(0, 10), time: k.slice(11, 16) }
}

export function KakaoSection({ project }: { project: Project }) {
  const { api, version, bump, toast, profileName } = useApp()
  const { busy } = useAction()
  const input = useRef<HTMLInputElement>(null)
  const { data } = useAsync(() => api.listKakao(project.id), [version, project.id], { imports: [] as KakaoImport[], messages: [] as KakaoMessage[] })
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ title: string; file: File; msgs: KakaoMsg[]; extra: File[] } | null>(null)

  const shown = useMemo(() => {
    const list = q.trim() ? data.messages.filter(m => (m.sender + ' ' + m.content).toLowerCase().includes(q.trim().toLowerCase())) : data.messages
    return [...(all || q ? list : list.slice(0, KEEP))].reverse()
  }, [data.messages, all, q])

  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    const arr = [...files]
    const txt = arr.find(f => /\.(txt|csv)$/i.test(f.name))
    if (!txt) return toast('카카오톡에서 내보낸 대화 파일(.txt 또는 .csv)을 함께 골라 주세요.')
    const parsed = parseKakao(await txt.text())
    if (!parsed.messages.length) return toast('이 파일에서 대화를 찾지 못했습니다. 카카오톡 › 대화방 설정 › 대화 내용 내보내기 파일인지 확인해 주세요.')
    setPreview({ title: parsed.title, file: txt, msgs: parsed.messages, extra: arr.filter(f => f !== txt) })
    setOpen(true)
  }

  const upload = async (f: File) => {
    const mime = f.type || 'application/octet-stream'
    const s = await api.inboxUploadStart(project.id, { name: f.name, mime, size: f.size })
    const g = await uploadLarge('', f, s.folder_id, async () => s.url)
    if (!g.id) throw new Error('드라이브에 올리지 못했습니다.')
    await api.inboxUploadDone(project.id, { file_id: g.id, folder_id: s.folder_id, kind: s.kind, name: f.name })
    return { name: f.name, url: g.webViewLink ?? `https://drive.google.com/file/d/${g.id}/view` }
  }

  const save = async () => {
    if (!preview) return
    try {
      const saved: { name: string; url: string }[] = []
      const toDrive = [preview.file, ...preview.extra]
      for (let i = 0; i < toDrive.length; i++) {
        setWorking(`드라이브에 올리는 중 ${i + 1}/${toDrive.length} · ${toDrive[i].name}`)
        try {
          saved.push(await upload(toDrive[i]))
        } catch (e) {
          toast(`${toDrive[i].name}: ${e instanceof Error ? e.message : '드라이브 저장 실패'} (대화는 그대로 저장합니다)`)
        }
      }
      setWorking('대화 저장 중')
      const rows = await Promise.all(preview.msgs.map(async m => ({ ...m, hash: await kakaoHash(m) })))
      const r = await api.importKakao(project.id, { title: preview.title, file_name: preview.file.name, files: saved, messages: rows })
      toast(`카카오톡 대화 ${r.added}건을 저장했습니다${r.total - r.added ? ` (이미 있던 ${r.total - r.added}건은 건너뜀)` : ''}${saved.length ? ` · 드라이브 ${saved.length}개` : ''}.`)
      setPreview(null)
      bump()
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally {
      setWorking(null)
    }
  }

  const days = (() => {
    const out: { day: string; list: KakaoMessage[] }[] = []
    for (const m of shown) {
      const d = fmt(m.sent_at).day
      if (out[out.length - 1]?.day !== d) out.push({ day: d, list: [] })
      out[out.length - 1].list.push(m)
    }
    return out
  })()

  return (
    <div className="kk">
      <SectionHead
        title="카카오톡 대화"
        count={data.messages.length ? String(data.messages.length) : undefined}
        right={
          <span className="row" style={{ gap: 6 }}>
            {data.messages.length > 0 && (
              <button type="button" className="link-btn t-cap" onClick={() => setOpen(v => !v)}>
                {open ? '접기 ▲' : '펼치기 ▼'}
              </button>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => input.current?.click()} disabled={busy || !!working}>
              <Upload size={13} /> 내보내기 파일 올리기
            </button>
          </span>
        }
      />
      <input ref={input} type="file" multiple hidden accept=".txt,.csv,image/*,video/*,application/pdf,.xlsx,.xls,.doc,.docx,.ppt,.pptx,.hwp,.zip" onChange={e => { void pick(e.target.files); e.target.value = '' }} />
      {!data.messages.length && !preview && (
        <span className="t-cap">
          카카오톡 대화방 › 메뉴(≡) › 설정 › <b>대화 내용 내보내기</b>로 받은 .txt 파일을 올리면 이 프로젝트 대화로 저장됩니다. 사진 · 파일을 같이 고르면 드라이브 프로젝트 수신방에 함께 저장됩니다.
        </span>
      )}
      {preview && (
        <div className="kk-preview">
          <b>{preview.title}</b>
          <span className="t-cap">
            대화 {preview.msgs.length}건 · {fmt(preview.msgs[0].sent_at).day} ~ {fmt(preview.msgs[preview.msgs.length - 1].sent_at).day} · 보낸 사람 {[...new Set(preview.msgs.map(m => m.sender))].slice(0, 6).join(', ')}
            {preview.extra.length ? ` · 사진 · 파일 ${preview.extra.length}개` : ''}
          </span>
          <div className="kk-prev-list">
            {preview.msgs.slice(-5).map((m, i) => (
              <span key={i} className="t-cap truncate">
                {fmt(m.sent_at).time} {m.sender}: {m.content.split('\n')[0]}
              </span>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            {working && <span className="t-cap grow">{working}…</span>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(null)} disabled={!!working}>
              취소
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void save()} disabled={!!working}>
              저장 (대화 + 드라이브)
            </button>
          </div>
        </div>
      )}
      {open && data.messages.length > 0 && (
        <>
          <div className="row" style={{ gap: 6 }}>
            <input className="input kk-q" placeholder="대화 찾기 (이름 · 내용)" value={q} onChange={e => setQ(e.target.value)} />
            {!q && data.messages.length > KEEP && (
              <button type="button" className="link-btn t-cap" onClick={() => setAll(v => !v)}>
                {all ? `최근 ${KEEP}건만` : `전체 ${data.messages.length}건 보기`}
              </button>
            )}
          </div>
          <div className="kk-list">
            {days.map(d => (
              <div key={d.day} className="col">
                <span className="kk-day">{d.day.replace(/-/g, '.')}</span>
                {d.list.map(m => (
                  <div key={m.id} className="kk-msg">
                    <span className="kk-time">{fmt(m.sent_at).time}</span>
                    <b className="kk-who">{m.sender}</b>
                    <span className="kk-text">
                      {m.attachment && (
                        <span className="kk-att">
                          <Paperclip size={11} /> {m.attachment}
                        </span>
                      )}
                      {m.attachment !== m.content && m.content}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {!shown.length && <span className="t-cap">찾는 대화가 없습니다.</span>}
          </div>
          {data.imports.length > 0 && (
            <div className="kk-imports">
              <span className="t-cap">
                <MessageSquareText size={11} /> 올린 기록
              </span>
              {data.imports.map(i => (
                <div key={i.id} className="kk-imp">
                  <span className="truncate grow">
                    {i.title} · {i.message_count}건 · {profileName(i.created_by)} · {i.created_at.slice(0, 10).replace(/-/g, '.')}
                  </span>
                  {i.files.map(f => (
                    <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="kk-file" title="드라이브에서 열기">
                      {f.name}
                    </a>
                  ))}
                  <button
                    type="button"
                    className="link-btn t-meta"
                    onClick={async () => {
                      if (await ask(`'${i.title}'로 올린 대화 ${i.message_count}건을 지울까요?\n드라이브에 저장한 파일은 그대로 둡니다.`)) {
                        await api.deleteKakaoImport(i.id).then(bump, e => toast(String(e?.message ?? e)))
                      }
                    }}
                  >
                    지우기
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
