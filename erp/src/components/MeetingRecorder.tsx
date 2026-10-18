import { useEffect, useRef, useState } from 'react'
import { Mic, Pause, Play, Square, Upload } from 'lucide-react'
import { useApp } from '../lib/app'
import type { MeetingRecording } from '../lib/types'

/**
 * 회의록 AI (대표 지시 2026-10-18 · 방법 B)
 *  - 회의를 녹음하거나(이 기기 마이크) 휴대폰 녹음 파일을 올리면
 *    서버(meeting-minutes)가 Gemini 로 화자를 나눠 받아쓰고 회의록 양식으로 정리한다.
 *  - 녹음 시작 때 참석자에게 기록됨을 알리는 안내를 띄운다. 원본은 30일 뒤 자동 삭제.
 *  - AI 는 초안만: 결과를 회의록 내용 칸에 채우면 사람이 고쳐서 올린다.
 */
type Phase = 'idle' | 'recording' | 'paused' | 'uploading' | 'processing' | 'done' | 'error'

const pickMime = () => {
  const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return typeof MediaRecorder !== 'undefined' ? c.find(m => MediaRecorder.isTypeSupported?.(m)) ?? '' : ''
}
const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export function MeetingRecorder({ title, onResult }: { title: string; onResult: (minutes: string, transcript: string) => void }) {
  const { api } = useApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [attendees, setAttendees] = useState('')
  const [sec, setSec] = useState(0)
  const [msg, setMsg] = useState('')
  const [rec, setRec] = useState<MeetingRecording | null>(null)
  const [showText, setShowText] = useState(false)
  const media = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 녹음 시간
  useEffect(() => {
    if (phase !== 'recording') return
    const t = window.setInterval(() => setSec(s => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [phase])
  // 화면을 떠나면 마이크 끄기
  useEffect(() => () => stream.current?.getTracks().forEach(t => t.stop()), [])
  // AI 정리 진행 확인 (5초마다, 최대 20분)
  useEffect(() => {
    if (phase !== 'processing' || !rec) return
    let n = 0
    const t = window.setInterval(async () => {
      n++
      const r = await api.getMeetingRecording(rec.id).catch(() => null)
      if (!r) return
      if (r.status === '완료') {
        window.clearInterval(t)
        setRec(r)
        setPhase('done')
        onResult(r.minutes ?? '', r.transcript ?? '')
      } else if (r.status === '실패') {
        window.clearInterval(t)
        setRec(r)
        setPhase('error')
        setMsg(r.error ?? 'AI 정리에 실패했습니다.')
      } else if (n > 240) {
        window.clearInterval(t)
        setPhase('error')
        setMsg('정리가 오래 걸리고 있습니다. 잠시 뒤 보고서 결제에서 다시 열어 확인해 주세요.')
      }
    }, 5000)
    return () => window.clearInterval(t)
  }, [phase, rec, api, onResult])

  const start = async () => {
    setMsg('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      stream.current = s
      const mime = pickMime()
      const r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 })
      chunks.current = []
      r.ondataavailable = e => e.data.size && chunks.current.push(e.data)
      r.start(10_000)
      media.current = r
      setSec(0)
      setPhase('recording')
    } catch {
      setPhase('error')
      setMsg('마이크를 쓸 수 없습니다. 브라우저 · 컴퓨터 설정에서 마이크 권한을 허용해 주세요. 휴대폰 녹음 파일을 올려도 됩니다.')
    }
  }
  const pause = () => {
    media.current?.pause()
    setPhase('paused')
  }
  const resume = () => {
    media.current?.resume()
    setPhase('recording')
  }
  const send = async (blob: Blob, filename?: string, duration?: number) => {
    setPhase('uploading')
    setMsg('')
    try {
      const r = await api.startMeetingMinutes(blob, { title, attendees: attendees.trim(), duration_sec: duration, filename })
      setRec(r)
      setPhase('processing')
    } catch (e) {
      setPhase('error')
      setMsg(e instanceof Error ? e.message : '녹음을 올리지 못했습니다.')
    }
  }
  const stop = () => {
    const r = media.current
    if (!r) return
    r.onstop = () => {
      stream.current?.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' })
      void send(blob, undefined, sec)
    }
    r.stop()
  }

  return (
    <div className="meet-rec">
      <div className="meet-rec-head">
        <b>🎙 회의록 AI</b>
        <span className="t-cap">회의를 녹음하면 AI가 말한 사람을 나눠 받아쓰고 회의록으로 정리합니다.</span>
      </div>
      {(phase === 'idle' || phase === 'error') && (
        <>
          <input className="input" value={attendees} onChange={e => setAttendees(e.target.value)} placeholder="참석자 (선택 · 이름을 적으면 말한 사람을 더 정확히 구분)" aria-label="참석자" />
          <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-blue btn-sm" onClick={start}>
              <Mic size={13} /> 녹음 시작
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> 녹음 파일 올리기
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/mp4,video/webm"
              hidden
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void send(f, f.name)
                e.target.value = ''
              }}
            />
          </div>
        </>
      )}
      {(phase === 'recording' || phase === 'paused') && (
        <>
          <div className="meet-rec-live" role="status">
            <span className={`dot${phase === 'recording' ? ' on' : ''}`} />
            <b>{phase === 'recording' ? '녹음 중' : '일시 정지'}</b>
            <span className="t-meta">{clock(sec)}</span>
            <span className="t-cap grow">참석자에게 이 회의가 기록된다는 것을 알려 주세요.</span>
          </div>
          <div className="row gap-6">
            {phase === 'recording' ? (
              <button type="button" className="btn btn-outline btn-sm" onClick={pause}>
                <Pause size={13} /> 일시 정지
              </button>
            ) : (
              <button type="button" className="btn btn-outline btn-sm" onClick={resume}>
                <Play size={13} /> 계속
              </button>
            )}
            <button type="button" className="btn btn-yellow btn-sm" onClick={stop}>
              <Square size={13} /> 끝내고 AI 정리
            </button>
          </div>
        </>
      )}
      {phase === 'uploading' && <span className="t-small">녹음을 올리는 중…</span>}
      {phase === 'processing' && <span className="t-small">AI가 받아쓰고 정리하는 중입니다… (1시간 회의 기준 몇 분, 이 창을 닫아도 계속 처리됩니다)</span>}
      {phase === 'done' && (
        <div className="col gap-4">
          <span className="t-small t-blue">✓ 회의록 초안을 아래 내용 칸에 채웠습니다. 확인 · 수정한 뒤 올려 주세요.</span>
          {rec?.transcript && (
            <>
              <button type="button" className="link-btn t-cap" onClick={() => setShowText(v => !v)}>
                {showText ? '받아쓰기 원문 접기' : '받아쓰기 원문 보기'}
              </button>
              {showText && <pre className="meet-rec-text">{rec.transcript}</pre>}
            </>
          )}
        </div>
      )}
      {msg && <span className="err">{msg}</span>}
    </div>
  )
}
