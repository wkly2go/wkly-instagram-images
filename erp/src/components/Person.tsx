import { useState } from 'react'
import { TextLinks } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import { presenceOf } from '../lib/attendance'
import { addDays, dateLabel, timeLabel, toDateKey, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import { DEDUCTS, leaveBalance } from '../lib/leave'
import type { Attendance, HrRecord, LeaveRecord, Profile } from '../lib/types'
import { Avatar, Badge, Button, Field, Modal, TodayBadge } from './ui'

/** 이름을 누르면 인사기록 카드가 열림 */
export function PersonName({ id, className = 't-smallb' }: { id: string; className?: string }) {
  const { profileOf } = useApp()
  const [open, setOpen] = useState(false)
  const p = profileOf(id)
  if (!p) return <span className={className}>알 수 없음</span>
  return (
    <>
      <button type="button" className={`name-btn ${className}`} onClick={() => setOpen(true)} title="인사기록 보기">
        {p.name}
      </button>
      {open && <PersonCard p={p} onClose={() => setOpen(false)} />}
    </>
  )
}

const EMPTY = (id: string): HrRecord => ({ profile_id: id, joined_on: null, phone: null, birthday: null, address: null, emergency_contact: null, note: null, employee_no: null, bank_name: null, account_no: null, account_holder: null, leave_adjust: 0, leave_note: null })

/** 인사기록: 기본 정보는 모두, 연락처 등 인사 정보는 본인·관리자만, 수정은 관리자만 */
function PersonCard({ p, onClose }: { p: Profile; onClose: () => void }) {
  const { api, me, version, toast } = useApp()
  const admin = me.role === 'admin'
  const canSee = admin || p.id === me.id
  const today = todayKey()
  const from = addDays(today, -29)
  const { data: hr, reload, error: hrError, loading: hrLoading } = useAsync(() => (canSee ? api.getHrRecord(p.id) : Promise.resolve(null)), [p.id, version], null as HrRecord | null)
  const { data: days } = useAsync(() => api.listAttendanceFor(p.id, from), [p.id, from, version], [] as Attendance[])
  const { data: leaves } = useAsync(() => (canSee && !p.is_agent ? api.listLeave().then(ls => ls.filter(l => l.profile_id === p.id)) : Promise.resolve([] as LeaveRecord[])), [p.id, version], [] as LeaveRecord[])
  const bal = hr?.joined_on ? leaveBalance(hr.joined_on, today, leaves, Number(hr.leave_adjust ?? 0)) : null
  const periodLeaves = bal ? leaves.filter(l => l.start_date >= bal.periodStart && l.start_date <= bal.periodEnd).sort((a, b) => b.start_date.localeCompare(a.start_date)) : []
  const account = [hr?.bank_name, hr?.account_no].filter(Boolean).join(' ')
  const copyAccount = () => {
    if (!hr?.account_no) return
    void navigator.clipboard?.writeText(hr.account_no.replace(/[^0-9-]/g, '')).then(() => toast('계좌번호를 복사했습니다.'), () => toast(hr.account_no ?? ''))
  }
  const [editing, setEditing] = useState(false)
  const todayRow = days.find(d => d.day === today)
  const tenure = hr?.joined_on ? tenureLabel(hr.joined_on, today) : null

  return (
    <Modal title="인사기록" onClose={onClose} wide>
      <div className="row top gap-12">
        {p.photo ? <img className="person-photo" src={p.photo} alt="" /> : <Avatar name={p.name} />}
        <div className="col grow">
          <span className="row wrap" style={{ gap: 6 }}>
            <span className="t-title">{p.name}</span>
            {p.title && <span className="t-cap">{p.title}</span>}
            {p.role === 'admin' && <Badge tone="blue">관리자</Badge>}
            {!p.active && <Badge tone="paper">비활성</Badge>}
          </span>
          <span className="t-meta">{p.email ?? '–'}</span>
          <span className="row" style={{ gap: 4 }}>
            <span className="t-meta">TODAY IS</span>
            <TodayBadge status={presenceOf(p, todayRow)} />
            {todayRow && <span className="t-cap">출근 {timeLabel(todayRow.first_at)}</span>}
          </span>
        </div>
        <Link to={p.id === me.id ? '/work' : `/work?user=${p.id}`} className="t-cap">
          업무 기록 보기 ›
        </Link>
      </div>

      <div className="section-h">
        <span className="t-bodyb">인사 정보</span>
        <span className="grow" />
        {admin && !editing && !hrError && !hrLoading && (
          <Button kind="outline" size="sm" onClick={() => setEditing(true)}>
            수정
          </Button>
        )}
      </div>
      {hrError && <span className="note warn">인사기록을 불러오지 못했습니다: {hrError}</span>}
      {!canSee ? (
        <span className="t-cap">연락처 등 인사 정보는 본인과 관리자만 볼 수 있습니다.</span>
      ) : editing ? (
        <HrForm initial={hr ?? EMPTY(p.id)} onDone={() => { setEditing(false); reload() }} />
      ) : (
        <dl className="hr-grid">
          <dt>사원번호</dt>
          <dd className="mono">{hr?.employee_no || '–'}</dd>
          <dt>입사일</dt>
          <dd>{hr?.joined_on ? `${fullDate(hr.joined_on)}${tenure ? ` · ${tenure}` : ''}` : '–'}</dd>
          <dt>연락처</dt>
          <dd>{hr?.phone || '–'}</dd>
          <dt>생년월일</dt>
          <dd>{hr?.birthday ? fullDate(hr.birthday) : '–'}</dd>
          <dt>주소</dt>
          <dd>{hr?.address || '–'}</dd>
          <dt>비상 연락처</dt>
          <dd>{hr?.emergency_contact || '–'}</dd>
          <dt>급여 계좌</dt>
          <dd>
            {account ? (
              <button type="button" className="hr-acc" onClick={copyAccount} title="눌러서 계좌번호 복사">
                <span className="mono">{account}</span>
                {hr?.account_holder && <span className="t-cap"> · 예금주 {hr.account_holder}</span>}
                <span className="t-cap t-blue"> 복사</span>
              </button>
            ) : (
              '–'
            )}
          </dd>
          <dt>비고</dt>
          <dd className="pre">{hr?.note || '–'}</dd>
          <dt>계정 생성</dt>
          <dd>{fullDate(toDateKey(p.created_at))}</dd>
        </dl>
      )}

      {/* 연차 (대표 지시 2026-11-06 "연차 관련 정보도 추가") — 근로기준법 기준 자동 계산 + 관리자 조정 */}
      {canSee && !p.is_agent && !editing && (
        <>
          <div className="section-h">
            <span className="t-bodyb">연차</span>
            {bal && <span className="t-cap">{fullDate(bal.periodStart)} ~ {fullDate(bal.periodEnd)}</span>}
            <span className="grow" />
            <Link to="/team?tab=leave" className="t-cap">
              휴가 신청 · 승인 ›
            </Link>
          </div>
          {!bal ? (
            <span className="t-cap">입사일을 넣으면 연차가 자동으로 계산됩니다.</span>
          ) : (
            <>
              <div className="hr-leave">
                <div>
                  <span className="t-cap">발생</span>
                  <b>{bal.granted}일</b>
                </div>
                <div>
                  <span className="t-cap">사용</span>
                  <b>{bal.used}일</b>
                </div>
                <div>
                  <span className="t-cap">승인 대기</span>
                  <b>{bal.pending}일</b>
                </div>
                <div className={bal.remaining < 0 ? 'neg' : 'left'}>
                  <span className="t-cap">남은 연차</span>
                  <b>{bal.remaining}일</b>
                </div>
              </div>
              <span className="t-cap">{bal.rule}{hr?.leave_note ? ` · ${hr.leave_note}` : ''}</span>
              {periodLeaves.length > 0 && (
                <div className="table-wrap" style={{ maxHeight: 200 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>기간</th>
                        <th>구분</th>
                        <th className="num">일수</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodLeaves.map(l => (
                        <tr key={l.id}>
                          <td>{l.start_date === l.end_date ? dateLabel(l.start_date) : `${dateLabel(l.start_date)} ~ ${dateLabel(l.end_date)}`}</td>
                          <td>
                            {l.kind}
                            {!DEDUCTS(l.kind) && <span className="t-cap"> (차감 안 함)</span>}
                          </td>
                          <td className="num">{l.days}</td>
                          <td className={l.status === '반려' ? 't-cap' : ''}>{l.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {!p.is_agent && (
        <>
          <div className="section-h">
            <span className="t-bodyb">최근 30일 근태</span>
            <span className="cap">출근 {days.length}일</span>
          </div>
          {days.length === 0 ? (
            <span className="t-cap">최근 30일 접속 기록이 없습니다.</span>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 220 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th className="num">출근 (첫 접속)</th>
                    <th className="num">마지막 접속</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map(d => (
                    <tr key={d.day}>
                      <td>{dateLabel(d.day)}</td>
                      <td className="num">{timeLabel(d.first_at)}</td>
                      <td className="num">{timeLabel(d.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function HrForm({ initial, onDone }: { initial: HrRecord; onDone: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState(initial)
  const set = (k: keyof HrRecord) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || null })
  const save = async () => {
    const t = (v: string | null | undefined) => v?.trim() || null
    const adj = Math.round(Number(f.leave_adjust ?? 0) * 2) / 2
    const clean: HrRecord = { ...f, phone: t(f.phone), address: t(f.address), emergency_contact: t(f.emergency_contact), note: t(f.note), employee_no: t(f.employee_no), bank_name: t(f.bank_name), account_no: t(f.account_no), account_holder: t(f.account_holder), leave_adjust: Number.isFinite(adj) ? Math.max(-30, Math.min(30, adj)) : 0, leave_note: t(f.leave_note) }
    if (await run(() => api.saveHrRecord(clean), '인사기록을 저장했습니다.')) onDone()
  }
  return (
    <div className="col gap-10">
      <div className="form-grid">
        <Field label="사원번호">
          <input className="input" value={f.employee_no ?? ''} onChange={set('employee_no')} maxLength={20} placeholder="예: WK-2026-001" />
        </Field>
        <Field label="입사일">
          <input className="input" type="date" value={f.joined_on ?? ''} onChange={set('joined_on')} />
        </Field>
        <Field label="생년월일">
          <input className="input" type="date" value={f.birthday ?? ''} onChange={set('birthday')} />
        </Field>
        <Field label="연락처">
          <input className="input" value={f.phone ?? ''} onChange={set('phone')} maxLength={40} placeholder="010-0000-0000" />
        </Field>
        <Field label="비상 연락처">
          <input className="input" value={f.emergency_contact ?? ''} onChange={set('emergency_contact')} maxLength={100} placeholder="관계 · 이름 · 번호" />
        </Field>
        <Field label="주소" className="full">
          <input className="input" value={f.address ?? ''} onChange={set('address')} maxLength={200} />
        </Field>
        <Field label="급여 은행">
          <input className="input" value={f.bank_name ?? ''} onChange={set('bank_name')} maxLength={40} placeholder="예: 국민" />
        </Field>
        <Field label="계좌번호">
          <input className="input" value={f.account_no ?? ''} onChange={set('account_no')} maxLength={40} inputMode="numeric" placeholder="000000-00-000000" />
        </Field>
        <Field label="예금주">
          <input className="input" value={f.account_holder ?? ''} onChange={set('account_holder')} maxLength={60} />
        </Field>
        <Field label="연차 조정 (일)">
          <input className="input" type="number" step={0.5} min={-30} max={30} value={f.leave_adjust ?? 0} onChange={e => setF({ ...f, leave_adjust: e.target.value === '' ? 0 : Number(e.target.value) })} title="이번 연차 기간에만 적용 · 이월 · 포상은 +, 선사용 · 차감은 −" />
        </Field>
        <Field label="연차 메모" className="full">
          <input className="input" value={f.leave_note ?? ''} onChange={set('leave_note')} maxLength={500} placeholder="조정 사유 (예: 작년 이월 2일)" />
        </Field>
        <Field label="비고" className="full">
          <textarea className="textarea" value={f.note ?? ''} onChange={set('note')} maxLength={2000} placeholder="계약 형태 · 직급 변경 · 교육 이수 등" />
          <TextLinks text={f.note} />
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

const fullDate = (key: string) => key.replace(/-/g, '.')

function tenureLabel(joined: string, today: string): string | null {
  const [y1, m1, d1] = joined.split('-').map(Number)
  const [y2, m2, d2] = today.split('-').map(Number)
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
  if (months < 0) return null
  const y = Math.floor(months / 12)
  months %= 12
  return y ? `${y}년 ${months}개월` : `${months}개월`
}
