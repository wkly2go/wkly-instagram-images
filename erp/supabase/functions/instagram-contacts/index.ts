import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { createInstagramContactsHandler } from './handler.ts'
// 2026-11-18: 'Instagram 로그인이 포함된 API' 연결(금고 INSTAGRAM_ACCESS_TOKEN · 영업 › Instagram DM 연결)을 그대로 씀.
//  담당자 = app_settings 'instagram_contact_owner'(profiles id) → 없으면 서버 값 → 없으면 첫 관리자. 회사 = 기본 더위클리(TW)
const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const server=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const setting=async(k:string)=>{const r=await server.from('app_settings').select('value').eq('key',k).maybeSingle();const v=r.data?.value;return typeof v==='string'?v:v&&typeof v==='object'&&'id' in v?String((v as {id:unknown}).id):undefined}
Deno.serve(createInstagramContactsHandler({
 config:{division:Deno.env.get('WKLY_INSTAGRAM_DIVISION')??'TW',accountId:Deno.env.get('WKLY_INSTAGRAM_ACCOUNT_ID')||undefined,version:Deno.env.get('WKLY_META_API_VERSION')??'v21.0',ownerId:Deno.env.get('WKLY_INSTAGRAM_CONTACT_OWNER_ID')||undefined,cronToken:Deno.env.get('WKLY_INSTAGRAM_SYNC_TOKEN')},fetch,
 async loadConfig(){
  const t=await server.rpc('instagram_secret_get',{p_name:'INSTAGRAM_ACCESS_TOKEN'})
  const token=typeof t.data==='string'&&t.data?t.data:undefined
  let ownerId=await setting('instagram_contact_owner')
  if(!ownerId&&!Deno.env.get('WKLY_INSTAGRAM_CONTACT_OWNER_ID')){const a=await server.from('profiles').select('id').eq('role','admin').eq('active',true).eq('is_agent',false).order('created_at').limit(1).maybeSingle();ownerId=a.data?.id}
  return {token,...(ownerId?{ownerId}:{})}
 },
 async authenticate(authorization){
  const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user},error}=await client.auth.getUser();if(error||!user)return null
  const profile=await client.from('profiles').select('active,role').eq('id',user.id).single();if(profile.error)throw profile.error
  return {id:user.id,active:profile.data.active===true,admin:profile.data.role==='admin'}
 },
 async state(account){let q=server.from('growth_ig_sync').select('cursor,revision,last_synced_at,last_completed_at');q=account?q.eq('account_id',account):q.order('last_synced_at',{ascending:false,nullsFirst:false}).limit(1);const r=await q.maybeSingle();if(r.error)throw r.error;return r.data??{cursor:null,revision:0}},
 async commit(account,state,cursor,contacts,owner,division){const r=await server.rpc('growth_ig_commit',{p_account:account,p_revision:state.revision,p_cursor:cursor,p_candidates:contacts,p_owner:owner,p_division:division});if(r.error)throw r.error;return r.data},
}))
