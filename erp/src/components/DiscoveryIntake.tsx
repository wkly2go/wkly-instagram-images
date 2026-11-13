import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { todayKey } from '../lib/date'
import { friendlyError } from '../lib/api'
import { registerDraftNavigation } from '../lib/navigationGuard'
import { parseDiscoveryReport, type DiscoveryKind, type DiscoveryPreview } from '../lib/discoveryIntake'
import type { GrowthDraft } from '../lib/growth'
import { Button, Field, Modal } from './ui'

export function DiscoveryIntake({ kind, onClose, onChoose }: { kind: DiscoveryKind; onClose: () => void; onChoose: (draft: GrowthDraft) => boolean }) {
  const { me } = useApp()
  const [raw, setRaw] = useState(''), [rows, setRows] = useState<DiscoveryPreview[]>([]), [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const state = useRef({ dirty: false, busy: false }), choosing = useRef(false), readBusy = useRef(false), mounted = useRef(true)
  state.current = { dirty: !!raw.trim(), busy: readBusy.current }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => registerDraftNavigation(window, () => state.current, () => window.confirm('저장하지 않은 발굴 자료가 있습니다. 이동할까요?')), [])
  const close = () => { if (!readBusy.current && !choosing.current && (!state.current.dirty || window.confirm('저장하지 않은 발굴 자료가 있습니다. 닫을까요?'))) onClose() }
  const preview = () => { if (readBusy.current) return; setError(''); try { setRows(parseDiscoveryReport(raw, kind, me.id, todayKey())) } catch (e) { setRows([]); setError(friendlyError(e)) } }
  const readFile = async (file: File) => {
    if (readBusy.current || choosing.current) return
    if (file.size > 1024 * 1024) { setError('1MB 이하의 JSON 파일을 선택해 주세요. 기존 입력은 유지됩니다.'); return }
    if (raw.trim() && !window.confirm('현재 발굴 자료를 선택한 파일 내용으로 바꿀까요? 저장된 자료는 변경되지 않습니다.')) return
    readBusy.current = true; state.current.busy = true; setReading(true); setError('')
    try {
      const contents = await file.text()
      if (!mounted.current) return
      if (contents.length > 150000) throw new Error('파일 내용은 150,000자 이하여야 합니다. 기존 입력은 유지됩니다.')
      setRaw(contents); state.current.dirty = !!contents.trim()
      try { setRows(parseDiscoveryReport(contents, kind, me.id, todayKey())) }
      catch (e) { setRows([]); setError(friendlyError(e)) }
    } catch (e) { if (mounted.current) setError(friendlyError(e)) }
    finally { readBusy.current = false; state.current.busy = false; if (mounted.current) setReading(false) }
  }
  const choose = (draft: GrowthDraft) => {
    if (readBusy.current || choosing.current || !me.active) return
    choosing.current = true
    const previous = state.current
    state.current = { dirty: false, busy: false }
    try { if (!onChoose(structuredClone(draft))) { state.current = previous; choosing.current = false } }
    catch (e) { state.current = previous; choosing.current = false; setError(friendlyError(e)) }
  }
  return <Modal title="발굴 결과 가져오기" onClose={close} wide actions={<Button kind="ghost" disabled={reading} onClick={close}>닫기</Button>}>
    <p className="growth-notice">조사한 {kind === 'contact' ? '브랜드·담당자' : '나라장터 공고'} 자료를 검토함에 등록합니다. 출처·확인일·영업 계기·제안 방향·다음 행동이 필요합니다. 실제 검색이나 AI 호출은 이 화면에서 실행하지 않습니다.</p>
    <Field label="발굴 보고서 파일"><input className="input" type="file" aria-label="발굴 보고서 파일" accept=".json,application/json" disabled={reading} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void readFile(file) }} /><span className="t-cap">JSON 파일 · 최대 1MB / 150,000자 · 파일을 열면 후보를 미리 보여 줍니다.</span></Field>
    {reading && <p role="status">발굴 보고서 파일을 읽는 중…</p>}
    <Field label="발굴 보고서 JSON"><textarea className="textarea" rows={10} maxLength={150000} disabled={reading} value={raw} onChange={e => { if (readBusy.current) return; setRaw(e.target.value); setRows([]); setError('') }} placeholder="조사 결과 JSON 객체 또는 최대 20개 후보 배열을 붙여 넣으세요." /></Field>
    <details><summary>자료 형식 안내</summary><p className="growth-copy">공통 필수: kind, title, target, source_url, verified_on(YYYY-MM-DD), evidence, need, offer, next_action<br />{kind === 'contact' ? 'kind는 contact. email 또는 instagram 계정명이 필요합니다.' : 'kind는 tender. number(공고번호), round(차수)가 필요합니다. deadline에는 가장 이른 필수 마감을 시간대 포함 시각으로 입력하고, deadlines에는 서류·가격 제출 등 각각의 마감과 제출 방식을 적으세요. amount는 공고 금액의 원 단위 정수 또는 null입니다.'}<br />선택: division(TW/AR), relationship(신규·기존 접촉 여부), contact_name. 확인일·근거는 조사자가 적은 내용이며 저장 전 원문 확인이 필요합니다.</p></details>
    <Button onClick={preview} disabled={reading || !raw.trim()}>발굴 후보 미리보기</Button>
    {error && <p role="alert" className="growth-error">{error}</p>}
    {!!rows.length && <section aria-label="발굴 후보 검토" className="growth-list">
      <p role="status">전체 {rows.length}건 · 검토 가능 {rows.filter(r => r.draft).length}건 · 수정 필요 {rows.filter(r => r.error).length}건</p>
      <p className="t-cap">한 건을 선택하면 편집기로 이동합니다. 선택한 후보도 저장 버튼을 눌러야 등록됩니다. 나머지 후보와 원문은 저장되지 않으므로 원본 보고서를 보관해 주세요.</p>
      {rows.map(row => <article className="growth-notice" key={row.index}>
        <strong>{row.index + 1}. {row.title}</strong>
        {row.error && <p role="alert" className="growth-error">{row.error}</p>}
        {row.warnings.map(warning => <p key={warning}>{warning}</p>)}
        {row.draft && <><p className="growth-copy">{row.draft.document.note}</p><div className="row wrap"><a className="btn btn-outline" href={row.draft.document.source_url} target="_blank" rel="noreferrer">조사 출처 확인</a><Button disabled={reading || !me.active} onClick={() => choose(row.draft!)}>이 후보 검토해 등록</Button></div></>}
      </article>)}
    </section>}
  </Modal>
}
