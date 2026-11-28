// API 에이전트를 Claude Console 에 등록 (2026-11-27 대표 지시 'ai들은 모두 인트라넷용으로 클로드 콘솔에 만들고 운영해')
//  표 api_agents 에 console_agent_id 가 빈 에이전트마다 Console 에이전트를 하나 만들고 그 ID 를 적는다.
//  실행 환경(console_env_id)은 이미 등록된 에이전트의 것을 같이 쓴다 — 웹 검색을 쓰는 에이전트는 웹 검색 에이전트의 환경, 안 쓰는 에이전트는 안 쓰는 쪽 환경
//  (11/27 SEO 가 웹이 막힌 환경을 받아 검색이 모두 url_not_allowed 로 실패했음). 지침 · 도구 · 모델은 실행 때마다 표의 값으로 덮어쓰므로 여기서는 이름만 정한다.
//  예약 열쇠(x-sync-key = 금고 GDRIVE_SYNC_KEY)로만 부른다. 로그인 확인 끔(verify_jwt false).
import Anthropic, { toFile } from 'npm:@anthropic-ai/sdk@0.134.0'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const sha = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))).map(x => x.toString(16).padStart(2, '0')).join('')
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const { data: want } = await sb.rpc('gdrive_secret_get', { p_name: 'GDRIVE_SYNC_KEY' })
  if (!want || req.headers.get('x-sync-key') !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY 가 서버 함수 비밀에 없습니다.' }, 500)
  const client = new Anthropic({ apiKey })

  // 스킬 설치 (2026-11-28): private 구역에 둔 스킬 글을 Console 스킬로 올리고(처음이면 만들고, 글이 바뀌었으면 새 판) 번호를 표 api_agent_skills 에 적는다
  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action === 'skills') {
    const { data: files, error: fe } = await sb.rpc('api_agent_skill_files')
    if (fe) return json({ error: fe.message }, 500)
    const bySkill = new Map<string, { path: string; content: string }[]>()
    for (const f of (files ?? []) as { skill: string; path: string; content: string }[]) bySkill.set(f.skill, [...(bySkill.get(f.skill) ?? []), { path: f.path, content: f.content }])
    const { data: known } = await sb.from('api_agent_skills').select('name,console_skill_id,content_hash')
    const out: { name: string; ok: boolean; note: string }[] = []
    for (const [name, list] of bySkill) {
      try {
        const hash = await sha(list.map(f => `${f.path}\n${f.content}`).join('\n\u0000'))
        const row = (known ?? []).find(k => k.name === name)
        if (row?.console_skill_id && row.content_hash === hash) { out.push({ name, ok: true, note: '그대로' }); continue }
        const uploads = await Promise.all(list.map(f => toFile(new Blob([f.content], { type: 'text/markdown' }), `${name}/${f.path}`, { type: 'text/markdown' })))
        let id = row?.console_skill_id as string | undefined
        let version = ''
        if (id) version = String((await client.skills.versions.create(id, { files: uploads })).id ?? '')
        else { const made = await client.skills.create({ display_name: `WKLY · ${name}`.slice(0, 255), files: uploads }); id = made.id; version = String(made.latest_version_id ?? '') }
        const bytes = list.reduce((n, f) => n + new TextEncoder().encode(f.content).length, 0)
        const up = await sb.from('api_agent_skills').upsert({ name, console_skill_id: id, console_version: version, content_hash: hash, bytes, files: list.length, installed_at: new Date().toISOString() }, { onConflict: 'name' })
        out.push({ name, ok: !up.error, note: up.error?.message ?? (row?.console_skill_id ? '새 판 올림' : 'Console 에 올림') })
      } catch (e) {
        out.push({ name, ok: false, note: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
      }
    }
    return json({ ok: true, skills: out })
  }

  const { data: all, error } = await sb.from('api_agents').select('id,code,name,model,web_search,console_agent_id,console_env_id')
  if (error) return json({ error: error.message }, 500)
  const envFor = (web: boolean) => (all ?? []).find(a => a.console_env_id && !!a.web_search === web)?.console_env_id as string | undefined
  if (!(all ?? []).some(a => a.console_env_id)) return json({ error: '같이 쓸 실행 환경(console_env_id)이 등록된 에이전트가 없습니다.' }, 409)

  const done: { code: string; ok: boolean; note: string }[] = []
  for (const a of (all ?? []).filter(x => !x.console_agent_id)) {
    const envId = a.console_env_id ?? envFor(!!a.web_search)
    if (!envId) { done.push({ code: a.code, ok: false, note: a.web_search ? '웹 검색이 되는 실행 환경을 가진 에이전트가 없습니다.' : '같이 쓸 실행 환경이 없습니다.' }); continue }
    try {
      // deno-lint-ignore no-explicit-any
      const created = await (client.beta as any).agents.create({
        name: `WKLY 인트라넷 · ${a.name} (${a.code})`.slice(0, 256),
        model: a.model,
        description: '더위클리 · 아트리어 인트라넷 전용 예약 에이전트. 지침과 도구는 인트라넷 표 api_agents 가 기준입니다.',
        metadata: { code: String(a.code), source: 'wkly-intranet' },
        betas: ['managed-agents-2026-04-01'],
      })
      const upd = await sb.from('api_agents').update({ console_agent_id: created.id, console_env_id: envId }).eq('id', a.id)
      done.push({ code: a.code, ok: !upd.error, note: upd.error?.message ?? 'Console 에 등록함' })
    } catch (e) {
      done.push({ code: a.code, ok: false, note: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
    }
  }
  return json({ ok: true, registered: done })
})
