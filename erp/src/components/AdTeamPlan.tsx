import { useMemo, useRef, useState } from 'react'
import { Link } from '../lib/router'
import { useApp, useAsync } from '../lib/app'
import { addDays, shortDate, todayKey } from '../lib/date'
import { adVerdictTable } from '../lib/adVerdict'
import { parseAdSheets, type AdImportResult } from '../lib/adImport'
import type { AdDaily, AdPlatform, AgentReport, ApprovalSummary } from '../lib/types'
import { Button } from './ui'
import { ReportBody } from './Reports'

/**
 * 광고 운영팀 (대표 지시 2026-11-16 '광고기획 · 퍼포먼스 마케팅 · 컨텐츠 크리에이팅 · UI·UX·AX 디자이너 · 영상 광고 디렉터가 한 팀으로 · 결재는 대표',
 * 2026-11-17 '예약 작업 4개 만들어 · 자사 · 비용이 들지 않게')
 *  - 이번 주 진행: 기획서 → 결재 ① → 소재 · 랜딩 · 영상 → 검수 → 결재 ② (예약 작업 4개가 agent_reports · approvals 에 남긴 것을 읽음)
 *  - 퍼포먼스: 매체에서 내려받은 수치 파일 올리기 + 주간 판정표(계산식 · AI 아님). 유료 연동 · AI 호출 없음
 *  - 집행 · 게시 · 예산 변경은 하지 않는다. 결재는 대표.
 */
const JOB = { plan: 'AD-PLAN 광고 기획', crea: 'AD-CREA 광고 소재', ux: 'AD-UX 랜딩 · 문의 경로', film: 'AD-FILM 영상 광고' }
const ROLES: [string, string, string, string][] = [
  ['AD-PLAN', '광고 기획 (팀장)', '주간 가설 2~3개 · 타깃 · 메시지 · 오퍼 · 채널 배분 · 판정 기준 · 팀 지시 · 검수', '월 · 수 09:17'],
  ['퍼포먼스', '수치 · 판정 (화면 계산)', '매체 수치 파일 올리기 · 주간 판정표. AI 를 쓰지 않습니다', '수치를 올릴 때마다'],
  ['AD-CREA', '콘텐츠 크리에이팅', '카피 · 이미지 소재 제작 지시 (가설당 2~3종)', '화 · 수 08:23'],
  ['AD-UX', 'UI · UX · AX 디자인', '광고 → 랜딩 → 문의 경로 수정안 · UTM 규칙 · AI 응대 경로 · 점검표', '화 · 수 08:37'],
  ['AD-FILM', '영상 광고 디렉터', '릴스 · 쇼츠 광고 콘티 · 촬영 · 편집 지시', '화 · 수 08:49'],
]
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const num = (n: number) => Math.round(n).toLocaleString('ko-KR')
const weekMonday = () => { const t = todayKey(); const d = new Date(`${t}T00:00:00`); return addDays(t, -((d.getDay() + 6) % 7)) }

export function AdTeamPlan() {
  const { api, me } = useApp()
  const admin = me.role === 'admin'
  const week = weekMonday()
  return (
    <div className="adteam">
      <div className="adteam-state live">
        <b>운영 중 · 예약 작업 4개</b>
        <span>자사 광고(더위클리 · 아트리어)만 다룹니다. 팀은 초안까지만 만들고 집행 · 게시 · 예산 변경은 하지 않습니다. 결재는 대표가 합니다.</span>
      </div>
      {admin ? <ThisWeek week={week} /> : <p className="adteam-note">이번 주 기획서와 산출물은 관리자만 볼 수 있습니다.</p>}
      <Performance admin={admin} api={api} />
      <details className="adteam-how">
        <summary>운영 방식 · 역할 · 결재 규칙</summary>
        <div className="adteam-roles">
          {ROLES.map(([code, role, work, when]) => (
            <article key={code} className="adteam-role">
              <span className="adteam-code">{code}</span>
              <h3>{role}</h3>
              <p>{work}</p>
              <p className="adteam-out"><b>실행</b> {when}</p>
            </article>
          ))}
        </div>
        <ul className="adteam-list">
          <li><b>월요일</b> 광고 기획이 주간 기획서를 쓰고 결재 ① (기획 · 예산)을 올립니다.</li>
          <li><b>화 · 수 아침</b> 승인된 기획서 기준으로 소재 · 랜딩 · 영상 콘티를 만듭니다. 화요일 08시 전에 승인하면 화요일에, 그 뒤면 수요일 아침에 만듭니다.</li>
          <li><b>수요일</b> 광고 기획이 묶음을 검수하고 결재 ② (소재 · 랜딩)를 올립니다. 승인된 것만 사람이 집행합니다.</li>
          <li>수시 결재: 일 예산 증감, 새 채널, 랜딩 페이지 배포, 유료 도구. 알림 제목에는 금액을 넣지 않습니다.</li>
          <li>비용: 유료 도구 · 이미지/영상 생성 · 외부 연동을 쓰지 않습니다. 이미지는 캠페인 준비의 '광고 이미지 만들기'로 만듭니다.</li>
          <li>평가 지표: 문의당 비용 · 월 문의 수(목표 30건) → 가설 적중률 · 소재 교체 주기 · 랜딩 문의 전환율 → 광고 유입 문의의 수주 전환.</li>
        </ul>
        <p className="adteam-note">남은 결정: 콘텐츠팀 디자인 · 영상(GFX)과의 관계, AX 의 뜻(지금은 'AI 를 거쳐 들어오는 고객 경험'으로 해석).</p>
      </details>
    </div>
  )
}

/** 이번 주 순환: 예약 작업이 남긴 보고와 결재를 한 줄로 */
function ThisWeek({ week }: { week: string }) {
  const { api, toast } = useApp()
  const state = useAsync(async () => {
    const [reports, approvals] = await Promise.all([api.listAgentReports(week, addDays(week, 6)), api.listApprovals()])
    return {
      reports: reports.filter(r => Object.values(JOB).includes(r.job_name) && r.title.endsWith(` · ${week}`)),
      // 결재 제목은 저장될 때 '[AI 결재 요청]' 머리말이 지워진다
      approvals: approvals.filter(a => /^(\[AI 결재 요청\]\s*)?광고 (주간 기획|소재 · 랜딩)/.test(a.title) && a.title.endsWith(` · ${week}`)),
    }
  }, [api, week], { reports: [] as AgentReport[], approvals: [] as ApprovalSummary[] })
  const [busy, setBusy] = useState('')
  const [comment, setComment] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const report = (job: string, head: string) => state.data.reports.find(r => r.job_name === job && r.title.startsWith(head))
  const approval = (head: string) => state.data.approvals.filter(a => a.title.includes(head)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  const decide = async (a: ApprovalSummary, status: '승인' | '반려') => {
    if (status === '반려' && !comment.trim()) { toast('반려할 때는 바꿀 방향을 적어 주세요.'); return }
    setBusy(a.id)
    try { await api.decideApproval(a.id, status, comment.trim() || undefined); setComment(''); toast(status === '승인' ? '승인했습니다.' : '반려했습니다. 다음 실행 때 고쳐서 다시 올립니다.'); state.reload() }
    catch (e) { toast(e instanceof Error ? e.message : '결재를 저장하지 못했습니다.') }
    finally { setBusy('') }
  }
  const steps: { key: string; label: string; who: string; r?: AgentReport; a?: ApprovalSummary; gate?: string }[] = [
    { key: 'plan', label: '주간 기획서', who: 'AD-PLAN', r: report(JOB.plan, '광고 주간 기획서'), a: approval('광고 주간 기획'), gate: '결재 ① 기획 · 예산' },
    { key: 'crea', label: '광고 소재 묶음', who: 'AD-CREA', r: report(JOB.crea, '광고 소재 묶음') },
    { key: 'ux', label: '랜딩 · 문의 경로 수정안', who: 'AD-UX', r: report(JOB.ux, '랜딩') },
    { key: 'film', label: '영상 광고 콘티', who: 'AD-FILM', r: report(JOB.film, '영상 광고 콘티') },
    { key: 'review', label: '소재 · 랜딩 검수', who: 'AD-PLAN', r: report(JOB.plan, '광고 소재 · 랜딩 검수'), a: approval('광고 소재 · 랜딩'), gate: '결재 ② 소재 · 랜딩' },
  ]
  return (
    <section className="adteam-sec">
      <div className="adteam-head">
        <h2>이번 주 진행 <small>{shortDate(week)} 주</small></h2>
        <Button kind="outline" size="sm" disabled={state.loading} onClick={state.reload}>새로 고침</Button>
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      <ol className="adteam-flow">
        {steps.map(s => {
          const done = !!s.r && s.r.verdict === '완료'
          const tone = s.a ? (s.a.status === '승인' ? 'ok' : s.a.status === '반려' ? 'off' : 'wait') : done ? 'ok' : 'none'
          const stateText = s.a ? `결재 ${s.a.status}` : done ? '작성됨' : s.r ? s.r.verdict : '아직 없음'
          return (
            <li key={s.key} className={`adteam-step ${tone}`}>
              <div className="adteam-step-top">
                <span className="adteam-code">{s.who}</span>
                <b>{s.label}</b>
                <span className={`adteam-chip ${tone}`}>{stateText}</span>
                {s.r?.run_at && <small>{new Date(s.r.run_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>}
                {s.r?.body && <Button kind="ghost" size="sm" aria-expanded={open === s.key} onClick={() => setOpen(open === s.key ? null : s.key)}>{open === s.key ? '접기' : '내용 보기'}</Button>}
              </div>
              {s.r?.summary && <p className="adteam-sum">{s.r.summary}</p>}
              {open === s.key && s.r?.body && <div className="adteam-body"><ReportBody body={s.r.body} /></div>}
              {s.a && s.a.status === '대기' && (
                <div className="adteam-decide">
                  <strong>{s.gate}</strong>
                  <input className="input" value={comment} maxLength={300} onChange={e => setComment(e.target.value)} placeholder="조건이나 반려 사유 (승인은 비워도 됩니다)" aria-label={`${s.gate} 의견`} />
                  <Button size="sm" disabled={busy === s.a.id} onClick={() => void decide(s.a!, '승인')}>승인</Button>
                  <Button kind="outline" size="sm" disabled={busy === s.a.id} onClick={() => void decide(s.a!, '반려')}>반려</Button>
                  <Link to={`/approvals?id=${s.a.id}`}>결재함에서 보기</Link>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** 퍼포먼스: 수치 파일 올리기 + 주간 판정표 (계산식) */
function Performance({ admin, api }: { admin: boolean; api: ReturnType<typeof useApp>['api'] }) {
  const { toast } = useApp()
  const today = todayKey()
  const state = useAsync(() => api.listAdDaily(addDays(today, -90), today), [api, today], [] as AdDaily[])
  const table = useMemo(() => adVerdictTable(state.data), [state.data])
  const stale = table.lastDate ? Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${table.lastDate}T00:00:00`).getTime()) / 86400000) : null
  const [platform, setPlatform] = useState<AdPlatform | ''>('')
  const [parsed, setParsed] = useState<(AdImportResult & { name: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const read = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const { readGrid } = await import('../lib/ledgerImport')
      const grids = await readGrid(await file.arrayBuffer(), file.name)
      setParsed({ ...parseAdSheets(grids as (string | number | null)[][][], platform || null), name: file.name })
    } catch (e) { toast(e instanceof Error ? e.message : '파일을 읽지 못했습니다.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const save = async () => {
    if (!parsed?.rows.length) return
    setBusy(true)
    try { const r = await api.importAdDaily(parsed.rows); toast(`광고 수치 ${r.saved}줄을 올렸습니다.`); setParsed(null); state.reload() }
    catch (e) { toast(e instanceof Error ? e.message : '수치를 올리지 못했습니다.') }
    finally { setBusy(false) }
  }
  return (
    <section className="adteam-sec">
      <div className="adteam-head"><h2>퍼포먼스 <small>수치 · 주간 판정</small></h2></div>
      <p className={`adteam-note${stale != null && stale > 7 ? ' warn' : ''}`}>
        {table.lastDate ? `마지막 수치 ${shortDate(table.lastDate)} (${stale}일 전).` : '올라온 광고 수치가 없습니다.'}
        {stale != null && stale > 7 && ' 수치가 일주일 넘게 비어 있어 기획과 판정이 예전 자료로 이루어집니다.'}
      </p>
      {admin && (
        <div className="adteam-upload">
          <strong>광고 수치 올리기</strong>
          <span>메타 광고 관리자 · 구글 광고 · 네이버 검색광고에서 <b>일별 · 캠페인별</b> 표를 엑셀이나 CSV 로 내려받아 올려 주세요. 같은 날 · 같은 캠페인은 새 값으로 바뀝니다.</span>
          <div className="adteam-upload-row">
            <select className="input" value={platform} onChange={e => setPlatform(e.target.value as AdPlatform | '')} aria-label="매체">
              <option value="">매체 자동 판별</option><option value="Meta">Meta</option><option value="Google">Google</option><option value="Naver">Naver</option><option value="기타">기타</option>
            </select>
            <input ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => void read(e.target.files?.[0])} />
            <Button kind="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>파일 고르기</Button>
          </div>
          {parsed && (
            <div className="adteam-parsed" role="status">
              {parsed.rows.length ? (
                <>
                  <span><b>{parsed.name}</b> · {parsed.platform} · {parsed.rows.length}줄 ({shortDate(parsed.rows[0].date)} ~ {shortDate(parsed.rows[parsed.rows.length - 1].date)}) · 비용 합계 {won(parsed.rows.reduce((n, r) => n + r.cost, 0))}{parsed.skipped ? ` · 건너뜀 ${parsed.skipped}줄` : ''}</span>
                  <Button size="sm" disabled={busy} onClick={() => void save()}>이대로 올리기</Button>
                  <Button kind="ghost" size="sm" disabled={busy} onClick={() => setParsed(null)}>취소</Button>
                </>
              ) : <span>{parsed.name}: {parsed.reason}</span>}
            </div>
          )}
        </div>
      )}
      {table.rows.length > 0 && (
        <>
          <h3 className="adteam-sub">주간 판정표 <small>{shortDate(table.from)} ~ {shortDate(table.to)} · 앞 7일과 비교 · 계산식에 따른 제안이며 AI 판단이 아닙니다</small></h3>
          <div className="adteam-scroll">
            <table className="table adteam-verdict">
              <thead><tr><th>매체</th><th>캠페인 · 근거</th><th>제안</th><th>비용</th><th>앞 7일</th><th>클릭</th><th>클릭률</th><th>클릭당 비용</th><th>전환</th></tr></thead>
              <tbody>
                {table.rows.map(r => (
                  <tr key={`${r.platform}|${r.campaign}`}>
                    <td>{r.platform}</td><td className="what"><b>{r.campaign}</b><small>{r.why}</small></td>
                    <td><span className={`adteam-chip ${r.verdict === '증액 후보' ? 'ok' : r.verdict === '중단 후보' ? 'off' : 'none'}`}>{r.verdict}</span></td>
                    <td className="n">{won(r.cost)}</td><td className="n">{won(r.prevCost)}</td><td className="n">{num(r.clicks)}</td>
                    <td className="n">{r.ctr == null ? '–' : `${r.ctr.toFixed(2)}%`}</td><td className="n">{r.cpc == null ? '–' : won(r.cpc)}</td><td className="n">{num(r.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
