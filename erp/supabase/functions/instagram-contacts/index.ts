import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { createInstagramContactsHandler } from './handler.ts'
const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const server=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(createInstagramContactsHandler({
 config:{division:Deno.env.get('WKLY_INSTAGRAM_DIVISION'),pageId:Deno.env.get('WKLY_META_PAGE_ID'),accountId:Deno.env.get('WKLY_INSTAGRAM_ACCOUNT_ID'),token:Deno.env.get('WKLY_META_PAGE_TOKEN'),version:Deno.env.get('WKLY_META_API_VERSION'),ownerId:Deno.env.get('WKLY_INSTAGRAM_CONTACT_OWNER_ID'),cronToken:Deno.env.get('WKLY_INSTAGRAM_SYNC_TOKEN')},fetch,
 async authenticate(authorization){
  const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user},error}=await client.auth.getUser();if(error||!user)return null
  const profile=await client.from('profiles').select('active,role').eq('id',user.id).single();if(profile.error)throw profile.error
  return {id:user.id,active:profile.data.active===true,admin:profile.data.role==='admin'}
 },
 async state(account){const r=await server.from('growth_ig_sync').select('cursor,revision,last_synced_at,last_completed_at').eq('account_id',account).maybeSingle();if(r.error)throw r.error;return r.data??{cursor:null,revision:0}},
 async commit(account,state,cursor,contacts,owner,division){const r=await server.rpc('growth_ig_commit',{p_account:account,p_revision:state.revision,p_cursor:cursor,p_candidates:contacts,p_owner:owner,p_division:division});if(r.error)throw r.error;return r.data},
}))
