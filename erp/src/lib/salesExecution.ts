export interface SalesContactEvidence {
 version:number;window_days:number;contact_limit:number;contact_total:number;contacts_truncated:boolean;mail_scan_limit:number;mail_truncated:boolean;mail_per_contact_limit:number;scope:string;
 proposal:{title:string;offer:string;customer:string;why_now:string}|null;
 contacts:{key:string;email:string;companies:string[];people:string[];sampled_matches:number;excluded:boolean;ambiguous:boolean;assessment:string;next_action:string;outreach_authorized:false;
  sources:{id:string;name:string;origin:string;url:string;excerpt:string;signature:string}[];
  mail:{id:string;thread_id:string;subject:string;excerpt:string;sent_at:string;synced_at:string;address_match:'from'|'to'}[];
 }[];
}
export interface SalesExecutionPackage {
 id:string;version:number;fingerprint:string;current:boolean;can_approve:boolean;
 status:'준비 중'|'승인 대기'|'승인'|'재검토'|'보류';created_at:string;checked_at:string;blockers:string[];
 payload:{title:string;transport_enabled:boolean;sender:string|null;research:string;contact_evidence?:SalesContactEvidence;contact_evidence_prepared?:boolean;
  messages:{channel:'email';recipient:string;company:string;person:string|null;source_ids:string[];subject:string;body:string}[];
  attachments:{name:string;mime:string;content:string}[];
  schedule:{at:string;expires_at:string;timezone:string;per_recipient_limit:number;followups:string};checks:string[]};
 events:{id:number;kind:string;note:string;created_at:string}[];
 dispatch?:{connected:boolean;note:string;jobs:{id:string;package_id:string;recipient:string;state:'queued'|'claimed'|'accepted'|'rejected'|'unknown'|'cancelled'|'expired';reason:string;scheduled_at:string;finished_at:string|null;created_at:string}[]};
 readiness?:{scope:string;sender:{code:'unverified'|'checking'|'stale'|'ready'|'read_only'|'scope_unknown'|'identity_unverified'|'account_mismatch'|'not_connected'|'provider_error';email:string|null;can_send:boolean;can_read:boolean;checked_at:string|null;valid_until:string|null;transport_connected:boolean};recipients:{source_id:string;company:string;person:string;email:string;origin:string;code:'excluded'|'missing_contact'|'ambiguous_company'|'identity_unverified'|'permission_unverified';next_action:string}[]};
}
export interface SalesExecutionApi {
 getSalesExecution(strategyId:string):Promise<SalesExecutionPackage|null>;
 decideSalesExecution(id:string,version:number,fingerprint:string,decision:'승인'|'보류'):Promise<void>;
 refreshSalesSender?():Promise<void>;
}
