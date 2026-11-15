import {sourceUrl,type Page} from './handler.ts'
import {publicIPv4} from './address.ts'
export interface EdgeNetworkDeps {resolve:(hostname:string)=>Promise<string[]>;fetcher:typeof fetch}
/**
 * Page reader for the hosted function runtime, which cannot pin a socket to a chosen address.
 * Every address the name resolves to must be public before the request is made, and redirects are
 * reported, never followed, so a public page cannot point the reader at another host.
 */
export async function readPublicPageEdge(value:string,deps:EdgeNetworkDeps,guard:(value:string)=>URL|null=sourceUrl):Promise<Page>{
 const url=guard(value);if(!url)throw new Error('Unsupported source')
 const signal=AbortSignal.timeout(10000)
 const addresses=await Promise.race([deps.resolve(url.hostname),new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('DNS timeout')),{once:true}))])
 if(signal.aborted||!Array.isArray(addresses)||!addresses.length||addresses.length>32||!addresses.every(publicIPv4))throw new Error('Non-public source')
 let response:Response
 try{response=await deps.fetcher(url.href,{method:'GET',redirect:'manual',credentials:'omit',signal,headers:{'User-Agent':'WKLYSalesBot/1.0','Accept':'text/html,text/plain','Accept-Encoding':'identity'}})}catch{throw new Error('Source unavailable')}
 const type=response.headers.get('content-type')??'',status=response.status
 const stop=async()=>{await response.body?.cancel().catch(()=>undefined)}
 if(Number(response.headers.get('content-length'))>524288){await stop();throw new Error('Unsupported response')}
 // Redirects are reported, never followed. No credentials, cookies or proxy are used.
 if(status!==200){await stop();const location=status>=300&&status<400?(response.headers.get('location')??'').slice(0,1000):'';return {status,contentType:type,text:'',...(location?{location}:{})}}
 const charset=type.match(/charset\s*=\s*"?([^;"\s]+)/i)?.[1]?.toLowerCase()
 if(charset&&!['utf-8','us-ascii'].includes(charset)){await stop();throw new Error('Unsupported charset')}
 const reader=response.body?.getReader();if(!reader)return {status,contentType:type,text:''}
 let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true})
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>524288)throw new Error('limit');text+=decoder.decode(part.value,{stream:true})}text+=decoder.decode()}
 catch{await reader.cancel().catch(()=>undefined);throw new Error('Unsupported body')}
 return {status,contentType:type,text}
}
