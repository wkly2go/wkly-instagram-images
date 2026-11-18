// 인터뷰지 본문 — 브랜드 담당자가 보는 모양 그대로 (공개 화면 /i/<토큰> 과 영업 화면 미리보기가 같이 씀)
import { useMemo } from 'react'
import { ANSWER_HINT_CHARS, ANSWER_MAX_CHARS, type FormQuestion } from '../lib/interviewForms'
import './InterviewFormView.css'

type Q = Omit<FormQuestion, 'use'> & { use?: FormQuestion['use'] }
interface Props { questions: Q[]; answers: Record<string, string>; onAnswer?: (no: string, value: string) => void; errorNo?: string | null; errorText?: string; showUse?: boolean }

export function InterviewFormView({ questions, answers, onAnswer, errorNo, errorText, showUse }: Props) {
  // 구역이 바뀌는 자리마다 구역 제목 (질문 순서는 그대로)
  const parts = useMemo(() => {
    const out: { section: string; items: Q[] }[] = []
    for (const q of questions) {
      const last = out[out.length - 1]
      if (last && last.section === q.section) last.items.push(q)
      else out.push({ section: q.section, items: [q] })
    }
    return out
  }, [questions])
  const readOnly = !onAnswer
  return (
    <div className="ivf-body">
      {parts.map((p, i) => (
        <section key={`${p.section}-${i}`} className="ivf-part">
          <h2><span>{i + 1}</span>{p.section}</h2>
          {p.items.map(q => {
            const a = answers[q.no] ?? ''
            const len = a.trim().length
            const id = `ivf-${q.no}`
            return (
              <div key={q.no} className={`ivf-q${errorNo === q.no ? ' err' : ''}`} id={id}>
                <div className="ivf-q-head">
                  <b>{q.no}</b>
                  <strong>{q.title}</strong>
                  {q.required && <em>필수</em>}
                  {showUse && q.use === '영업' && <i>내부 참고용</i>}
                </div>
                <p className="ivf-q-body">{q.body}</p>
                {q.help && <p className="ivf-q-help">{q.help}</p>}
                {errorNo === q.no && errorText && <p className="ivf-q-error" role="alert">{errorText}</p>}
                {q.kind === 'choice' ? (
                  <div className="ivf-opts" role="radiogroup" aria-label={`${q.no} ${q.title}`}>
                    {q.options.map(o => (
                      <label key={o} className={a === o ? 'on' : ''}>
                        <input type="radio" name={id} checked={a === o} disabled={readOnly} onChange={() => onAnswer?.(q.no, o)} onClick={() => { if (a === o) onAnswer?.(q.no, '') }} />
                        <span>{o}</span>
                      </label>
                    ))}
                  </div>
                ) : readOnly ? (
                  <div className={`ivf-answer${a ? '' : ' none'}`}>{a || '답 없음'}</div>
                ) : (
                  <>
                    <textarea aria-label={`${q.no} ${q.title}`} value={a} maxLength={ANSWER_MAX_CHARS} rows={6} onChange={e => onAnswer?.(q.no, e.target.value)} placeholder="답을 적어 주세요" />
                    <div className={`ivf-count${len > 0 && len < ANSWER_HINT_CHARS ? ' short' : ''}`}>
                      {len.toLocaleString('ko-KR')}자{len > 0 && len < ANSWER_HINT_CHARS ? ` · ${ANSWER_HINT_CHARS}자 이상을 권합니다` : ''}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
