import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { createGrowthAiHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const sb = url && service ? createClient(url, service, { auth: { persistSession: false } }) : null
Deno.serve(createGrowthAiHandler({
  configured: !!(url && anon && sb),
  apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
  async authenticate(authorization) {
    const client = createClient(url!, anon!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
    const { data: { user }, error } = await client.auth.getUser()
    return error ? null : user
  },
  reserve: async args => await sb!.rpc('growth_ai_reserve', args),
  finish: async args => await sb!.rpc('growth_ai_finish', args),
  fetch,
}))
