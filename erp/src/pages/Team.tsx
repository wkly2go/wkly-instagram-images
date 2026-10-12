import { useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { minutesLabel, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import type { Profile, WorkLog } from '../lib/types'
import { Shell } from '../components/Shell'
import { Avatar, Badge, Button, Field, SectionHead, TodayBadge } from '../components/ui'

export default function Team() {
  const { api, me, profiles, version } = useApp()
  const today = todayKey()
  const { data: logs } = useAsync(() => api.listWorkLogs({ date: today }), [version, today], [] as WorkLog[])
  const active = profiles.filter(p => p.active)
  const inactive = profiles.filter(p => !p.active)
  return (
    <Shell active="team">
      <SectionHead
        title="우리 팀"
        count={`${active.length}명`}
        right={me.role === 'admin' ? (api.mode === 'demo' ? '데모: 팀원은 고정' : '팀원 추가: Supabase → Authentication → Add user') : undefined}
      />
      <div className="members">
        {[...active, ...inactive].map(p => (
          <MemberCard key={p.id} p={p} logs={logs.filter(l => l.user_id === p.id)} />
        ))}
      </div>
      <MySettings />
    </Shell>
  )
}

function MemberCard({ p, logs }: { p: Profile; logs: WorkLog[] }) {
  const { api, me } = useApp()
  const { busy, run } = useAction()
  const mins = logs.reduce((s, l) => s + (l.minutes ?? 0), 0)
  const isMe = p.id === me.id
  return (
    <div className={`member ${p.active ? '' : 'off'}`}>
      <div className="row">
        <Avatar name={p.name} />
        <span className="col gap-2 grow">
          <span className="row" style={{ gap: 4 }}>
            <Link to={isMe ? '/work' : `/work?user=${p.id}`} className="t-smallb truncate" title="오늘 업무 보기 (파도타기)">
              {p.name}
            </Link>
            {p.title && <span className="t-cap">{p.title}</span>}
          </span>
          <span className="row" style={{ gap: 4 }}>
            <span className="t-meta">TODAY IS</span>
            <TodayBadge status={p.today_status} />
          </span>
        </span>
      </div>
      <span className="t-cap pre">{p.status_message || ' '}</span>
      <div className="row">
        <span className="t-meta t-blue">
          기록 {logs.length}
          {mins ? ` · ${minutesLabel(mins)}` : ''}
        </span>
        <span className="grow" />
        {p.role === 'admin' && <Badge tone="blue">관리자</Badge>}
        {!p.active && <Badge tone="paper">비활성</Badge>}
      </div>
      {me.role === 'admin' && !isMe && (
        <div className="row" style={{ borderTop: '1px dashed var(--line)', paddingTop: 6 }}>
          <select className="select" style={{ padding: '3px 6px', fontSize: 12 }} value={p.role} disabled={busy} onChange={e => run(() => api.updateProfile(p.id, { role: e.target.value as Profile['role'] }), '권한을 바꿨습니다.')} aria-label={`${p.name} 권한`}>
            <option value="member">멤버</option>
            <option value="admin">관리자</option>
          </select>
          <Button
            kind={p.active ? 'ghost' : 'outline'}
            size="sm"
            disabled={busy}
            onClick={() => {
              const msg = p.active ? `${p.name} 님을 비활성화할까요? 더 이상 로그인해도 데이터를 볼 수 없습니다.` : `${p.name} 님을 다시 활성화할까요?`
              if (window.confirm(msg)) run(() => api.updateProfile(p.id, { active: !p.active }), p.active ? '비활성화했습니다.' : '활성화했습니다.')
            }}
          >
            {p.active ? '비활성화' : '활성화'}
          </Button>
        </div>
      )}
    </div>
  )
}

function MySettings() {
  const { api, me } = useApp()
  const { busy, run } = useAction()
  const [name, setName] = useState(me.name)
  const [title, setTitle] = useState(me.title ?? '')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  return (
    <>
      <SectionHead title="내 정보" />
      <div className="row top wrap gap-12">
        <div className="col gap-6" style={{ flex: '1 1 220px' }}>
          <Field label="이름">
            <input className="input" value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="직함">
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 매니저" />
          </Field>
          <Button kind="outline" size="sm" style={{ alignSelf: 'flex-start' }} disabled={busy || !name.trim() || (name === me.name && title === (me.title ?? ''))} onClick={() => run(() => api.updateProfile(me.id, { name: name.trim(), title: title.trim() || null }), '저장했습니다.')}>
            저장
          </Button>
        </div>
        <div className="col gap-6" style={{ flex: '1 1 220px' }}>
          <Field label="새 비밀번호">
            <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} minLength={8} />
          </Field>
          <Field label="새 비밀번호 확인">
            <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
          </Field>
          <Button
            kind="outline"
            size="sm"
            style={{ alignSelf: 'flex-start' }}
            disabled={busy || pw.length < 8 || pw !== pw2}
            onClick={async () => {
              if (await run(() => api.changePassword(pw), api.mode === 'demo' ? '데모에서는 비밀번호가 저장되지 않습니다.' : '비밀번호를 바꿨습니다.')) {
                setPw('')
                setPw2('')
              }
            }}
          >
            비밀번호 변경
          </Button>
          <span className="t-cap">8자 이상. {me.email}</span>
        </div>
      </div>
      <div className="row">
        <span className="grow" />
        <Button kind="ghost" size="sm" onClick={() => api.signOut()}>
          로그아웃
        </Button>
      </div>
    </>
  )
}
