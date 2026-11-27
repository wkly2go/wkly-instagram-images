// 영상 편집 작업 처리기(맥)용 창구 (2026-11-27)
//  · 로그인 확인 끔(verify_jwt false) — 대신 작업 처리기 열쇠(scope video_worker)를 DB 가 확인한다
//  · 요청 받기 · 끝내기는 DB 함수 agent_video_job_* 를 작업 처리기가 직접 부른다
//  · action 없음: 미리보기 올릴 주소를 만들어 준다
//  · action 'plan': 맥이 보낸 장면 사진으로 편집 지시서를 Claude Console(API · 서버 함수 비밀 ANTHROPIC_API_KEY)에 묻는다
//    (대표 지시 'ai들은 모두 클로드 콘솔에' — 맥의 Claude Code 개인 로그인을 쓰지 않는다). 사용량은 ai_usage_log 에 적고 월 한도 · 크레딧 · 하루 횟수를 지킨다.
import Anthropic from 'npm:@anthropic-ai/sdk@0.134.0'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'
import { checkClips, clipLine, creditOpen, DAILY_PLAN_LIMIT, parsePlan, PLAN_MODEL, PLAN_SYSTEM, planRequest } from './plan.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** 지시서를 못 만들면 plan null + 이유 — 맥은 규칙으로 대신 자른다 (요청 자체는 실패가 아님) */
async function makePlan(admin: SupabaseClient, jobId: string, rawClips: unknown): Promise<Response> {
  const clips = checkClips(rawClips)
  if (typeof clips === 'string') return json({ error: clips }, 400)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ plan: null, reason: 'AI 열쇠가 서버에 없습니다.' })

  const [credit, month, today] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'anthropic_free_credit').maybeSingle(),
    admin.rpc('ai_month_state'),
    admin.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('source', 'video-plan').gte('created_at', new Date(Date.now() - 86_400_000).toISOString()),
  ])
  if (!creditOpen(credit.data?.value as never, Date.now())) return json({ plan: null, reason: '남은 AI 크레딧이 없어 규칙으로 자릅니다.' })
  if (month.data && (month.data as { ok?: boolean }).ok === false) return json({ plan: null, reason: '이번 달 AI 한도에 닿아 규칙으로 자릅니다.' })
  if ((today.count ?? 0) >= DAILY_PLAN_LIMIT) return json({ plan: null, reason: '오늘 AI 지시서 횟수를 다 써 규칙으로 자릅니다.' })

  const { data: job, error } = await admin.from('video_edit_jobs').select('title,template,instructions,target_seconds,parent_id').eq('id', jobId).single()
  if (error || !job) return json({ error: '요청을 찾지 못했습니다.' }, 404)
  let parentSegments: unknown
  if (job.parent_id) {
    const { data: parent } = await admin.from('video_edit_jobs').select('plan').eq('id', job.parent_id).maybeSingle()
    parentSegments = (parent?.plan as { segments?: unknown } | null)?.segments
  }

  const content: Anthropic.Messages.ContentBlockParam[] = []
  clips.forEach((c, i) => {
    content.push({ type: 'text', text: clipLine(c, i) })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.image } })
  })
  content.push({ type: 'text', text: planRequest({ ...job, parent_segments: parentSegments }) })

  try {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({ model: PLAN_MODEL, max_tokens: 2500, system: PLAN_SYSTEM, messages: [{ role: 'user', content }] })
    const u = res.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
    await admin.rpc('ai_usage_record', {
      p_source: 'video-plan', p_agent: null, p_model: PLAN_MODEL, p_input: u.input_tokens ?? 0, p_output: u.output_tokens ?? 0,
      p_cache_read: u.cache_read_input_tokens ?? 0, p_cache_write: u.cache_creation_input_tokens ?? 0, p_web: 0,
    })
    const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    const plan = parsePlan(text)
    return json(plan ? { plan, model: PLAN_MODEL } : { plan: null, reason: 'AI 답이 지시서 형식이 아니어서 규칙으로 자릅니다.' })
  } catch (e) {
    return json({ plan: null, reason: `AI 를 부르지 못했습니다: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 받습니다.' }, 405)
  if (Number(req.headers.get('content-length') ?? 0) > 12_000_000) return json({ error: '요청이 너무 큽니다.' }, 413)
  let body: { token?: string; job_id?: string; action?: string; clips?: unknown }
  try { body = await req.json() } catch { return json({ error: '요청 형식이 맞지 않습니다.' }, 400) }
  const token = String(body.token ?? '')
  const jobId = String(body.job_id ?? '')
  if (!/^wkly_[0-9a-f]{48}$/.test(token) || !/^[0-9a-f-]{36}$/.test(jobId)) return json({ error: '요청 형식이 맞지 않습니다.' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // 열쇠가 맞고 그 요청이 '편집 중'일 때만 통과
  const { data: path, error } = await admin.rpc('agent_video_job_check', { p_token: token, p_id: jobId })
  if (error || typeof path !== 'string') return json({ error: error?.message ?? '확인하지 못했습니다.' }, 403)

  if (body.action === 'plan') return await makePlan(admin, jobId, body.clips)

  const { data, error: signError } = await admin.storage.from('video-edits').createSignedUploadUrl(path, { upsert: true })
  if (signError || !data) return json({ error: signError?.message ?? '올릴 주소를 만들지 못했습니다.' }, 500)
  return json({ path, upload_url: data.signedUrl })
})
