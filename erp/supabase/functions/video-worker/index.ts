// 영상 편집 작업 처리기(맥)용 창구 — 미리보기 올릴 주소만 만들어 준다 (2026-11-27)
//  · 로그인 확인 끔(verify_jwt false) — 대신 작업 처리기 열쇠(scope video_worker)를 DB 가 확인한다
//  · 요청 받기 · 끝내기는 DB 함수 agent_video_job_* 를 작업 처리기가 직접 부른다
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 받습니다.' }, 405)
  let body: { token?: string; job_id?: string }
  try { body = await req.json() } catch { return json({ error: '요청 형식이 맞지 않습니다.' }, 400) }
  const token = String(body.token ?? '')
  const jobId = String(body.job_id ?? '')
  if (!/^wkly_[0-9a-f]{48}$/.test(token) || !/^[0-9a-f-]{36}$/.test(jobId)) return json({ error: '요청 형식이 맞지 않습니다.' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: path, error } = await admin.rpc('agent_video_job_check', { p_token: token, p_id: jobId })
  if (error || typeof path !== 'string') return json({ error: error?.message ?? '확인하지 못했습니다.' }, 403)

  const { data, error: signError } = await admin.storage.from('video-edits').createSignedUploadUrl(path, { upsert: true })
  if (signError || !data) return json({ error: signError?.message ?? '올릴 주소를 만들지 못했습니다.' }, 500)
  return json({ path, upload_url: data.signedUrl })
})
