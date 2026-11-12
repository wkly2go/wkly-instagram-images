import { MAX_OUTPUT, SYSTEM, validateRequest } from './policy.ts'

type Reservation = { execute: boolean; status?: string; text?: string; cost?: number; model_id?: string; input_rate?: number; output_rate?: number }
type RpcError = { message: string } | null
export interface GrowthAiDependencies {
  configured: boolean
  apiKey?: string
  authenticate: (authorization: string) => Promise<{ id: string } | null>
  reserve: (args: Record<string, unknown>) => Promise<{ data: Reservation | null; error: RpcError }>
  finish: (args: Record<string, unknown>) => Promise<{ error: RpcError }>
  fetch: typeof fetch
}
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

export function createGrowthAiHandler(deps: GrowthAiDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers })
    if (req.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405)
    if (!deps.configured) return json({ error: '서버 연결 설정이 아직 준비되지 않았습니다.' }, 503)
    const authorization = req.headers.get('Authorization') ?? ''
    if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: '로그인이 필요합니다.' }, 401)
    let user: { id: string } | null
    try { user = await deps.authenticate(authorization) }
    catch { return json({ error: '로그인 확인 서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.' }, 503) }
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
    let reserved = false, requestId = ''
    try {
      const raw = await req.text()
      if (raw.length > 30000) return json({ error: '요청이 너무 큽니다.' }, 400)
      const body = JSON.parse(raw)
      validateRequest(body)
      requestId = body.id
      if (!deps.apiKey) return json({ error: '서버 API 연결이 아직 설정되지 않았습니다.' }, 503)
      const inputTokens = new TextEncoder().encode(SYSTEM + body.prompt).byteLength + 1024
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([body.task, body.model, body.prompt])))
      const signature = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
      const { data: reservation, error } = await deps.reserve({ p_id: body.id, p_user: user.id, p_task: body.task, p_signature: signature, p_model: body.model, p_input_tokens: inputTokens })
      if (error) return json({ error: error.message }, 400)
      if (!reservation) return json({ error: '요청 상태를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.' }, 503)
      if (!reservation.execute) return json({ status: reservation.status, text: reservation.text ?? '', cost: reservation.cost })
      reserved = true
      const inputRate = Number(reservation.input_rate), outputRate = Number(reservation.output_rate)
      if (!reservation.model_id || !Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) throw new Error('invalid reservation')
      const response = await deps.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': deps.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: reservation.model_id, max_tokens: MAX_OUTPUT, system: SYSTEM, messages: [{ role: 'user', content: body.prompt }] }),
        signal: AbortSignal.timeout(55000),
      })
      if (!response.ok) throw new Error('provider request failed')
      const result = await response.json()
      if (!Number.isSafeInteger(result.usage?.input_tokens) || result.usage.input_tokens < 0 || !Number.isSafeInteger(result.usage?.output_tokens) || result.usage.output_tokens < 0 || !Array.isArray(result.content)) throw new Error('invalid usage')
      const output = result.content.filter((x: { type?: string; text?: unknown }) => x.type === 'text' && typeof x.text === 'string').map((x: { text: string }) => x.text).join('\n').slice(0, 30000)
      const cost = (result.usage.input_tokens * inputRate + result.usage.output_tokens * outputRate) / 1e6
      const settled = await deps.finish({ p_id: body.id, p_actual: cost, p_output: output, p_uncertain: false })
      if (settled.error) throw new Error('settlement failed')
      return json({ text: output, cost, status: 'completed' })
    } catch {
      if (reserved) {
        try { await deps.finish({ p_id: requestId, p_actual: null, p_output: null, p_uncertain: true }) } catch { /* 예약 금액과 요청 ID를 유지한다. */ }
      }
      return json({ error: reserved ? '실행 결과가 불확실합니다. 중복 호출을 막고 예약 비용을 유지했습니다. 관리자에게 Console 사용량 확인을 요청해 주세요.' : '요청 내용을 확인해 주세요.' }, 400)
    }
  }
}
