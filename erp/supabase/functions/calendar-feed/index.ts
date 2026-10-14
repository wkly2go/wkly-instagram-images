// WKLY ERP 일정 구독 주소 (구글 캘린더 · 아이폰 캘린더 'URL로 추가')
//   GET /functions/v1/calendar-feed?t=<개인 토큰>[&scope=team]
//   - 토큰은 calendar_feeds 에서 본인이 발급 (calendar_feed_token RPC). 다시 만들면 예전 주소는 막힘
//   - 기본: 내 할 일 · 진행 중 프로젝트 기간 · 내 휴가 / scope=team: 팀 전체 할 일 · 휴가
//   - 금액 정보는 넣지 않는다. 구글 캘린더는 몇 시간마다 이 주소를 다시 읽는다.
// 배포: verify_jwt = false (구글 서버가 로그인 없이 읽어야 하므로 토큰으로만 확인)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const APP = 'https://wkly-erp.pages.dev'

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const d8 = (d: string) => d.slice(0, 10).replace(/-/g, '')
const nextDay = (d: string) => {
  const t = new Date(d.slice(0, 10) + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
// 한 줄 75바이트 넘으면 접기 (RFC 5545)
function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 74) return line
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 73 : 74)) {
      out.push(cur)
      cur = ''
    }
    cur += ch
  }
  out.push(cur)
  return out.join('\r\n ')
}

interface Ev {
  uid: string
  start: string
  end?: string | null
  title: string
  desc?: string
  url?: string
  alarm?: string | null
  done?: boolean
}

function vevent(e: Ev, stamp: string): string[] {
  const endEx = nextDay(e.end && e.end >= e.start ? e.end : e.start)
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}@wkly-erp`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d8(e.start)}`,
    `DTEND;VALUE=DATE:${d8(endEx)}`,
    `SUMMARY:${esc(e.title)}`,
    'TRANSP:TRANSPARENT',
  ]
  if (e.desc) lines.push(`DESCRIPTION:${esc(e.desc)}`)
  if (e.url) lines.push(`URL:${e.url}`)
  if (e.alarm && !e.done) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER;VALUE=DATE-TIME:${utc(e.alarm)}`, 'END:VALARM')
  lines.push('END:VEVENT')
  return lines
}

Deno.serve(async req => {
  const url = new URL(req.url)
  const token = url.searchParams.get('t') ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response('not found', { status: 404 })
  const { data: feed } = await sb.from('calendar_feeds').select('user_id').eq('token', token).maybeSingle()
  if (!feed) return new Response('not found', { status: 404 })
  const me = feed.user_id as string
  const { data: meProfile } = await sb.from('profiles').select('name, active').eq('id', me).maybeSingle()
  if (!meProfile?.active) return new Response('not found', { status: 404 })
  const team = url.searchParams.get('scope') === 'team'

  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  const [{ data: people }, { data: tasks }, { data: projects }, { data: leaves }] = await Promise.all([
    sb.from('profiles').select('id, name'),
    (team ? sb.from('tasks').select('*') : sb.from('tasks').select('*').eq('assignee_id', me)).or(`due_date.gte.${since},start_date.gte.${since}`),
    sb.from('projects').select('id, name, status, start_date, end_date').neq('status', '보류'),
    (team ? sb.from('leave_records').select('*') : sb.from('leave_records').select('*').eq('profile_id', me)).eq('status', '승인').gte('end_date', since),
  ])
  const nameOf = new Map((people ?? []).map(p => [p.id as string, p.name as string]))
  const projName = new Map((projects ?? []).map(p => [p.id as string, p.name as string]))
  const stamp = utc(new Date().toISOString())
  const ev: string[] = []

  for (const t of tasks ?? []) {
    const start = (t.start_date ?? t.due_date) as string | null
    if (!start) continue
    const who = t.assignee_id ? nameOf.get(t.assignee_id) : null
    const done = t.status === '완료'
    const prefix = done ? '✓ ' : ''
    const title = `${prefix}${t.title}${team && who ? ` · ${who}` : ''}`
    const desc = [t.project_id && projName.get(t.project_id) ? `프로젝트: ${projName.get(t.project_id)}` : null, who ? `담당: ${who}` : '담당 미정', `상태: ${t.status}`, t.memo ? `\n${t.memo}` : null]
      .filter(Boolean)
      .join('\n')
    ev.push(...vevent({ uid: `task-${t.id}`, start, end: t.due_date, title, desc, url: `${APP}/projects?view=mine`, alarm: t.remind_at, done }, stamp))
  }
  for (const p of projects ?? []) {
    if (!p.start_date && !p.end_date) continue
    const start = (p.start_date ?? p.end_date) as string
    ev.push(...vevent({ uid: `project-${p.id}`, start, end: p.end_date, title: `[프로젝트] ${p.name}`, desc: `상태: ${p.status}`, url: `${APP}/projects` }, stamp))
  }
  for (const l of leaves ?? []) {
    const who = nameOf.get(l.profile_id) ?? ''
    ev.push(...vevent({ uid: `leave-${l.id}`, start: l.start_date, end: l.end_date, title: `${team || l.profile_id !== me ? who + ' ' : ''}${l.kind}`, url: `${APP}/team` }, stamp))
  }

  const cal = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//THE WKLY//사내 인트라넷//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(team ? 'WKLY 팀 일정' : `WKLY 내 일정 (${meProfile.name})`)}`,
    'X-WR-TIMEZONE:Asia/Seoul',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...ev,
    'END:VCALENDAR',
  ]
  return new Response(cal.map(fold).join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': 'inline; filename="wkly.ics"' },
  })
})
