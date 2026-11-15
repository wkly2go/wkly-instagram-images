export interface SalesExecutionPackage {
 id:string;version:number;fingerprint:string;current:boolean;can_approve:boolean;
 status:'준비 중'|'승인 대기'|'승인'|'재검토'|'보류';created_at:string;checked_at:string;blockers:string[];
 payload:{title:string;transport_enabled:boolean;sender:string|null;research:string;
  messages:{channel:'email';recipient:string;company:string;person:string|null;source_ids:string[];subject:string;body:string}[];
  attachments:{name:string;mime:string;content:string}[];
  schedule:{at:string;expires_at:string;timezone:string;per_recipient_limit:number;followups:string};checks:string[]};
 events:{id:number;kind:string;note:string;created_at:string}[];
 dispatch?:{connected:boolean;note:string;jobs:{id:string;package_id:string;recipient:string;state:'queued'|'claimed'|'accepted'|'rejected'|'unknown'|'cancelled'|'expired';reason:string;scheduled_at:string;finished_at:string|null;created_at:string}[]};
}
export interface SalesExecutionApi {
 getSalesExecution(strategyId:string):Promise<SalesExecutionPackage|null>;
 decideSalesExecution(id:string,version:number,fingerprint:string,decision:'승인'|'보류'):Promise<void>;
}
