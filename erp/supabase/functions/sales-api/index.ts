import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { createSalesLookupHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')
const anon = Deno.env.get('SUPABASE_ANON_KEY')

Deno.serve(createSalesLookupHandler({
  configured: Boolean(url && anon),
  secret: name => Deno.env.get(name),
  fetch,
  async authenticate(authorization) {
    const client = createClient(url!, anon!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return null
    const profile = await client.from('profiles').select('active').eq('id', user.id).maybeSingle()
    if (profile.error) throw new Error('Profile unavailable')
    return { id: user.id, active: profile.data?.active === true }
  },
}))
