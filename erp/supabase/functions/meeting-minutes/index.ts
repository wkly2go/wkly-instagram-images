// 회의록 AI (대표 지시 2026-10-18 · 방법 B)
//   보고서 결제 › 회의록 쓰기에서 녹음을 올리면 { id } 로 호출된다.
//   1) 호출한 사람이 그 녹음의 주인(또는 관리자)인지 본인 토큰으로 확인
//   2) 녹음을 Gemini Files 에 올려 화자를 나눠 받아쓰고, 회의록 양식(일시 · 장소 · 참석 · 안건 · 논의 · 결정 · 할 일)으로 정리
//   3) meeting_recordings 에 받아쓰기 · 회의록을 적고 상태 '완료' (화면이 몇 초마다 확인)
//   긴 회의는 응답을 먼저 돌려주고 뒤에서 처리한다. 녹음 원본은 30일 지나면 지운다.
// 필요한 비밀값: Vault 'GEMINI_API_KEY' (public.research_secret, service_role 만 읽음). 키는 로그 · 오류에 남기지 않는다.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const GEMINI = 'https://generativelanguage.googleapis.com'
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash']
const KEEP_DAYS = 30

interface Rec { id: string; created_by: string; title: string | null; attendees: string | null; audio_path: string | null; mime: string | null; created_at: string }
interface Minutes {
  datetime?: string
  place?: string
  attendees?: string[]
  agenda?: string[]
  discussion?: string[]
  decisions?: string[]
  todos?: { task: string; owner?: string; due?: string }[]
  transcript?: { speaker: string; text: string }[]
}

/** Gemini 가 받는 형식으로: 크롬 녹음(webm) · 휴대폰 녹음(m4a)은 영상 형식으로 보내 소리를 읽게 함 */
function geminiMime(m: string | null): string {
  const t = (m ?? '').split(';')[0].trim().toLowerCase()
  if (t === 'audio/webm' || t === 'video/webm') return 'video/webm'
  if (t === 'audio/mp4' || t === 'audio/m4a' || t === 'audio/x-m4a' || t === 'video/mp4') return 'video/mp4'
  if (t === 'audio/mp3') return 'audio/mpeg'
  if (t === 'audio/x-wav') return 'audio/wav'
  return t || 'audio/mpeg'
}

const fail = async (id: string, msg: string) => {
  await sb.from('meeting_recordings').update({ status: '실패', error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', id)
}

async function uploadToGemini(key: string, bytes: Uint8Array, mime: string, name: string) {
  const start = await fetch(`${GEMINI}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: name } }),
  })
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!start.ok || !uploadUrl) throw new Error(`녹음을 AI에 올리지 못했습니다 (${start.status})`)
  const up = await fetch(uploadUrl, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: bytes })
  if (!up.ok) throw new Error(`녹음을 AI에 올리지 못했습니다 (${up.status})`)
  let file = (await up.json()).file as { name: string; uri: string; state?: string }
  // 소리 파일 준비(ACTIVE)까지 기다림
  for (let i = 0; i < 40 && file.state === 'PROCESSING'; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const g = await fetch(`${GEMINI}/v1beta/${file.name}?key=${key}`)
    if (g.ok) file = await g.json()
  }
  if (file.state === 'FAILED') throw new Error('AI가 녹음 파일을 읽지 못했습니다. 다른 형식(m4a · mp3)으로 올려 보세요.')
  return file
}

const PROMPT = (rec: Rec, people: string[]) => `다음은 회사(THE WKLY · 아트리어) 회의 녹음이다. 한국어로 처리한다.
1) 받아쓰기: 말한 내용을 빠짐없이 순서대로 받아쓴다. 말하는 사람을 구분해 speaker 에 적는다.
   - 목소리 · 호칭 · 자기소개로 이름을 알 수 있으면 이름을 쓰고, 모르면 '화자 1', '화자 2' 처럼 쓴다.
   - 참석자 후보: ${[rec.attendees, ...people].filter(Boolean).join(', ') || '(알려지지 않음)'}
   - 말버릇 · 군말(음, 어)은 빼되 숫자 · 날짜 · 금액 · 고유명사는 들린 그대로 적는다. 들리지 않는 곳은 [불명확].
2) 회의록: 받아쓰기만 근거로 정리한다. 추측하지 않는다. 건조한 사실 서술(-다).
   - datetime: 녹음에서 말한 일시가 없으면 빈 문자열
   - place, attendees(이름 목록), agenda(안건), discussion(논의 내용, 안건별 핵심 2~5줄), decisions(결정 사항), todos(할 일: task · owner(담당, 말한 경우만) · due(기한 YYYY-MM-DD, 말한 경우만))
회의 제목(참고): ${rec.title ?? '-'}
JSON 하나로만 답한다: {"datetime":"","place":"","attendees":[],"agenda":[],"discussion":[],"decisions":[],"todos":[{"task":"","owner":"","due":""}],"transcript":[{"speaker":"","text":""}]}`

function minutesText(m: Minutes, rec: Rec, fallbackDate: string): string {
  const list = (a?: string[]) => (a?.length ? a.map(x => `- ${x}`).join('\n') : '- ')
  const todos = m.todos?.length ? m.todos.map(t => `- ${t.task}${t.owner ? ` · 담당 ${t.owner}` : ''}${t.due ? ` · 기한 ${t.due}` : ''}`).join('\n') : '- '
  return [
    `일시: ${m.datetime || fallbackDate}`,
    `장소: ${m.place || ''}`,
    `참석: ${(m.attendees?.length ? m.attendees.join(', ') : rec.attendees) || ''}`,
    '',
    '[안건]',
    list(m.agenda),
    '',
    '[논의 내용]',
    list(m.discussion),
    '',
    '[결정 사항]',
    list(m.decisions),
    '',
    '[할 일]',
    todos,
  ].join('\n')
}

async function transcribe(rec: Rec) {
  try {
    const { data: key } = await sb.rpc('research_secret', { p_name: 'GEMINI_API_KEY' })
    if (!key) return fail(rec.id, 'Gemini 키가 등록되지 않았습니다. 관리자에게 요청: Supabase Vault 에 GEMINI_API_KEY 등록')
    if (!rec.audio_path) return fail(rec.id, '녹음 파일이 없습니다.')
    const dl = await sb.storage.from('meeting-audio').download(rec.audio_path)
    if (dl.error || !dl.data) return fail(rec.id, '녹음 파일을 읽지 못했습니다.')
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const mime = geminiMime(rec.mime ?? dl.data.type)
    const file = await uploadToGemini(key as string, bytes, mime, `meeting-${rec.id}`)
    const { data: people } = await sb.from('profiles').select('name').eq('active', true).eq('is_agent', false)

    let out: Minutes | null = null
    let lastErr = ''
    for (const model of MODELS) {
      const r = await fetch(`${GEMINI}/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ file_data: { mime_type: mime, file_uri: file.uri } }, { text: PROMPT(rec, (people ?? []).map(p => p.name)) }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 65536 },
        }),
      })
      if (!r.ok) {
        lastErr = `AI 정리 실패 (${r.status})`
        if (r.status === 404) continue // 모델 이름이 바뀐 경우 다음 모델
        break
      }
      const body = await r.json()
      const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
      try {
        out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Minutes
      } catch {
        lastErr = 'AI 답을 읽지 못했습니다. 다시 시도해 주세요.'
      }
      break
    }
    // AI 쪽 임시 파일은 바로 지움
    await fetch(`${GEMINI}/v1beta/${file.name}?key=${key}`, { method: 'DELETE' }).catch(() => undefined)
    if (!out) return fail(rec.id, lastErr || 'AI 정리 실패')

    const date = new Date(new Date(rec.created_at).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
    const transcript = (out.transcript ?? []).map(t => `${t.speaker || '화자'}: ${t.text}`).join('\n')
    await sb
      .from('meeting_recordings')
      .update({ status: '완료', minutes: minutesText(out, rec, date), transcript, error: null, updated_at: new Date().toISOString() })
      .eq('id', rec.id)
  } catch (e) {
    await fail(rec.id, e instanceof Error ? e.message.replace(/key=[^&\s]+/g, 'key=***') : 'AI 정리 실패')
  }
}

/** 30일 지난 녹음 원본 지우기 (받아쓰기 · 회의록은 남김) */
async function cleanup() {
  const before = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString()
  const { data } = await sb.from('meeting_recordings').select('id, audio_path').lt('created_at', before).not('audio_path', 'is', null).limit(50)
  if (!data?.length) return
  await sb.storage.from('meeting-audio').remove(data.map(r => r.audio_path as string))
  await sb.from('meeting_recordings').update({ audio_path: null }).in('id', data.map(r => r.id))
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: u } = await caller.auth.getUser()
  if (!u?.user) return json({ error: '로그인이 필요합니다.' }, 401)

  const body = (await req.json().catch(() => null)) as { id?: string } | null
  const id = body?.id ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: '녹음을 확인해 주세요.' }, 400)
  // 본인 토큰으로 읽어 권한 확인 (본인 · 관리자만 보임)
  const { data: rec } = await caller.from('meeting_recordings').select('id, created_by, title, attendees, audio_path, mime, created_at, status').eq('id', id).maybeSingle()
  if (!rec) return json({ error: '녹음을 찾을 수 없습니다.' }, 404)
  if (rec.status === '처리 중') return json({ ok: true, status: '처리 중' })

  await sb.from('meeting_recordings').update({ status: '처리 중', error: null, updated_at: new Date().toISOString() }).eq('id', id)
  const job = transcribe(rec as Rec).then(cleanup).catch(() => undefined)
  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(job)
    return json({ ok: true, status: '처리 중' }, 202)
  }
  await job
  return json({ ok: true })
})
