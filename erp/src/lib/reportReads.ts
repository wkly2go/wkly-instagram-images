import type { Approval, ApprovalSummary, ResearchItem, ResearchSummary } from './types'

export const APPROVAL_LIST_COLUMNS = 'id,kind,title,target_id,amount,requested_by,approver_id,status,decided_by,decided_at,created_at,updated_at,can_decide,report_date:payload->>date,project_id:payload->>project_id,approval_activity(count)'
export const RESEARCH_LIST_COLUMNS = 'id,kind,title,summary,source_url,source_name,brand_name,tags,status,client_id,project_id,collected_by_agent,shared_to,created_by,created_at,updated_at'
export const bodySearchPattern = (word: string) => `%${word.replace(/[\\%_]/g, '\\$&')}%`
export function approvalSummary({ content: _content, payload, decision_comment: _comment, ...row }: Approval): ApprovalSummary {
  return { ...row, report_date: typeof payload?.date === 'string' ? payload.date : null, project_id: typeof payload?.project_id === 'string' ? payload.project_id : null }
}
export function researchSummary({ body: _body, ...row }: ResearchItem): ResearchSummary { return row }
