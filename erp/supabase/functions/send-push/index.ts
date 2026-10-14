// WKLY ERP 웹 푸시 발송
//   - POST {action:'public-key'}            : 브라우저 구독용 VAPID 공개키 (처음 호출 때 키 생성 · DB 비공개 보관)
//   - POST {type:'chat'|'notify', ...}      : DB 트리거가 호출 (x-push-secret 헤더로 확인) → 대상자 구독에 알림 발송
// 키와 비밀값은 private.push_config 에만 있고, service_role 전용 RPC 로만 읽는다.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

interface Config { hook_secret: string; vapid_public: string | null; vapid_private: string | null; vapid_subject: string | null }

async function config(): Promise<Config> {
  const { data, error } = await sb.rpc('push_config_get')
  if (error) throw error
  let c = data as Config
  if (!c.vapid_public || !c.vapid_private) {
    const k = webpush.generateVAPIDKeys()
    const { data: saved, error: e2 } = await sb.rpc('push_config_set_vapid', { p_public: k.publicKey, p_private: k.privateKey })
    if (e2) throw e2
    c = saved as Config
  }
  return c
}

interface Sub { endpoint: string; user_id: string; p256dh: string; auth: string }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  try {
    const c = await config()
    if (body.action === 'public-key') return json({ publicKey: c.vapid_public })

    if (req.headers.get('x-push-secret') !== c.hook_secret) return json({ error: 'forbidden' }, 403)
    webpush.setVapidDetails(c.vapid_subject || 'mailto:info@thewklyn.com', c.vapid_public!, c.vapid_private!)

    // 받을 사람과 알림 내용
    let userIds: string[] = []
    let payload: Record<string, unknown>
    if (body.type === 'chat') {
      const { data: people } = await sb.from('profiles').select('id').eq('active', true).eq('is_agent', false).neq('id', body.user_id as string)
      userIds = (people ?? []).map(p => p.id as string)
      const [{ data: sender }, { data: room }] = await Promise.all([
        sb.from('profiles').select('name').eq('id', body.user_id as string).maybeSingle(),
        sb.from('chat_rooms').select('name').eq('id', body.room_id as string).maybeSingle(),
      ])
      payload = {
        kind: 'chat',
        room: body.room_id,
        title: `${sender?.name ?? '팀원'} · # ${room?.name ?? '채팅'}`,
        body: String(body.content ?? '').slice(0, 180),
        url: `/chat?room=${body.room_id}`,
        tag: `chat-${body.room_id}`,
      }
    } else if (body.type === 'notify') {
      userIds = [body.user_id as string]
      payload = { kind: 'notify', title: String(body.title ?? '알림'), body: body.body ? String(body.body).slice(0, 180) : '', url: (body.link as string) || '/', tag: `notify-${body.id}` }
    } else return json({ error: 'type' }, 400)
    if (!userIds.length) return json({ sent: 0 })

    const { data: subs } = await sb.from('push_subscriptions').select('endpoint, user_id, p256dh, auth').in('user_id', userIds)
    let sent = 0
    const gone: string[] = []
    const errors: string[] = []
    await Promise.all(
      ((subs ?? []) as Sub[]).map(async s => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: 'high' })
          sent++
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode
          if (code === 404 || code === 410) gone.push(s.endpoint) // 브라우저에서 구독이 사라짐
          else if (errors.length < 3) errors.push(`${code ?? ''} ${(e as Error).message ?? e}`.trim())
        }
      }),
    )
    if (gone.length) await sb.from('push_subscriptions').delete().in('endpoint', gone)
    return json({ sent, removed: gone.length, errors })
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
