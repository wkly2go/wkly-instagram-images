import { useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { presenceOf } from '../lib/attendance'
import { addDays, dateLabel, timeLabel, toDateKey, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import type { Attendance, HrRecord, Profile } from '../lib/types'
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

const EMPTY = (id: string): HrRecord => ({ profile_id: id, joined_on: null, phone: null, birthday: null, address: null, emergency_contact: null, note: null })

/** 인사기록: 기본 정보는 모두, 연락처 등 인사 정보는 본인·관리자만, 수정은 관리자만 */
function PersonCard({ p, onClose }: { p: Profile; onClose: () => void }) {
  const { api, me, version } = useApp()
  const admin = me.role === 'admin'
  const canSee = admin || p.id === me.id
  const today = todayKey()
  const from = addDays(today, -29)
  const { data: hr, reload } = useAsync(() => (canSee ? api.getHrRecord(p.id) : Promise.resolve(null)), [p.id, version], null as HrRecord | null)
  const { data: days } = useAsync(() => api.listAttendanceFor(p.id, from), [p.id, from, version], [] as Attendance[])
  const [editing, setEditing] = useState(false)
  const todayRow = days.find(d => d.day === today)
  const tenure = hr?.joined_on ? tenureLabel(hr.joined_on, today) : null

  return (
    <Modal title="인사기록" onClose={onClose} wide>
      <div className="row top gap-12">
        {p.photo ? <img className="person-photo" src={p.photo} alt="" /> : <Avatar name={p.is_agent ? '🤖' : p.name} />}
        <div className="col grow">
          <span className="row wrap" style={{ gap: 6 }}>
            <span className="t-title">{p.name}</span>
            {p.title && <span className="t-cap">{p.title}</span>}
            {p.role === 'admin' && <Badge tone="blue">관리자</Badge>}
            {p.is_agent && <Badge tone="acid">AI 팀원</Badge>}
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
        {admin && !editing && (
          <Button kind="outline" size="sm" onClick={() => setEditing(true)}>
            수정
          </Button>
        )}
      </div>
      {!canSee ? (
        <span className="t-cap">연락처 등 인사 정보는 본인과 관리자만 볼 수 있습니다.</span>
      ) : editing ? (
        <HrForm initial={hr ?? EMPTY(p.id)} onDone={() => { setEditing(false); reload() }} />
      ) : (
        <dl className="hr-grid">
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
          <dt>비고</dt>
          <dd className="pre">{hr?.note || '–'}</dd>
          <dt>계정 생성</dt>
          <dd>{fullDate(toDateKey(p.created_at))}</dd>
        </dl>
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
    const clean: HrRecord = { ...f, phone: f.phone?.trim() || null, address: f.address?.trim() || null, emergency_contact: f.emergency_contact?.trim() || null, note: f.note?.trim() || null }
    if (await run(() => api.saveHrRecord(clean), '인사기록을 저장했습니다.')) onDone()
  }
  return (
    <div className="col gap-10">
      <div className="form-grid">
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
        <Field label="비고" className="full">
          <textarea className="textarea" value={f.note ?? ''} onChange={set('note')} maxLength={2000} placeholder="계약 형태 · 직급 변경 · 교육 이수 등" />
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
