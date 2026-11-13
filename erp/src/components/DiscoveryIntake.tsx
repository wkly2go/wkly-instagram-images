import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { todayKey } from '../lib/date'
import { friendlyError } from '../lib/api'
import { registerDraftNavigation } from '../lib/navigationGuard'
import { parseDiscoveryReport, type DiscoveryKind } from '../lib/discoveryIntake'
import { createDiscoveryLedger, prepareDiscoveryBatch, recordDiscoveryBatch, saveDiscoveryBatch, type DiscoveryBatchRow } from '../lib/discoveryBatch'
import type { GrowthDraft } from '../lib/growth'
import { Button, Field, Modal } from './ui'

export function DiscoveryIntake({ kind, onClose, onChoose, onSaved }: { kind: DiscoveryKind; onClose: () => void; onChoose: (draft: GrowthDraft) => boolean; onSaved?: () => void }) {
  const { api, me } = useApp()
  const [raw, setRaw] = useState(''), [rows, setRows] = useState<DiscoveryBatchRow[]>([]), [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set()), [notice, setNotice] = useState('')
  const [reading, setReading] = useState(false), [saving, setSaving] = useState(false)
  const state = useRef({ dirty: false, busy: false }), choosing = useRef(false), readBusy = useRef(false), saveBusy = useRef(false), mounted = useRef(true)
  const ledger = useRef(createDiscoveryLedger()), completed = useRef('')
  const working = reading || saving
  state.current = { dirty: rows.length > 0 || (!!raw.trim() && completed.current !== raw), busy: readBusy.current || saveBusy.current }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => registerDraftNavigation(window, () => state.current, () => window.confirm('저장하지 않은 발굴 자료가 있습니다. 이동할까요?')), [])
  const close = () => { if (!state.current.busy && !choosing.current && (!state.current.dirty || window.confirm('저장하지 않은 발굴 자료가 있습니다. 닫을까요?'))) onClose() }
  const applyPreview = (contents: string) => {
    const previews = parseDiscoveryReport(contents, kind, me.id, todayKey())
    const prepared = prepareDiscoveryBatch(previews, ledger.current)
    completed.current = !prepared.length ? contents : ''
    setRows(prepared)
    setSelected(previous => new Set(prepared.flatMap(row => row.candidate && previous.has(row.candidate.id) ? [row.candidate.id] : [])))
    const alreadySaved = previews.length - prepared.length
    setNotice(alreadySaved ? `이 창에서 이미 저장한 공고·연락처와 같은 후보 ${alreadySaved}건은 제외했습니다. 변경된 원문으로도 기존 항목을 덮어쓰지 않습니다.` : '')
  }
  const preview = () => {
    if (state.current.busy) return
    setError('')
    try { applyPreview(raw) } catch (e) { setError(friendlyError(e)) }
  }
  const replaceRaw = (contents: string): boolean => {
    if (contents === raw) return true
    if (rows.length && !window.confirm('남은 후보와 입력 자료를 바꿀까요? 실패 후보를 다시 확인하려면 기존 원문이 필요합니다. 이미 저장한 항목은 유지됩니다.')) return false
    setRaw(contents); setRows([]); setSelected(new Set()); setError(''); setNotice(''); completed.current = ''
    return true
  }
  const readFile = async (file: File) => {
    if (state.current.busy || choosing.current) return
    if (file.size > 1024 * 1024) { setError('1MB 이하의 JSON 파일을 선택해 주세요. 기존 입력은 유지됩니다.'); return }
    readBusy.current = true; state.current.busy = true; setReading(true); setError('')
    try {
      const contents = await file.text()
      if (!mounted.current) return
      if (contents.length > 150000) throw new Error('파일 내용은 150,000자 이하여야 합니다. 기존 입력은 유지됩니다.')
      if (contents !== raw && raw.trim() && !window.confirm('현재 발굴 자료를 선택한 파일 내용으로 바꿀까요? 남은 후보는 닫히며 이미 저장된 자료는 유지됩니다.')) return
      // Confirm replacement once, after reading, so a failed read never discards the current draft.
      setRaw(contents)
      if (contents !== raw) { setRows([]); setSelected(new Set()); completed.current = '' }
      state.current.dirty = !!contents.trim()
      try { applyPreview(contents) } catch (e) { setRows([]); setError(friendlyError(e)) }
    } catch (e) { if (mounted.current) setError(friendlyError(e)) }
    finally { readBusy.current = false; state.current.busy = false; if (mounted.current) setReading(false) }
  }
  const saveSelected = async () => {
    if (state.current.busy || choosing.current || !me.active) return
    const candidates = rows.flatMap(row => row.candidate && selected.has(row.candidate.id) ? [row.candidate] : [])
    if (!candidates.length) return
    saveBusy.current = true; state.current.busy = true; setSaving(true); setError(''); setNotice('')
    try {
      const result = await saveDiscoveryBatch(candidates, api)
      recordDiscoveryBatch(result, ledger.current)
      if (!mounted.current) return
      const savedIds = new Set(result.saved.map(candidate => candidate.id))
      const pending = new Map(result.pending.map(candidate => [candidate.id, candidate]))
      const remaining = rows.filter(row => !row.candidate || !savedIds.has(row.candidate.id)).map(row => row.candidate && pending.has(row.candidate.id) ? { ...row, candidate: pending.get(row.candidate.id)! } : row)
      setRows(remaining); setSelected(ids => new Set([...ids].filter(id => !savedIds.has(id))))
      if (!remaining.length) completed.current = raw
      setNotice(`저장 ${result.saved.length}건${result.recovered ? ` (응답 유실 확인·복구 ${result.recovered}건)` : ''} · 선택 후보 중 확인 필요 ${result.pending.length}건. 성공한 후보는 목록에서 제거했습니다.`)
      if (result.saved.length) onSaved?.()
    } catch (e) { if (mounted.current) setError(friendlyError(e)) }
    finally { saveBusy.current = false; state.current.busy = false; if (mounted.current) setSaving(false) }
  }
  const choose = (draft: GrowthDraft) => {
    if (state.current.busy || choosing.current || !me.active) return
    if (rows.length > 1 && !window.confirm('이 후보 한 건만 편집기로 이동합니다. 나머지 후보와 원문은 닫힙니다. 여러 후보를 남기려면 선택 저장을 먼저 진행해 주세요. 이동할까요?')) return
    choosing.current = true
    const previous = state.current
    state.current = { dirty: false, busy: false }
    try { if (!onChoose(structuredClone(draft))) { state.current = previous; choosing.current = false } }
    catch (e) { state.current = previous; choosing.current = false; setError(friendlyError(e)) }
  }
  const selectedCount = rows.filter(row => row.candidate && selected.has(row.candidate.id)).length
  const retrying = rows.some(row => row.candidate?.attempted && selected.has(row.candidate.id))
  return <Modal title="발굴 결과 가져오기" onClose={close} wide actions={<Button kind="ghost" disabled={working} onClick={close}>닫기</Button>}>
    <p className="growth-notice">조사한 {kind === 'contact' ? '브랜드·담당자' : '나라장터 공고'} 자료를 검토함에 등록합니다. 출처·확인일·영업 계기·제안 방향·다음 행동이 필요합니다. 실제 검색이나 AI 호출은 이 화면에서 실행하지 않습니다.</p>
    <Field label="발굴 보고서 파일"><input className="input" type="file" aria-label="발굴 보고서 파일" accept=".json,application/json" disabled={working} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void readFile(file) }} /><span className="t-cap">JSON 파일 · 최대 1MB / 150,000자 · 파일을 열면 후보를 미리 보여 줍니다.</span></Field>
    {reading && <p role="status">발굴 보고서 파일을 읽는 중…</p>}
    <Field label="발굴 보고서 JSON"><textarea className="textarea" rows={10} maxLength={150000} disabled={working} value={raw} onChange={e => { if (!state.current.busy) replaceRaw(e.target.value) }} placeholder="조사 결과 JSON 객체 또는 최대 20개 후보 배열을 붙여 넣으세요." /></Field>
    <details><summary>자료 형식 안내</summary><p className="growth-copy">공통 필수: kind, title, target, source_url, verified_on(YYYY-MM-DD), evidence, need, offer, next_action<br />{kind === 'contact' ? 'kind는 contact. email 또는 instagram 계정명이 필요합니다.' : 'kind는 tender. number(공고번호), round(차수)가 필요합니다. deadline에는 가장 이른 필수 마감을 시간대 포함 시각으로 입력하고, deadlines에는 서류·가격 제출 등 각각의 마감과 제출 방식을 적으세요. amount는 공고 금액의 원 단위 정수 또는 null입니다.'}<br />선택: division(TW/AR), relationship(신규·기존 접촉 여부), contact_name. 확인일·근거는 조사자가 적은 내용이며 저장 전 원문 확인이 필요합니다.</p></details>
    <Button onClick={preview} disabled={working || !raw.trim()}>발굴 후보 미리보기</Button>
    {error && <p role="alert" className="growth-error">{error}</p>}
    {notice && <p role="status" className="growth-notice">{notice}</p>}
    {!!rows.length && <section aria-label="발굴 후보 검토" className="growth-list">
      <p role="status">남은 후보 {rows.length}건 · 검토 가능 {rows.filter(r => r.draft).length}건 · 수정 필요 {rows.filter(r => r.error).length}건</p>
      <p className="t-cap">체크한 후보만 검토 상태로 저장합니다. 자동 영업 연결·확인 승격·투찰·연락은 하지 않습니다. 실패 후보의 원문과 ID는 이 창을 열어 둔 동안만 보존되며 새로고침하면 사라집니다.</p>
      <div className="row wrap"><Button disabled={working || !me.active || !selectedCount} onClick={saveSelected}>{saving ? '선택 후보 저장 중…' : retrying ? '남은 선택 후보 다시 저장' : '선택한 후보 검토함에 저장'}</Button><span>{selectedCount}건 선택</span></div>
      {rows.map(row => <article className="growth-notice" key={row.candidate?.id ?? `invalid:${row.index}`}>
        <strong>{row.index + 1}. {row.title}</strong>
        {row.candidate && <label className="row"><input type="checkbox" aria-label={`${row.index + 1}번 후보 저장 선택`} disabled={working || !me.active} checked={selected.has(row.candidate.id)} onChange={e => { if (state.current.busy) return; const id = row.candidate!.id, checked = e.target.checked; setSelected(ids => { const next = new Set(ids); if (checked) next.add(id); else next.delete(id); return next }) }} />검토함에 저장할 후보로 선택</label>}
        {row.error && <p role="alert" className="growth-error">{row.error}</p>}
        {row.candidate?.error && <p role="alert" className="growth-error">{row.candidate.error}</p>}
        {row.warnings.map(warning => <p key={warning}>{warning}</p>)}
        {row.draft && <><p className="growth-copy">{row.draft.document.note}</p><div className="row wrap"><a className="btn btn-outline" href={row.draft.document.source_url} target="_blank" rel="noreferrer">조사 출처 확인</a><Button disabled={working || !me.active || row.candidate?.attempted} onClick={() => choose(row.draft!)}>이 후보 검토해 등록</Button></div>{row.candidate?.attempted && <p className="t-cap">저장을 시도한 후보는 새 편집기로 옮기지 않고, 위의 선택 저장으로 같은 ID를 다시 확인합니다.</p>}</>}
      </article>)}
    </section>}
  </Modal>
}
