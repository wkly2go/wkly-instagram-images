import {request} from 'node:https'
import {resolve4} from 'node:dns/promises'
import {sourceUrl,type Page} from './handler.ts'
export {publicIPv4} from './address.ts'
import {publicIPv4} from './address.ts'
export interface NetworkDeps {resolve:(hostname:string)=>Promise<string[]>;request:typeof request}
/** Pins the validated public IP at the actual socket lookup; never re-resolves via fetch. */
export async function readPublicPage(value:string,deps:NetworkDeps={resolve:resolve4,request},guard:(value:string)=>URL|null=sourceUrl):Promise<Page>{
 const url=guard(value);if(!url)throw new Error('Unsupported source')
 const signal=AbortSignal.timeout(10000)
 const addresses=await new Promise<string[]>((resolve,reject)=>{const abort=()=>reject(new Error('DNS timeout'));signal.addEventListener('abort',abort,{once:true});deps.resolve(url.hostname).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))})
 if(signal.aborted||!addresses.length||addresses.length>32||!addresses.every(publicIPv4))throw new Error('Non-public source')
 const pinned=addresses[0]
 return new Promise((resolve,reject)=>{
  const req=deps.request(url,{method:'GET',agent:false,servername:url.hostname,rejectUnauthorized:true,family:4,signal,maxHeaderSize:16384,
   lookup:(_hostname,options,callback)=>{if(options.all)callback(null,[{address:pinned,family:4}]);else callback(null,pinned,4)},
   headers:{'User-Agent':'WKLYSalesBot/1.0','Accept':'text/html,text/plain','Accept-Encoding':'identity'}},res=>{
   const type=String(res.headers['content-type']??''),encoding=res.headers['content-encoding'],status=res.statusCode??0
   if(encoding&&encoding!=='identity'||Number(res.headers['content-length'])>524288){res.destroy();reject(new Error('Unsupported response'));return}
   // Redirects are reported, never followed. No credentials, cookies or proxy are used.
   if(status!==200){res.destroy();resolve({status,contentType:type,text:''});return}
   const charset=type.match(/charset\s*=\s*"?([^;"\s]+)/i)?.[1]?.toLowerCase()
   if(charset&&!['utf-8','us-ascii'].includes(charset)){res.destroy();reject(new Error('Unsupported charset'));return}
   let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true})
   res.on('data',(chunk:Uint8Array)=>{try{size+=chunk.byteLength;if(size>524288)throw new Error('Response limit');text+=decoder.decode(chunk,{stream:true})}catch{res.destroy();reject(new Error('Unsupported body'))}})
   res.on('end',()=>{try{resolve({status,contentType:type,text:text+decoder.decode()})}catch{reject(new Error('Unsupported body'))}})
   res.on('error',()=>reject(new Error('Source unavailable')));res.on('aborted',()=>reject(new Error('Source interrupted')))
  })
  req.on('error',()=>reject(new Error('Source unavailable')));req.end()
 })
}
