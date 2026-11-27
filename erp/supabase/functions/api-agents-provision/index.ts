// API 에이전트를 Claude Console 에 등록 (2026-11-27 대표 지시 'ai들은 모두 인트라넷용으로 클로드 콘솔에 만들고 운영해')
//  표 api_agents 에 console_agent_id 가 빈 에이전트마다 Console 에이전트를 하나 만들고 그 ID 를 적는다.
//  실행 환경(console_env_id)은 이미 등록된 에이전트의 것을 같이 쓴다. 지침 · 도구 · 모델은 실행 때마다 표의 값으로 덮어쓰므로 여기서는 이름만 정한다.
//  예약 열쇠(x-sync-key = 금고 GDRIVE_SYNC_KEY)로만 부른다. 로그인 확인 끔(verify_jwt false).
import Anthropic from 'npm:@anthropic-ai/sdk@0.134.0'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const { data: want } = await sb.rpc('gdrive_secret_get', { p_name: 'GDRIVE_SYNC_KEY' })
  if (!want || req.headers.get('x-sync-key') !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY 가 서버 함수 비밀에 없습니다.' }, 500)
  const client = new Anthropic({ apiKey })

  const { data: all, error } = await sb.from('api_agents').select('id,code,name,model,console_agent_id,console_env_id')
  if (error) return json({ error: error.message }, 500)
  const envId = (all ?? []).find(a => a.console_env_id)?.console_env_id as string | undefined
  if (!envId) return json({ error: '같이 쓸 실행 환경(console_env_id)이 등록된 에이전트가 없습니다.' }, 409)

  const done: { code: string; ok: boolean; note: string }[] = []
  for (const a of (all ?? []).filter(x => !x.console_agent_id)) {
    try {
      // deno-lint-ignore no-explicit-any
      const created = await (client.beta as any).agents.create({
        name: `WKLY 인트라넷 · ${a.name} (${a.code})`.slice(0, 256),
        model: a.model,
        description: '더위클리 · 아트리어 인트라넷 전용 예약 에이전트. 지침과 도구는 인트라넷 표 api_agents 가 기준입니다.',
        metadata: { code: String(a.code), source: 'wkly-intranet' },
        betas: ['managed-agents-2026-04-01'],
      })
      const upd = await sb.from('api_agents').update({ console_agent_id: created.id, console_env_id: a.console_env_id ?? envId }).eq('id', a.id)
      done.push({ code: a.code, ok: !upd.error, note: upd.error?.message ?? 'Console 에 등록함' })
    } catch (e) {
      done.push({ code: a.code, ok: false, note: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
    }
  }
  return json({ ok: true, registered: done })
})
