import { parseStrategyPlan, strategyPrompt, preparationPrompt, parseStrategyPreparation, type StrategyPreparation, type StrategySource, type StrategyPlan } from '../../../src/lib/salesStrategy.ts'
export interface PlanningJob {id: string; phase?: 'plan' | 'prepare'; plan?: StrategyPlan; model: 'fast' | 'standard' | 'deep'; actor: string; today: string; sources: StrategySource[]; recent: {title: string; category: string}[]; feedback: string}
export interface PlannerDependencies {
  claim: (id: string, token: string) => Promise<PlanningJob | null>;
  generate: (job: PlanningJob, prompt: string) => Promise<{status?: string; text?: string; error?: string}>;
  finish: (id: string, plan: StrategyPlan | StrategyPreparation | null, error: string, phase?: 'plan' | 'prepare') => Promise<void>;
  background?: (work: Promise<void>) => void;
}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
export function createSalesPlanner(deps: PlannerDependencies) {
  return async(req: Request): Promise<Response> => {
    if(req.method!=='POST')return json({error:'POST required'},405)
    let job: PlanningJob | null
    try {
      const text=await req.text();if(text.length>2048)return json({error:'Request too large'},413)
      const body=JSON.parse(text),uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
      if(!body||typeof body.id!=='string'||typeof body.token!=='string'||!uuid.test(body.id)||!uuid.test(body.token))return json({error:'Invalid job'},400)
      job=await deps.claim(body.id,body.token)
      if(!job)return json({error:'Job not available'},403)
    } catch {return json({error:'Job authentication unavailable'},503)}
    const work=async()=>{
      try {
        const preparing=job!.phase==='prepare'
        const result=await deps.generate(job!,preparing?preparationPrompt(job!.plan!,job!.sources):strategyPrompt(job!))
        if(result.error)throw new Error(result.error)
        if(result.status!=='completed'||typeof result.text!=='string')throw new Error('AI 결과가 확정되지 않았습니다. 사용 기록을 확인해 주세요.')
        const plan=preparing?parseStrategyPreparation(result.text):parseStrategyPlan(result.text,job!.sources)
        await deps.finish(job!.id,plan,'',job!.phase)
      } catch(e) {
        const error=e instanceof Error?e.message:'AI 기획에 실패했습니다.'
        try{await deps.finish(job!.id,null,error.slice(0,500),job!.phase)}catch{/* The server watchdog marks unresolved jobs; never repeat a paid call. */}
      }
    }
    if(deps.background){deps.background(work());return json({accepted:true},202)}
    await work();return json({accepted:true})
  }
}
