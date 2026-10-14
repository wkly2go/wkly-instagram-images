import { useState, type FormEvent } from 'react'
import { api } from '../lib/app'
import { friendlyError } from '../lib/api'
import { DEMO_USERS, resetDemo } from '../lib/demoApi'
import { Button, Field } from '../components/ui'
import { LogoTile } from '../components/Shell'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signIn = async (e?: FormEvent, asEmail?: string) => {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.signIn((asEmail ?? email).trim(), password)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="center-page grow">
      <form className="login" onSubmit={signIn}>
        <div className="inner">
          <LogoTile />
          <h1 className="t-title" style={{ textAlign: 'center' }}>
            THE WKLY 사내 인트라넷
          </h1>
          <p className="t-small" style={{ textAlign: 'center', margin: 0 }}>
            {api.mode === 'demo' ? '체험 모드입니다. 아래 계정 중 하나로 들어가 보세요.' : '회사에서 받은 계정으로 입장하세요.'}
          </p>
          {api.mode === 'demo' ? (
            <div className="col gap-6">
              {DEMO_USERS.map(u => (
                <Button key={u.id} kind={u.id === DEMO_USERS[0].id ? 'blue' : 'outline'} block disabled={busy} onClick={() => signIn(undefined, u.email)}>
                  {u.label}로 입장
                </Button>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (window.confirm('체험 데이터를 처음 상태로 되돌릴까요?')) {
                    resetDemo()
                    window.location.reload()
                  }
                }}
              >
                체험 데이터 초기화
              </button>
            </div>
          ) : (
            <>
              <Field label="이메일">
                <input className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@thewklyn.com" />
              </Field>
              <Field label="비밀번호">
                <input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
              </Field>
              <button type="submit" className="btn btn-blue btn-block" disabled={busy}>
                {busy ? '확인 중…' : '입장하기'}
              </button>
            </>
          )}
          {error && (
            <p className="err" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <p className="t-cap" style={{ textAlign: 'center', margin: 0 }}>
            계정이 없거나 비밀번호를 잊었다면 관리자에게 요청하세요.
          </p>
        </div>
      </form>
      </div>
    </div>
  )
}
