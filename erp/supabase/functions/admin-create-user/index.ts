// Supabase Edge Function: 관리자 화면의 "팀원 추가" (사람·AI 팀원 계정 만들기)
// - 호출한 사람이 활성 관리자인지 그 사람의 로그인 토큰으로 확인한 뒤
// - service_role 키(이 함수 안에서만 사용, 브라우저로 나가지 않음)로 계정을 만들고 프로필을 채웁니다.
// 배포: supabase functions deploy admin-create-user   (README '팀원 추가 기능 켜기' 참고)
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

interface Body {
  email?: string
  password?: string
  name?: string
  title?: string | null
  role?: 'admin' | 'member'
  is_agent?: boolean
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json({ error: '함수 환경 변수가 없습니다.' }, 500)

  // 1) 호출한 사람이 활성 관리자인지 (본인 토큰으로 is_admin() 호출)
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: isAdmin, error: adminError } = await caller.rpc('is_admin')
  if (adminError || isAdmin !== true) return json({ error: '관리자만 팀원을 추가할 수 있습니다.' }, 403)

  // 2) 입력 확인
  const body = (await req.json().catch(() => null)) as Body | null
  const email = body?.email?.trim().toLowerCase() ?? ''
  const name = body?.name?.trim() ?? ''
  const password = body?.password ?? ''
  const role = body?.role === 'admin' ? 'admin' : 'member'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: '이메일 형식을 확인해 주세요.' }, 400)
  if (!name || name.length > 40) return json({ error: '이름을 확인해 주세요.' }, 400)
  if (password.length < 8 || password.length > 72) return json({ error: '임시 비밀번호는 8자 이상이어야 합니다.' }, 400)

  // 3) 계정 만들기 (이메일 확인 생략: 관리자가 직접 만든 계정)
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })
  if (error || !data.user) {
    const msg = error?.message ?? ''
    return json({ error: /already|registered|exists/i.test(msg) ? '이미 등록된 이메일입니다.' : msg || '계정을 만들지 못했습니다.' }, 400)
  }

  // 4) 프로필 채우기 (계정이 생기면 DB 트리거가 기본 프로필을 만듦)
  const { error: profileError } = await admin
    .from('profiles')
    .update({ name, title: body?.title?.trim() || null, role, is_agent: body?.is_agent === true })
    .eq('id', data.user.id)
  if (profileError) return json({ error: `계정은 만들었지만 프로필 저장에 실패했습니다: ${profileError.message}` }, 500)

  return json({ ok: true, id: data.user.id })
})
