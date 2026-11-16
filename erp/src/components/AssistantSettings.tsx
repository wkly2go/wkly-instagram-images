import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { friendlyError } from '../lib/api'
import { useApp } from '../lib/app'
import { Button, Field, Modal } from './ui'

const NAME_MAX = 20
const NOTE_MAX = 4000
const EXAMPLES = ['답은 세 줄 안으로 짧게', '아침 브리핑은 지연된 할 일부터', '업무 일지는 프로젝트 이름을 꼭 붙여서', '금액은 끝자리까지 적기']

/** 내 비서 이름 · 지침 고치기 (대표 지시 2026-11-16) — 주인만 · 다른 사람에게 안 보임 */
export function AssistantSettingsModal({ onClose }: { onClose: () => void }) {
  const { api, bump, toast } = useApp()
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api
      .assistantSettings()
      .then(s => {
        if (!live) return
        setName(s.name)
        setNote(s.instructions)
        setLoaded(true)
      })
      .catch(e => live && setError(friendlyError(e)))
    return () => {
      live = false
    }
  }, [api])

  const cleanName = name.replace(/\s+/g, ' ').trim()
  const save = async () => {
    if (!cleanName) return setError('비서 이름을 적어 주세요.')
    setBusy(true)
    setError('')
    try {
      await api.assistantSettings({ name: cleanName, instructions: note })
      bump()
      toast('비서 설정을 저장했습니다.')
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="내 비서 설정"
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button disabled={busy || !loaded} onClick={save}>
            {busy ? '저장 중…' : '저장'}
          </Button>
        </>
      }
    >
      <div className="asst-set">
        <p className="asst-set-note">이름과 지침은 나만 보고 나만 고칩니다. 저장하면 다음 대화부터 바로 따릅니다.</p>
        <Field label={`비서 이름 (${cleanName.length}/${NAME_MAX})`}>
          <input className="input" value={name} maxLength={NAME_MAX} disabled={!loaded} onChange={e => setName(e.target.value)} placeholder="예: 지원 비서" />
        </Field>
        <Field label={`지침 (${note.length.toLocaleString()}/${NOTE_MAX.toLocaleString()})`}>
          <textarea className="input asst-set-text" value={note} maxLength={NOTE_MAX} disabled={!loaded} rows={9} onChange={e => setNote(e.target.value)} placeholder="비서가 늘 지켰으면 하는 것을 적어 주세요. 말투 · 답 길이 · 먼저 챙길 일 · 하지 말아야 할 일 등" />
        </Field>
        <div className="asst-set-ex">
          <span>예시 넣기</span>
          {EXAMPLES.map(x => (
            <button key={x} type="button" disabled={!loaded} onClick={() => setNote(n => (n.trim() ? `${n.trimEnd()}\n- ${x}` : `- ${x}`).slice(0, NOTE_MAX))}>
              {x}
            </button>
          ))}
        </div>
        {error && (
          <p className="asst-set-err" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** '내 비서' 버튼 옆 설정 버튼 */
export function AssistantSettingsButton({ className = 'icon-btn sm' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label="내 비서 설정" title="내 비서 이름 · 지침 바꾸기">
        <Settings size={14} aria-hidden="true" />
      </button>
      {open && <AssistantSettingsModal onClose={() => setOpen(false)} />}
    </>
  )
}
