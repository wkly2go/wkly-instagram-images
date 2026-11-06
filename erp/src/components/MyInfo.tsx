import { useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { dateLabel, todayKey } from '../lib/date'
import { leaveBalance } from '../lib/leave'
import type { HrRecord, LeaveRecord } from '../lib/types'
import { LeaveForm, LeaveRow } from './Leave'
import { Button, Field, SectionHead } from './ui'

const fullDate = (k: string) => k.replace(/-/g, '.')
const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}일`

/**
 * 개인정보 관리 (대표 지시 2026-11-06 "개인정보 관리 공간도 필요해 연차와 휴가관리등")
 *  - 내 인사 정보: 사원번호 · 직급 · 입사일은 관리자가 관리 (보기만)
 *  - 연락처 · 생년월일 · 주소 · 비상 연락처 · 급여 계좌는 본인이 직접 고침
 *  - 내 연차: 이번 기간 발생 · 사용 · 대기 · 남음, 휴가 신청 · 취소, 내 휴가 기록 전체
 *  - 주민번호는 받지 않음
 */
export function MyInfo() {
  const { api, me, version } = useApp()
  const today = todayKey()
  const { data, reload } = useAsync(
    async () => {
      const [hr, leaves] = await Promise.all([api.getHrRecord(me.id), api.listLeave()])
      return { hr, leaves: leaves.filter(l => l.profile_id === me.id) }
    },
    [me.id, version],
    { hr: null as HrRecord | null, leaves: [] as LeaveRecord[] },
  )
  const hr = data.hr
  const [editing, setEditing] = useState(false)
  const bal = hr?.joined_on ? leaveBalance(hr.joined_on, today, data.leaves, Number(hr.leave_adjust ?? 0)) : null
  const history = [...data.leaves].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const inPeriod = bal ? history.filter(l => l.start_date >= bal.periodStart && l.start_date <= bal.periodEnd) : history
  const older = bal ? history.filter(l => !inPeriod.includes(l)) : []
  const [showOld, setShowOld] = useState(false)

  return (
    <div className="col gap-8 my-info">
      <SectionHead title="개인정보 관리" right={<span className="t-cap">본인과 관리자만 볼 수 있습니다</span>} />
      <div className="my-cols">
      <div className="col gap-8">
      {/* 회사가 관리하는 정보 */}
      <div className="my-tiles">
        <div>
          <span className="t-cap">사원번호</span>
          <b className="mono">{hr?.employee_no || '–'}</b>
        </div>
        <div>
          <span className="t-cap">직급 · 직함</span>
          <b>{[hr?.rank, me.title].filter(Boolean).join(' · ') || '–'}</b>
        </div>
        <div>
          <span className="t-cap">입사일</span>
          <b>{hr?.joined_on ? fullDate(hr.joined_on) : '–'}</b>
          {bal && <span className="t-cap">근속 {bal.years ? `${bal.years}년` : '1년 미만'}</span>}
        </div>
      </div>
      <span className="t-cap">사원번호 · 직급 · 입사일이 틀렸으면 관리자에게 알려 주세요.</span>

      {/* 본인이 고치는 정보 */}
      <div className="section-h">
        <span className="t-bodyb">연락처 · 급여 계좌</span>
        <span className="grow" />
        {!editing && (
          <Button kind="outline" size="sm" onClick={() => setEditing(true)}>
            수정
          </Button>
        )}
      </div>
      {editing ? (
        <MyHrForm hr={hr} onDone={() => { setEditing(false); reload() }} />
      ) : (
        <dl className="hr-grid">
          <dt>연락처</dt>
          <dd>{hr?.phone || '–'}</dd>
          <dt>생년월일</dt>
          <dd>{hr?.birthday ? fullDate(hr.birthday) : '–'}</dd>
          <dt>주소</dt>
          <dd>{hr?.address || '–'}</dd>
          <dt>비상 연락처</dt>
          <dd>{hr?.emergency_contact || '–'}</dd>
          <dt>급여 계좌</dt>
          <dd>{hr?.account_no ? `${[hr.bank_name, hr.account_no].filter(Boolean).join(' ')}${hr.account_holder ? ` · 예금주 ${hr.account_holder}` : ''}` : '–'}</dd>
        </dl>
      )}

      </div>
      <div className="col gap-8">
      {/* 내 연차 · 휴가 */}
      <div className="section-h">
        <span className="t-bodyb">내 연차 · 휴가</span>
        {bal && <span className="t-cap">{fullDate(bal.periodStart)} ~ {fullDate(bal.periodEnd)}</span>}
      </div>
      {bal ? (
        <>
          <div className="hr-leave">
            <div>
              <span className="t-cap">발생</span>
              <b>{days(bal.granted)}</b>
            </div>
            <div>
              <span className="t-cap">사용</span>
              <b>{days(bal.used)}</b>
            </div>
            <div>
              <span className="t-cap">승인 대기</span>
              <b>{days(bal.pending)}</b>
            </div>
            <div className={bal.remaining < 0 ? 'neg' : 'left'}>
              <span className="t-cap">남은 연차</span>
              <b>{days(bal.remaining)}</b>
            </div>
          </div>
          <span className="t-cap">
            {bal.rule}
            {hr?.leave_note ? ` · ${hr.leave_note}` : ''}
          </span>
        </>
      ) : (
        <span className="note">입사일이 없어 연차를 계산할 수 없습니다. 관리자에게 입사일 입력을 요청하세요.</span>
      )}

      <span className="t-bodyb">휴가 신청</span>
      <LeaveForm profileIds={[me.id]} />

      <span className="t-bodyb">
        내 휴가 기록 {bal ? '(이번 연차 기간)' : ''} <span className="t-cap">{inPeriod.length}건</span>
      </span>
      {inPeriod.length ? (
        <div className="col gap-2">
          {inPeriod.map(l => (
            <LeaveRow key={l.id} l={l} />
          ))}
        </div>
      ) : (
        <span className="t-cap">아직 휴가 기록이 없습니다.</span>
      )}
      {older.length > 0 && (
        <>
          <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOld(v => !v)}>
            {showOld ? '이전 기간 접기' : `이전 기간 기록 ${older.length}건 보기`}
          </button>
          {showOld && (
            <div className="col gap-2">
              {older.map(l => (
                <LeaveRow key={l.id} l={l} />
              ))}
            </div>
          )}
        </>
      )}
      <span className="t-cap">연차 · 반차는 관리자 승인 뒤 차감됩니다. 승인 전 신청은 '취소'로 지울 수 있습니다. 오늘 {dateLabel(today)}</span>
      </div>
      </div>
    </div>
  )
}

function MyHrForm({ hr, onDone }: { hr: HrRecord | null; onDone: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState({
    phone: hr?.phone ?? '',
    birthday: hr?.birthday ?? '',
    address: hr?.address ?? '',
    emergency_contact: hr?.emergency_contact ?? '',
    bank_name: hr?.bank_name ?? '',
    account_no: hr?.account_no ?? '',
    account_holder: hr?.account_holder ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    if (await run(() => api.saveMyHr({ ...f, birthday: f.birthday || null }), '개인정보를 저장했습니다.')) onDone()
  }
  return (
    <div className="col gap-10">
      <div className="form-grid">
        <Field label="연락처">
          <input className="input" value={f.phone} onChange={set('phone')} maxLength={40} placeholder="010-0000-0000" />
        </Field>
        <Field label="생년월일">
          <input className="input" type="date" value={f.birthday} onChange={set('birthday')} />
        </Field>
        <Field label="주소" className="full">
          <input className="input" value={f.address} onChange={set('address')} maxLength={200} />
        </Field>
        <Field label="비상 연락처" className="full">
          <input className="input" value={f.emergency_contact} onChange={set('emergency_contact')} maxLength={100} placeholder="관계 · 이름 · 번호" />
        </Field>
        <Field label="급여 은행">
          <input className="input" value={f.bank_name} onChange={set('bank_name')} maxLength={40} placeholder="예: 국민" />
        </Field>
        <Field label="계좌번호">
          <input className="input" value={f.account_no} onChange={set('account_no')} maxLength={40} inputMode="numeric" />
        </Field>
        <Field label="예금주">
          <input className="input" value={f.account_holder} onChange={set('account_holder')} maxLength={60} />
        </Field>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button kind="ghost" onClick={onDone}>
          취소
        </Button>
        <Button disabled={busy} onClick={save}>
          저장
        </Button>
      </div>
    </div>
  )
}
