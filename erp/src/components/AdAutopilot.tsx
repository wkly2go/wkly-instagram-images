// 광고 자동 운영 (2026-11-20 대표 지시 '광고 계정을 너가 전부 컨트롤하면서 캠페인을 운영 · 광고 자동화 개발 정확하게 고도화')
// 광고·콘텐츠 › 광고 운영팀 › 자동 운영 (관리자만)
// ① 연결: 메타 광고 계정 번호 + 시스템 사용자 열쇠 → '계정 확인'
// ② 안전장치: 모드(끔 · 제안만 · 승인 뒤 실행 · 자동 실행) · 월/하루 한도 · 한 번 바꾸는 폭 · 목표 문의당 비용 · 긴급 정지
// ③ 오늘 판단: 매일 07:07 서버가 수치를 받아 규칙으로 판단한 제안 → 승인(메타에 바로 반영) · 거절
// ④ 기록: 지난 판단 · 실행 결과 전부 · 메타 캠페인 목록
import { useEffect, useState } from 'react'
import { Bot, KeyRound, OctagonX, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { AD_AGENT_CODE, KIND_LABEL, MODE_HELP, MODE_LABEL, type AdAgentLog, type AutopilotAction, type AutopilotMode, type AutopilotSettings, type AutopilotStatus, type MetaCampaignRow } from '../lib/adAutopilotApi'
import { ruleScorecard } from '../lib/adScorecard'
import { Link } from '../lib/router'
import { ask } from './Ask'
import { ReportBody } from './Reports'
import { Button, SectionHead } from './ui'
import './AdAutopilot.css'

const won = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n).toLocaleString('ko-KR')}원`)
const MODES: AutopilotMode[] = ['off', 'suggest', 'approve', 'auto']
const numIn = (v: string) => { const n = Number(v.replace(/[^\d]/g, '')); return Number.isFinite(n) ? n : 0 }

export function AdAutopilot() {
  const { api, me, version, bump, toast } = useApp()
  const admin = me.role === 'admin'
  const status = useAsync<AutopilotStatus | null>(() => (admin ? api.autopilotStatus().catch(() => null) : Promise.resolve(null)), [api, version, admin], null)
  const actions = useAsync<AutopilotAction[]>(() => (admin ? api.autopilotActions().catch(() => []) : Promise.resolve([])), [api, version, admin], [])
  const camps = useAsync<MetaCampaignRow[]>(() => (admin ? api.metaCampaigns().catch(() => []) : Promise.resolve([])), [api, version, admin], [])
  const logs = useAsync<AdAgentLog[]>(() => (admin ? api.adAgentLogs().catch(() => []) : Promise.resolve([])), [api, version, admin], [])
  const [logOpen, setLogOpen] = useState<string | null>(null)
  const [form, setForm] = useState<AutopilotSettings | null>(null)
  const [tokenValue, setTokenValue] = useState('')
  const [naverKey, setNaverKey] = useState({ key: '', secret: '' })
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (status.data) setForm({ ...status.data.settings }) }, [status.data])

  if (!admin) return <p className="ap-note">광고 자동 운영은 관리자만 볼 수 있습니다.</p>
  const st = status.data
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try { await fn(); if (ok) toast(ok); bump() } catch (e) { toast(e instanceof Error ? e.message : '처리하지 못했습니다.') } finally { setBusy(null) }
  }
  const set = <K extends keyof AutopilotSettings>(k: K, v: AutopilotSettings[K]) => setForm(f => (f ? { ...f, [k]: v } : f))
  const dirty = !!(form && st && JSON.stringify({ ...form, updated_at: undefined }) !== JSON.stringify({ ...st.settings, updated_at: undefined }))
  const waiting = actions.data.filter(a => a.status === '제안')
  const history = actions.data.filter(a => a.status !== '제안')
  const capPct = st && st.settings.monthly_cap > 0 ? Math.min(100, Math.round((st.mtd_spend / st.settings.monthly_cap) * 100)) : null
  const connected = !!(st?.token && st.settings.meta_account_id) || !!(st?.naver_token && st.settings.naver_customer_id)
  const naverReady = !!(st?.naver_token && st.settings.naver_customer_id)
  const score = ruleScorecard(actions.data)
  const scored = score.some(r => r.executed > 0)

  const save = () => form && run('save', async () => {
    if (form.mode === 'auto' && !(await ask('자동 실행으로 바꾸면 매일 아침 규칙과 한도 안에서 메타 캠페인을 바로 멈추거나 예산을 바꿉니다. 바꿀까요?'))) throw new Error('바꾸지 않았습니다.')
    await api.saveAutopilot(form)
  }, '자동 운영 설정을 저장했습니다.')
  const kill = (on: boolean) => run('kill', () => api.autopilotKill(on), on ? '긴급 정지했습니다. 어떤 실행도 하지 않습니다.' : '긴급 정지를 풀었습니다.')
  const decide = (a: AutopilotAction, approve: boolean) => run(a.id, async () => {
    if (approve && !(await ask(`${a.campaign_name}${a.ad_name ? ` › ${a.ad_name}` : ''}\n${a.ad_id ? '소재 ' : ''}${KIND_LABEL[a.kind]}${a.kind === 'pause' ? '' : ` ${won(a.from_budget)} → ${won(a.to_budget)}`}\n메타에 바로 반영할까요?`))) throw new Error('반영하지 않았습니다.')
    const r = await api.autopilotDecide(a.id, approve)
    if (r.result) toast(r.result)
  }, approve ? undefined : '거절했습니다.')

  return (
    <div className="ap">
      {/* 상태 띠 */}
      <div className={`ap-band${st?.settings.kill_switch ? ' killed' : ''}`}>
        <div className="ap-band-main">
          <ShieldCheck size={16} aria-hidden="true" />
          <b>{st?.settings.kill_switch ? '긴급 정지 중' : `지금 모드: ${MODE_LABEL[st?.settings.mode ?? 'suggest']}`}</b>
          <span className="tx-sub">{st?.info?.ran_at ? `마지막 판단 ${dateTimeLabel(st.info.ran_at)}${st.info.ok === false ? ` · 실패: ${st.info.error ?? ''}` : ` · 캠페인 ${st.info.campaigns ?? 0}개 · 소재 ${st.info.ads ?? 0}개 · 제안 ${st.info.proposals ?? 0} · 실행 ${st.info.executed ?? 0}${st.info.evaluated ? ` · 효과 확인 ${st.info.evaluated}` : ''}${st.info.ad_error ? ` · 소재 수치 실패: ${st.info.ad_error}` : ''}${st.info.platform_errors ? ` · ${st.info.platform_errors}` : ''}`}` : '아직 한 번도 판단하지 않았습니다. 매일 07:07 에 자동으로 합니다.'}</span>
        </div>
        <div className="ap-band-act">
          {connected && <Button kind="outline" size="sm" disabled={!!busy} onClick={() => void run('run', async () => { const r = await api.autopilotRun(); toast(r.skipped ?? `수치 ${r.saved_rows ?? 0}줄을 받고 제안 ${r.proposals ?? 0}건을 만들었습니다.`) })}><RefreshCw size={13} /> {busy === 'run' ? '받는 중…' : '지금 받고 판단'}</Button>}
          <Button kind={st?.settings.kill_switch ? 'blue' : 'outline'} size="sm" className={st?.settings.kill_switch ? '' : 'ap-kill'} disabled={!!busy || !st} onClick={() => void kill(!st?.settings.kill_switch)}><OctagonX size={13} /> {st?.settings.kill_switch ? '정지 풀기' : '긴급 정지'}</Button>
        </div>
      </div>

      {/* 이번 달 한도 */}
      {st && (
        <div className="ap-cap">
          <div className="ap-cap-row"><span>이번 달 광고비 (메타 + 네이버)</span><b>{won(st.mtd_spend)}</b><span className="tx-sub">{st.settings.monthly_cap ? `월 한도 ${won(st.settings.monthly_cap)} 의 ${capPct}%` : '월 한도 미설정 — 증액은 하지 않습니다'}</span></div>
          {capPct != null && <div className="ap-cap-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={capPct} aria-label="월 한도 사용"><i style={{ width: `${capPct}%` }} className={capPct >= 90 ? 'hot' : ''} /></div>}
        </div>
      )}

      {/* 광고 자동화 AI 일지 — 매일 07:23 규칙 판단 바로 뒤에 AI 가 읽고 남김 (메타는 바꾸지 않음) */}
      <section className="ap-sec">
        <SectionHead title="광고 자동화 AI 일지" right={<Button kind="outline" size="sm" disabled={!!busy} onClick={() => void run('agent', () => api.apiAgentRunNow(AD_AGENT_CODE), 'AI 에게 맡겼습니다. 1~2분 뒤 일지가 올라옵니다.')}><Bot size={13} /> {busy === 'agent' ? '맡기는 중…' : 'AI 에게 지금 맡기기'}</Button>} />
        {logs.data.length === 0 ? <p className="ap-note">매일 07:23 에 AI 가 수치 · 규칙 제안 · 경쟁사 · 문의 흐름을 읽고 일지를 남깁니다. 제안마다 승인 · 거절 권고를 적고, 필요하면 캠페인 초안을 '캠페인 준비'에 만들어 둡니다. 메타 · 예산은 AI 가 바꾸지 않습니다.</p> : (
          <ul className="ap-logs">
            {logs.data.map((l, i) => {
              const shown = logOpen === null ? i === 0 : logOpen === l.id
              return (
                <li key={l.id} className={`ap-log${shown ? ' on' : ''}`}>
                  <button type="button" className="ap-log-head" aria-expanded={shown} onClick={() => setLogOpen(shown ? '' : l.id)}>
                    <b>{l.report_date}</b>
                    {l.verdict && l.verdict !== '완료' && <span className="tag">{l.verdict}</span>}
                    <span className="ap-log-sum">{l.summary}</span>
                  </button>
                  {shown && l.body && <div className="ap-log-body"><ReportBody body={l.body} /></div>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* 오늘 판단 */}
      <section className="ap-sec">
        <SectionHead title="오늘 판단 (대기)" count={waiting.length || undefined} />
        {waiting.length === 0 ? <p className="ap-note">{connected ? '기다리는 제안이 없습니다. 규칙에 걸린 캠페인이 없으면 아무것도 바꾸지 않습니다.' : '메타 광고 계정을 연결하면 매일 아침 판단이 여기에 올라옵니다.'}</p> : (
          <ul className="ap-list">
            {waiting.map(a => <ActionCard key={a.id} a={a} busy={busy === a.id} canRun={st?.settings.mode === 'approve' || st?.settings.mode === 'auto'} killed={!!st?.settings.kill_switch} onDecide={approve => void decide(a, approve)} />)}
          </ul>
        )}
      </section>

      {/* 규칙 성적표 — 실행 7일 뒤 효과 */}
      <section className="ap-sec">
        <SectionHead title="규칙 성적표" />
        {!scored ? <p className="ap-note">실행한 뒤 7일이 지나면 규칙마다 '좋아짐 · 비슷 · 나빠짐'을 매겨 여기 모읍니다. 4건 넘게 쌓이면 기준을 어떻게 고칠지 제안합니다.</p> : (
          <div className="ap-score">
            {score.map(r => (
              <div key={r.key} className="ap-score-card">
                <div className="ap-score-top"><b>{r.label}</b><span className="tx-sub">실행 {r.executed} · 확인 {r.checked}</span></div>
                <div className="ap-score-rate">{r.rate == null ? '–' : `${Math.round(r.rate * 100)}%`}<span className="tx-sub"> 좋아짐</span></div>
                {r.checked > 0 && <div className="ap-score-bar" aria-label={`좋아짐 ${r.good} · 비슷 ${r.same} · 나빠짐 ${r.bad}`}><i className="g" style={{ flex: r.good }} /><i className="s" style={{ flex: r.same }} /><i className="b" style={{ flex: r.bad }} /></div>}
                {r.advice && <p className="ap-score-advice">{r.advice}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 설정 */}
      {form && (
        <section className="ap-sec">
          <SectionHead title="안전장치 · 운영 방식" right={<Button size="sm" disabled={!dirty || !!busy} onClick={() => void save()}>{busy === 'save' ? '저장 중…' : '저장'}</Button>} />
          <div className="ap-modes" role="radiogroup" aria-label="운영 모드">
            {MODES.map(m => (
              <button key={m} type="button" role="radio" aria-checked={form.mode === m} className={`ap-mode${form.mode === m ? ' on' : ''}`} onClick={() => set('mode', m)}>
                <b>{MODE_LABEL[m]}</b><span>{MODE_HELP[m]}</span>
              </button>
            ))}
          </div>
          <div className="ap-grid">
            <label className="ap-f"><span>월 한도 (원)</span><input inputMode="numeric" value={form.monthly_cap ? form.monthly_cap.toLocaleString('ko-KR') : ''} placeholder="예: 1,500,000" onChange={e => set('monthly_cap', numIn(e.target.value))} /><small>닿으면 켜진 캠페인을 모두 멈춤 제안 · 0 이면 증액 안 함</small></label>
            <label className="ap-f"><span>하루 한도 (원)</span><input inputMode="numeric" value={form.daily_cap ? form.daily_cap.toLocaleString('ko-KR') : ''} placeholder="예: 60,000" onChange={e => set('daily_cap', numIn(e.target.value))} /><small>켜진 캠페인 하루 예산 합계가 넘지 않게</small></label>
            <label className="ap-f"><span>한 번에 바꾸는 폭 (%)</span><input inputMode="numeric" value={form.max_step_pct} onChange={e => set('max_step_pct', Math.min(50, Math.max(5, numIn(e.target.value) || 5)))} /><small>5~50 · 메타 학습이 깨지지 않게 기본 20</small></label>
            <label className="ap-f"><span>목표 문의당 비용 (원)</span><input inputMode="numeric" value={form.target_cpl ? form.target_cpl.toLocaleString('ko-KR') : ''} placeholder="비우면 클릭률 · 클릭당 비용으로 판단" onChange={e => set('target_cpl', numIn(e.target.value) || null)} /><small>2배 넘으면 멈춤 · 1.3배 넘으면 줄임 · 0.8배 이하면 늘림</small></label>
            <label className="ap-f"><span>판단 최소 금액 (원 · 7일)</span><input inputMode="numeric" value={form.min_spend.toLocaleString('ko-KR')} onChange={e => set('min_spend', numIn(e.target.value))} /><small>이보다 적게 쓴 캠페인은 자료 부족으로 두고 봄</small></label>
            <label className="ap-f"><span>메타 광고 계정 번호</span><input value={form.meta_account_id ?? ''} placeholder="act_ 뒤 숫자" onChange={e => set('meta_account_id', e.target.value.replace(/^act_/, '').replace(/[^\d]/g, '') || null)} /><small>광고 관리자 주소의 act= 뒤 숫자</small></label>
            <label className="ap-f"><span>더위클리 페이스북 페이지 번호</span><input value={form.meta_page_id ?? ''} placeholder="숫자" onChange={e => set('meta_page_id', e.target.value.replace(/[^\d]/g, '') || null)} /><small>광고에 내 이름으로 나갈 페이지 · 페이지 › 정보 › 페이지 ID (광고 만들기에 필요)</small></label>
            <label className="ap-f"><span>인스타그램 번호</span><input value={form.meta_ig_user_id ?? ''} placeholder="숫자" onChange={e => set('meta_ig_user_id', e.target.value.replace(/[^\d]/g, '') || null)} /><small>@theweekly_magazine (기본값이 들어가 있음)</small></label>
            <label className="ap-f"><span>네이버 검색광고 고객 번호</span><input inputMode="numeric" value={form.naver_customer_id ?? ''} placeholder="searchad.naver.com 오른쪽 위 숫자" onChange={e => set('naver_customer_id', e.target.value.replace(/[^\d]/g, '') || null)} /><small>네이버와 메타 한도는 합계로 셉니다</small></label>
          </div>
        </section>
      )}

      {/* 연결 */}
      <section className="ap-sec">
        <SectionHead title="메타 광고 계정 연결" right={connected ? <Button kind="outline" size="sm" disabled={!!busy} onClick={() => void run('check', async () => { const r = await api.autopilotCheck(); toast(`연결됨: ${r.name} · ${r.currency} · ${r.timezone}`) })}>{busy === 'check' ? '확인 중…' : '계정 확인'}</Button> : undefined} />
        <p className="ap-note">{st?.token ? '열쇠가 들어 있습니다 (다시 보여 주지 않음). 바꿀 때만 아래에 새 열쇠를 넣으세요.' : '메타 비즈니스 설정 › 사용자 › 시스템 사용자에서 광고 계정을 배정하고 ads_management · ads_read 권한으로 만든 토큰을 넣어 주세요. 대화로 보내지 말고 여기에만 넣습니다.'}</p>
        <form className="ap-token" onSubmit={e => { e.preventDefault(); if (tokenValue.trim()) void run('token', async () => { await api.setMetaAdsToken(tokenValue); setTokenValue('') }, '열쇠를 금고에 넣었습니다.') }}>
          <input type="password" autoComplete="off" value={tokenValue} onChange={e => setTokenValue(e.target.value)} placeholder="시스템 사용자 접근 토큰" aria-label="메타 광고 열쇠" />
          <Button type="submit" disabled={!tokenValue.trim() || !!busy}><KeyRound size={13} /> {st?.token ? '열쇠 바꾸기' : '열쇠 넣기'}</Button>
        </form>
      </section>

      {/* 네이버 검색광고 연결 (4단계) */}
      <section className="ap-sec">
        <SectionHead title="네이버 검색광고 연결" right={naverReady ? <Button kind="outline" size="sm" disabled={!!busy} onClick={() => void run('checkn', async () => { const r = await api.autopilotCheckNaver(); toast(`네이버 연결됨: 캠페인 ${r.campaigns}개 · 켜짐 ${r.active}개`) })}>{busy === 'checkn' ? '확인 중…' : '계정 확인'}</Button> : undefined} />
        <p className="ap-note">{st?.naver_token ? '네이버 열쇠가 들어 있습니다 (다시 보여 주지 않음). 바꿀 때만 아래에 넣으세요.' : '네이버 검색광고(searchad.naver.com) › 도구 › API 사용 관리에서 엑세스라이선스와 비밀키를 받아 넣어 주세요. 대화로 보내지 말고 여기에만 넣습니다. 고객 번호는 위 안전장치 칸에 넣고 저장합니다.'}</p>
        <form className="ap-token" onSubmit={e => { e.preventDefault(); if (naverKey.key.trim() && naverKey.secret.trim()) void run('nkey', async () => { await api.setNaverAdsKeys(naverKey.key, naverKey.secret); setNaverKey({ key: '', secret: '' }) }, '네이버 열쇠를 금고에 넣었습니다.') }}>
          <input type="password" autoComplete="off" value={naverKey.key} onChange={e => setNaverKey({ ...naverKey, key: e.target.value })} placeholder="엑세스라이선스" aria-label="네이버 엑세스라이선스" />
          <input type="password" autoComplete="off" value={naverKey.secret} onChange={e => setNaverKey({ ...naverKey, secret: e.target.value })} placeholder="비밀키" aria-label="네이버 비밀키" />
          <Button type="submit" disabled={!naverKey.key.trim() || !naverKey.secret.trim() || !!busy}><KeyRound size={13} /> {st?.naver_token ? '열쇠 바꾸기' : '열쇠 넣기'}</Button>
        </form>
      </section>

      {/* 캠페인 · 기록 */}
      {camps.data.length > 0 && (
        <section className="ap-sec">
          <SectionHead title="메타 캠페인" count={camps.data.length} />
          <div className="ap-table-wrap"><table className="ap-table"><thead><tr><th>캠페인</th><th>상태</th><th>하루 예산</th><th>받은 시각</th></tr></thead><tbody>
            {camps.data.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.status === 'ACTIVE' ? '켜짐' : c.status === 'PAUSED' ? '멈춤' : c.status}</td><td>{c.daily_budget ? won(c.daily_budget) : c.lifetime_budget ? `총 ${won(c.lifetime_budget)}` : '광고 세트 예산'}</td><td className="tx-sub">{dateTimeLabel(c.synced_at)}</td></tr>)}
          </tbody></table></div>
        </section>
      )}
      <section className="ap-sec">
        <SectionHead title="판단 · 실행 기록" count={history.length || undefined} />
        {history.length === 0 ? <p className="ap-note">아직 기록이 없습니다.</p> : <ul className="ap-list">{history.map(a => <ActionCard key={a.id} a={a} />)}</ul>}
      </section>
    </div>
  )
}

function ActionCard({ a, busy, canRun, killed, onDecide }: { a: AutopilotAction; busy?: boolean; canRun?: boolean; killed?: boolean; onDecide?: (approve: boolean) => void }) {
  const m = a.metrics ?? {}
  return (
    <li className={`ap-card k-${a.kind} s-${a.status}`}>
      <div className="ap-card-top">
        {a.platform === 'naver' && <span className="ap-plat">네이버</span>}
        <span className="ap-kind">{a.ad_id ? '소재 ' : ''}{KIND_LABEL[a.kind]}</span>
        <b className="ap-camp">{a.campaign_name}{a.ad_name && <span className="ap-ad"> › {a.ad_name}</span>}</b>
        {a.kind !== 'pause' && <span className="ap-budget">{won(a.from_budget)} → {won(a.to_budget)}</span>}
        <span className={`ap-status s-${a.status}`}>{a.status}{a.auto && a.status === '실행' ? ' (자동)' : ''}</span>
      </div>
      <p className="ap-reason">{a.reason}</p>
      <div className="ap-metrics tx-sub">
        <span>7일 {won(m.spend)}</span><span>노출 {(m.impressions ?? 0).toLocaleString('ko-KR')}</span><span>클릭 {(m.clicks ?? 0).toLocaleString('ko-KR')}</span>
        <span>문의 {m.leads ?? 0}</span>{m.ctr != null && <span>클릭률 {m.ctr.toFixed(2)}%</span>}{m.cpc != null && <span>클릭당 {won(m.cpc)}</span>}{m.cpl != null && <span>문의당 {won(m.cpl)}</span>}
        <span>{a.day}</span>
      </div>
      {a.result && <p className="ap-result">{a.result}</p>}
      {a.effect && <p className={`ap-effect e-${a.effect}`}><b>7일 뒤 효과: {a.effect}</b> {a.effect_note}</p>}
      {a.ad_id && <div className="ap-card-act"><Link to="/ads?tab=studio" className="btn btn-outline btn-sm">새 소재 한 번에 만들기 ›</Link></div>}
      {onDecide && (
        <div className="ap-card-act">
          {canRun && !killed ? <Button size="sm" disabled={busy} onClick={() => onDecide(true)}><Play size={13} /> {busy ? '반영 중…' : '승인 · 메타에 반영'}</Button>
            : <span className="tx-sub">{killed ? '긴급 정지 중이라 반영하지 않습니다.' : "지금은 '제안만' 모드 — 반영하려면 모드를 '승인 뒤 실행'으로"}</span>}
          <Button kind="outline" size="sm" disabled={busy} onClick={() => onDecide(false)}>거절</Button>
        </div>
      )}
    </li>
  )
}
