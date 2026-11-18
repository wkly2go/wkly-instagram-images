// 사업계획서 초안 — 필요한 정보만 넣으면 AI 가 네 항목을 씀 (2026-11-19 대표 지시)
// AI 호출은 기존 growth-ai(기간 한도 안 · 관리자). 항목마다 한 번씩 네 번 부르고, 실패한 항목만 다시 쓸 수 있다.
// 쓴 글은 초안이다 — [확인 필요] 표시를 채우고 그해 공고의 지정 양식에 옮겨 적는다. 제출은 사람이 한다.
import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Badge, Button, Field } from './ui'
import { useApp } from '../lib/app'
import type { GovCompany, GovProgram } from '../lib/gov'
import { PLAN_FIELDS, PLAN_SECTIONS, emptyInputs, inputsReady, openQuestions, planSectionPrompt, planText, type PlanInputs, type PlanSectionKey, type PlanSections } from '../lib/govPlan'

export function GovPlanWriter({ program, companies }: { program: GovProgram; companies: GovCompany[] }) {
  const { api, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState(program.fit_company ?? companies[0]?.key ?? '')
  const [inputs, setInputs] = useState<PlanInputs>(emptyInputs)
  const [sections, setSections] = useState<PlanSections>({})
  const [draftId, setDraftId] = useState<string | undefined>()
  const [busy, setBusy] = useState<PlanSectionKey | 'save' | null>(null)
  const [note, setNote] = useState('')
  const [cost, setCost] = useState(0)
  const loaded = useRef(false)
  const co = companies.find(c => c.key === company)

  useEffect(() => {
    if (!open || loaded.current) return
    loaded.current = true
    void api.getGovPlanDraft(program.id).then(d => {
      if (!d) return
      setDraftId(d.id); setCompany(d.company); setInputs({ ...emptyInputs(), ...d.inputs }); setSections(d.sections)
    }).catch(() => undefined)
  }, [open, api, program.id])

  const save = async (next: PlanSections) => {
    const id = await api.saveGovPlanDraft({ id: draftId, program_id: program.id, company, title: program.title.trim(), inputs, sections: next as Record<string, string> })
    setDraftId(id)
  }
  const write = async (keys: PlanSectionKey[]) => {
    if (!co || busy) return
    let next = { ...sections }
    let spent = 0
    setNote('')
    try {
      for (const key of keys) {
        setBusy(key)
        const r = await api.runGrowthAi({ id: crypto.randomUUID(), task: 'write', model: 'standard', prompt: planSectionPrompt(key, inputs, program, co) })
        if (r.status !== 'completed' || !r.text.trim()) throw new Error('AI 응답을 받지 못했습니다. 잠시 뒤 그 항목만 다시 써 주세요.')
        next = { ...next, [key]: r.text.trim() }
        spent += Number(r.cost) || 0
        setSections(next)
      }
      await save(next)
      setNote(`초안을 저장했습니다. [확인 필요] ${openQuestions(next)}곳을 채워 주세요.`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'AI 초안을 만들지 못했습니다.')
      if (Object.keys(next).length) await save(next).catch(() => undefined)
    } finally {
      setBusy(null)
      setCost(c => c + spent)
    }
  }
  const text = () => planText(program.title.trim(), co?.name ?? '', sections)
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast('초안을 복사했습니다') } catch { toast('자동 복사가 막혀 있습니다. 내려받기를 써 주세요') } }
  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `사업계획서-초안-${co?.short ?? ''}.txt`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const has = PLAN_SECTIONS.some(s => sections[s.key])
  const ready = inputsReady(inputs) && !!co

  return (
    <details className="gov-plan" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary><Sparkles size={13} /> 사업계획서 초안 만들기 (AI){has && <Badge tone="green">초안 있음</Badge>}</summary>
      <p className="t-cap">필요한 정보만 적으면 문제인식 · 실현가능성 · 성장전략 · 팀구성 네 항목 초안을 씁니다. 적지 않은 숫자는 지어내지 않고 [확인 필요]로 남깁니다. AI 를 네 번 부르며 비용은 AI 사용 한도에서 나갑니다.</p>
      <div className="gov-plan-form">
        <Field label="회사">
          <select className="select" value={company} onChange={e => setCompany(e.target.value)} disabled={!!busy} aria-label="회사">
            {companies.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </Field>
        {PLAN_FIELDS.map(f => (
          <Field key={f.key} label={f.label}>
            <textarea className="input" rows={f.rows} maxLength={500} value={inputs[f.key]} placeholder={f.hint} disabled={!!busy} onChange={e => setInputs({ ...inputs, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="row wrap">
        <Button size="sm" disabled={!ready || !!busy} onClick={() => void write(PLAN_SECTIONS.map(s => s.key))}>{busy && busy !== 'save' ? `${PLAN_SECTIONS.find(s => s.key === busy)?.label} 쓰는 중…` : has ? '네 항목 다시 쓰기' : 'AI 초안 만들기'}</Button>
        {has && <><Button kind="outline" size="sm" onClick={() => void copy()}>전체 복사</Button><Button kind="outline" size="sm" onClick={download}>내려받기</Button></>}
        {!ready && <span className="t-cap">아이템 · 고객과 문제 · 해결 방법은 꼭 적어 주세요.</span>}
        {cost > 0 && <span className="t-cap">이번 비용 약 ${cost.toFixed(3)}</span>}
      </div>
      {note && <p className="t-cap" role="status">{note}</p>}
      {has && PLAN_SECTIONS.map(s => (
        <section key={s.key} className="gov-plan-sec">
          <div className="row wrap"><b className="t-em">{s.label}</b><Button kind="ghost" size="sm" disabled={!ready || !!busy} onClick={() => void write([s.key])}>이 항목만 다시 쓰기</Button></div>
          <textarea className="input" rows={10} value={sections[s.key] ?? ''} disabled={!!busy} aria-label={`${s.label} 초안`} onChange={e => setSections({ ...sections, [s.key]: e.target.value })} />
        </section>
      ))}
      {has && <div className="row"><Button kind="outline" size="sm" disabled={!!busy} onClick={() => { setBusy('save'); void save(sections).then(() => toast('고친 글을 저장했습니다')).catch(() => toast('저장하지 못했습니다')).finally(() => setBusy(null)) }}>고친 글 저장</Button></div>}
    </details>
  )
}
