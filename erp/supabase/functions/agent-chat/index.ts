// WKLY 총괄(AI 팀원) 실시간 응답
//   DB 트리거가 호출 (x-push-secret 로 확인):
//   - {type:'chat', message_id}: AI 와의 1:1 대화 또는 채팅방에서 '@WKLY 총괄' 언급 → 같은 방에 답장
//   - {type:'instruction', id}: 'AI 팀원에게 지시' 패널 → 바로 처리하고 결과를 지시에 기록
//   Claude 가 ERP 도구(사람 · 할 일 · 프로젝트 · 휴가 · 근태 · 알림)로 바로 처리한다.
//   메일 확인이 필요한 일은 아침 정기 실행(08:24)으로 넘긴다. 금액 · 마진은 다루지 않는다.
//   팀장 AI (2026-10-18 조직 v3): 채팅에서 '@마케팅팀장' '@콘텐츠팀장' '@인테리어팀장' '@리서치팀장' 언급 →
//   그 팀 팀장으로 답하고, 사람 팀장 · 관리자의 지시는 agent_directives(팀원 AI 동적 지침)에 기록한다.
// 필요한 비밀값: ANTHROPIC_API_KEY (Supabase › Edge Functions › Secrets)
import Anthropic from 'npm:@anthropic-ai/sdk@0.134.0'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
// 모델: 채팅 답변은 Sonnet(비용 1/2), '지시' 처리는 Opus (2026-10-18 대표 승인 · API 크레딧 배분)
const MODEL_CHAT = 'claude-sonnet-5-5'
const MODEL_INSTRUCTION = 'claude-opus-5-5'
const MAX_STEPS = 10
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Person { id: string; name: string; title: string | null; role: string; is_agent: boolean; active: boolean; today_status: string }

// ---------------------------------------------------------------------
// 시간 (한국)
// ---------------------------------------------------------------------
const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600_000)
const todayKst = () => kst().toISOString().slice(0, 10)
const nowLabel = () => {
  const d = kst()
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()]
  return `${d.toISOString().slice(0, 10)} (${wd}) ${d.toISOString().slice(11, 16)} KST`
}
/** '2026-10-16T09:00' (한국 시간) → ISO */
const kstToIso = (s: string) => new Date(`${s.length === 16 ? s + ':00' : s}+09:00`).toISOString()
const hhmm = (iso: string | null) => (iso ? kst(new Date(iso)).toISOString().slice(11, 16) : null)

// ---------------------------------------------------------------------
// 도구
// ---------------------------------------------------------------------
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_people',
    description: '팀원 목록 (id · 이름 · 직함 · 오늘 상태). 담당자를 정할 때 먼저 확인.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_tasks',
    description: '할 일 목록. 담당자 · 상태 · 기간 · 검색어로 거름. 기본은 완료 안 된 것.',
    input_schema: {
      type: 'object',
      properties: {
        assignee_id: { type: 'string', description: '담당자 id (없으면 전체)' },
        include_done: { type: 'boolean', description: '완료된 것도 포함' },
        due_from: { type: 'string', description: 'YYYY-MM-DD 이후 마감' },
        due_to: { type: 'string', description: 'YYYY-MM-DD 이전 마감' },
        query: { type: 'string', description: '제목 검색어' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description: '할 일(업무)을 만들어 담당자 일정표에 넣음. 담당자에게 자동 알림.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        assignee_id: { type: 'string', description: '담당자 id (list_people 로 확인)' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        remind_at: { type: 'string', description: '알람 시각, 한국 시간 YYYY-MM-DDTHH:MM' },
        memo: { type: 'string' },
        project_id: { type: 'string' },
      },
      required: ['title', 'assignee_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description: '할 일 고치기 (상태 · 담당자 · 날짜 · 제목 · 메모 · 알람).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string', enum: ['할 일', '진행 중', '완료'] },
        assignee_id: { type: 'string' },
        start_date: { type: 'string' },
        due_date: { type: 'string' },
        remind_at: { type: 'string', description: '한국 시간 YYYY-MM-DDTHH:MM' },
        memo: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_projects',
    description: '프로젝트 목록 (이름 · 상태 · 기간 · 거래처 · 담당). 금액은 없음.',
    input_schema: { type: 'object', properties: { include_done: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'list_leave',
    description: '휴가 기록 (신청 · 승인). 기간으로 거름.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } },
      additionalProperties: false,
    },
  },
  {
    name: 'attendance',
    description: '그날 근태: 출근 시각 · 미출근 · 외부 접속. 날짜 없으면 오늘.',
    input_schema: { type: 'object', properties: { day: { type: 'string', description: 'YYYY-MM-DD' } }, additionalProperties: false },
  },
  {
    name: 'notify_person',
    description: '팀원에게 인트라넷 알림 보내기 (PC · 휴대폰 알림).',
    input_schema: {
      type: 'object',
      properties: { user_id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, link: { type: 'string', description: '앱 경로, 예: /projects?view=mine' } },
      required: ['user_id', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_clients',
    description: '거래처 찾기 (이름 · 분류 · 메모). 연락처는 필요할 때만 사용.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'queue_mail_work',
    description: '메일함 확인이 필요한 일을 아침 정기 실행(매일 07:57)으로 넘김. 지금은 메일함을 볼 수 없을 때 사용.',
    input_schema: { type: 'object', properties: { instruction: { type: 'string' } }, required: ['instruction'], additionalProperties: false },
  },
]

interface Lead { code: string; name: string; group_name: string; owner_id: string | null; mention: string; report_prefix: string }
interface Ctx { agent: Person; requester: Person; people: Person[]; lead?: Lead }

// 팀장 AI 전용 도구 (ctx.lead 가 있을 때만)
const LEAD_TOOLS: Anthropic.Tool[] = [
  {
    name: 'team_status',
    description: '내 팀 현황: 팀원 AI 목록(코드 · 이름 · 일정), 최근 2일 AI 보고(판정 · 요약 · 링크), 활성 팀장 지시.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'add_directive',
    description: '팀원 AI 에게 지시 등록 (다음 실행부터 반영). agent_code 는 팀원 코드 또는 팀 전체 "*". 사람 팀장 · 관리자의 요청만.',
    input_schema: {
      type: 'object',
      properties: {
        agent_code: { type: 'string', description: "팀원 코드 (team_status 로 확인) 또는 '*'" },
        directive: { type: 'string', description: '지시 내용 (2000자 이내)' },
        priority: { type: 'integer', description: '1 높음 … 9 낮음, 기본 5' },
        days: { type: 'integer', description: '유효 기간(일), 기본 7, 최대 60' },
      },
      required: ['agent_code', 'directive'],
      additionalProperties: false,
    },
  },
  {
    name: 'end_directive',
    description: '팀장 지시 종료 (active=false). team_status 의 지시 id 사용.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
]

// 승인 · 발송 · 게시 · 야간 · 결제 · API 키 규칙을 바꾸려는 지시는 막는다 (팀원 AI 쪽에서도 무시함)
const PROTECTED = /(승인\s*없이|결재\s*없이|바로\s*(발송|게시|보내)|자동\s*(좋아요|댓글)|야간.*(발송|게시)|결제|API\s*키|api key|without approval)/i
const canDirect = (ctx: Ctx) => !!ctx.lead && (ctx.requester.role === 'admin' || ctx.requester.id === ctx.lead.owner_id)

const nameOf = (ctx: Ctx, id: string | null) => (id ? ctx.people.find(p => p.id === id)?.name ?? '알 수 없음' : '미정')
const activePerson = (ctx: Ctx, id: string | undefined) => !!id && ctx.people.some(p => p.id === id && p.active && !p.is_agent)
const isDate = (s?: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s)

async function runTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<unknown> {
  const s = (k: string) => (typeof input[k] === 'string' && (input[k] as string).trim() ? (input[k] as string).trim() : undefined)
  switch (name) {
    case 'list_people':
      return ctx.people.filter(p => p.active && !p.is_agent).map(p => ({ id: p.id, name: p.name, title: p.title, admin: p.role === 'admin', today_status: p.today_status }))

    case 'list_tasks': {
      let q = sb.from('tasks').select('id, title, assignee_id, status, start_date, due_date, remind_at, memo, project_id').order('due_date', { ascending: true, nullsFirst: false }).limit(80)
      if (s('assignee_id')) q = q.eq('assignee_id', s('assignee_id')!)
      if (!input.include_done) q = q.neq('status', '완료')
      if (s('due_from')) q = q.gte('due_date', s('due_from')!)
      if (s('due_to')) q = q.lte('due_date', s('due_to')!)
      if (s('query')) q = q.ilike('title', `%${s('query')}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map(t => ({ ...t, assignee: nameOf(ctx, t.assignee_id), remind_at: t.remind_at ? kst(new Date(t.remind_at)).toISOString().slice(0, 16) : null }))
    }

    case 'create_task': {
      if (!s('title')) throw new Error('title 이 필요합니다.')
      if (!activePerson(ctx, s('assignee_id'))) throw new Error('assignee_id 가 팀원 id 가 아닙니다. list_people 로 확인하세요.')
      if (!isDate(s('start_date')) || !isDate(s('due_date'))) throw new Error('날짜는 YYYY-MM-DD 형식입니다.')
      const memo = [s('memo'), `${ctx.requester.name}님 요청 · AI 팀원 등록`].filter(Boolean).join('\n')
      const row = {
        title: s('title')!.slice(0, 200),
        assignee_id: s('assignee_id'),
        start_date: s('start_date') ?? null,
        due_date: s('due_date') ?? s('start_date') ?? null,
        remind_at: s('remind_at') ? kstToIso(s('remind_at')!) : null,
        memo: memo.slice(0, 2000),
        project_id: s('project_id') ?? null,
        status: '할 일',
        created_by: ctx.agent.id,
      }
      const { data, error } = await sb.from('tasks').insert(row).select('id, title, due_date').single()
      if (error) throw error
      // 담당자 알림은 DB 트리거(tasks_notify_assignee)가 보냄
      return { ok: true, task: data, assignee: nameOf(ctx, row.assignee_id!) }
    }

    case 'update_task': {
      const id = s('id')
      if (!id) throw new Error('id 가 필요합니다.')
      const patch: Record<string, unknown> = {}
      for (const k of ['title', 'status', 'start_date', 'due_date', 'memo']) if (s(k) !== undefined) patch[k] = s(k)
      if (s('assignee_id')) {
        if (!activePerson(ctx, s('assignee_id'))) throw new Error('assignee_id 가 팀원 id 가 아닙니다.')
        patch.assignee_id = s('assignee_id')
      }
      if (s('remind_at')) {
        patch.remind_at = kstToIso(s('remind_at')!)
        patch.reminded_at = null
      }
      if (patch.status === '완료') patch.completed_at = new Date().toISOString()
      if (!isDate(patch.start_date as string) || !isDate(patch.due_date as string)) throw new Error('날짜는 YYYY-MM-DD 형식입니다.')
      if (!Object.keys(patch).length) throw new Error('바꿀 내용이 없습니다.')
      const { data, error } = await sb.from('tasks').update(patch).eq('id', id).select('id, title, status, assignee_id, due_date').maybeSingle()
      if (error) throw error
      if (!data) throw new Error('그 할 일을 찾지 못했습니다.')
      return { ok: true, task: { ...data, assignee: nameOf(ctx, data.assignee_id) } }
    }

    case 'list_projects': {
      let q = sb.from('projects').select('id, name, status, category, start_date, end_date, location, owner_id, clients(name)').order('start_date', { ascending: false, nullsFirst: false }).limit(60)
      if (!input.include_done) q = q.neq('status', '완료')
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map((p: Record<string, unknown>) => ({ ...p, owner: nameOf(ctx, p.owner_id as string | null), client: (p.clients as { name?: string } | null)?.name ?? null, clients: undefined }))
    }

    case 'list_leave': {
      const from = s('from') ?? todayKst()
      let q = sb.from('leave_records').select('profile_id, kind, start_date, end_date, days, status').gte('end_date', from).neq('status', '반려').order('start_date')
      if (s('to')) q = q.lte('start_date', s('to')!)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map(l => ({ ...l, name: nameOf(ctx, l.profile_id) }))
    }

    case 'attendance': {
      const day = s('day') ?? todayKst()
      const [{ data: att }, { data: acc }] = await Promise.all([
        sb.from('attendance').select('user_id, first_at, last_at').eq('day', day),
        sb.from('access_log').select('user_id, source, first_at').eq('day', day),
      ])
      return ctx.people
        .filter(p => p.active && !p.is_agent)
        .map(p => {
          const a = (att ?? []).find(x => x.user_id === p.id)
          return {
            name: p.name,
            status: a ? p.today_status : '미출근',
            출근: hhmm(a?.first_at ?? null),
            외부접속: (acc ?? []).filter(x => x.user_id === p.id && x.source !== 'desktop').map(x => `${x.source === 'mobile' ? '휴대폰' : '브라우저'} ${hhmm(x.first_at)}`),
          }
        })
    }

    case 'notify_person': {
      if (!activePerson(ctx, s('user_id'))) throw new Error('user_id 가 팀원 id 가 아닙니다.')
      const link = s('link')?.startsWith('/') ? s('link')! : '/'
      await notify(s('user_id')!, s('title')!.slice(0, 200), (s('body') ?? '').slice(0, 1000), link)
      return { ok: true }
    }

    case 'search_clients': {
      const qs = s('query')!.replace(/[%,()]/g, ' ')
      const { data, error } = await sb.from('clients').select('id, name, category, memo, phone, email').or(`name.ilike.%${qs}%,memo.ilike.%${qs}%`).limit(15)
      if (error) throw error
      return data
    }

    case 'team_status': {
      const lead = ctx.lead
      if (!lead) throw new Error('팀장 대화에서만 씁니다.')
      const since = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10)
      const [{ data: members }, { data: reports }, { data: dirs }] = await Promise.all([
        sb.from('agent_roster').select('code, name, schedule, active').eq('group_name', lead.group_name).eq('is_lead', false).order('sort'),
        sb.from('agent_reports').select('job_name, report_date, verdict, title, summary, link').ilike('job_name', `${lead.report_prefix}%`).gte('report_date', since).order('run_at', { ascending: false }).limit(40),
        sb.from('agent_directives').select('id, agent_code, directive, priority, expires_at, set_by, reason').eq('team', lead.group_name).eq('active', true).order('priority'),
      ])
      return { team: lead.group_name, members, reports, directives: dirs }
    }

    case 'add_directive': {
      const lead = ctx.lead
      if (!lead) throw new Error('팀장 대화에서만 씁니다.')
      if (!canDirect(ctx)) throw new Error(`지시 등록은 사람 팀장(${nameOf(ctx, lead.owner_id)})이나 관리자만 할 수 있습니다. 내용은 팀장에게 전달해 주세요.`)
      const code = s('agent_code')
      const text = s('directive')
      if (!code || !text) throw new Error('agent_code · directive 가 필요합니다.')
      if (code !== '*') {
        const { data: m } = await sb.from('agent_roster').select('code').eq('group_name', lead.group_name).eq('code', code).maybeSingle()
        if (!m) throw new Error(`${code} 는 이 팀 팀원 코드가 아닙니다. team_status 로 확인하세요.`)
      }
      if (PROTECTED.test(text)) throw new Error('승인 · 발송 · 게시 · 야간 · 결제 · API 키 규칙을 바꾸는 지시는 등록할 수 없습니다.')
      const days = Math.min(Math.max(Number(input.days ?? 7) || 7, 1), 60)
      const priority = Math.min(Math.max(Number(input.priority ?? 5) || 5, 1), 9)
      const { data, error } = await sb
        .from('agent_directives')
        .insert({ agent_code: code, team: lead.group_name, directive: text.slice(0, 2000), priority, expires_at: new Date(Date.now() + days * 86400_000).toISOString(), set_by: lead.code, reason: `${ctx.requester.name}님 채팅 지시` })
        .select('id, agent_code, expires_at')
        .single()
      if (error) throw error
      return { ok: true, directive: data, note: '팀원 AI 의 다음 실행부터 반영됩니다.' }
    }

    case 'end_directive': {
      const lead = ctx.lead
      if (!lead) throw new Error('팀장 대화에서만 씁니다.')
      if (!canDirect(ctx)) throw new Error('지시 종료는 사람 팀장이나 관리자만 할 수 있습니다.')
      const { data, error } = await sb.from('agent_directives').update({ active: false, updated_at: new Date().toISOString() }).eq('id', s('id')!).eq('team', lead.group_name).select('id').maybeSingle()
      if (error) throw error
      if (!data) throw new Error('이 팀의 그 지시를 찾지 못했습니다.')
      return { ok: true }
    }

    case 'queue_mail_work': {
      const { error } = await sb.from('agent_instructions').insert({ agent_id: ctx.agent.id, instruction: `[메일 확인 필요] ${s('instruction')}`.slice(0, 2000), created_by: ctx.requester.id })
      if (error) throw error
      return { ok: true, note: '매일 07:57 정기 실행에서 메일을 보고 처리합니다.' }
    }
  }
  throw new Error(`알 수 없는 도구: ${name}`)
}

async function notify(userId: string, title: string, body: string, link: string) {
  await sb.from('notifications').insert({ user_id: userId, kind: '할 일', title, body: body || null, link })
}

// ---------------------------------------------------------------------
// Claude 호출 (도구 반복)
// ---------------------------------------------------------------------
/** 고정 부분(캐시 대상): 역할 · 일하는 방식 · 규칙. 시각 · 요청자 · 위치는 contextPrompt 로 따로 넣는다 */
function systemPrompt(ctx: Ctx) {
  return ctx.lead ? basePrompt(ctx) + leadPrompt(ctx.lead) : basePrompt(ctx)
}

function leadPrompt(lead: Lead) {
  return `

이번 대화에서 너는 '${lead.name}'(코드 ${lead.code}, 팀 '${lead.group_name}')이다. 사람 팀원은 개별 AI 대신 너와 업무를 협의한다.
- 팀 현황 질문은 team_status 로 확인해 팀원별 한 줄로 답한다.
- 사람 팀장 · 관리자가 팀원 AI 에게 시킬 일을 말하면 add_directive 로 등록하고, 대상 · 유효 기간 · 언제 반영되는지(팀원 AI 다음 실행) 알린다. 다른 사람의 요청은 등록하지 말고 팀장에게 전달하라고 답한다.
- 지시로 승인 · 발송 · 게시 · 야간 · 결제 · 개인정보 · 금액 · API 키 규칙은 바꿀 수 없다.
- 팀원 AI 의 예약 작업 지침(프롬프트) 자체는 여기서 고치지 않는다. 필요하면 평일 10:07 팀장 정기 실행이 처리한다고 안내한다.
- 대표 보고는 총괄이 18:00 에 한 번 한다. 팀 종합은 평일 17:07.`
}

function basePrompt(ctx: Ctx) {
  return `너는 더위클리(THE WKLY, 팝업 매거진 · 공간 디자인 회사)의 AI 팀원 '${ctx.agent.name}'이다. 회사 인트라넷(ERP) 안에서 팀원 요청을 바로 처리한다.

일하는 방식
- 요청은 바로 도구로 처리하고, 끝나면 무엇을 했는지 짧게 알린다. 되묻기보다 합리적으로 정해서 처리하고, 정한 내용을 답에 밝힌다. 정말 정할 수 없을 때만 한 가지를 묻는다.
- 담당자 · 날짜가 필요하면 list_people · list_tasks 로 확인한다. '내일' '다음 주 화요일' 같은 날짜는 위 현재 시각 기준으로 계산한다.
- 이미 같은 할 일이 있으면 새로 만들지 않고 알려 준다.
- 메일함 · 구글 드라이브 확인이 필요한 일은 지금 볼 수 없으니 queue_mail_work 로 아침 정기 실행에 넘기고 그렇게 말한다.
- 할 수 없는 일(메일 발송 · 결제 · 외부 사이트 로그인 · 금액 확인)은 할 수 없다고 짧게 말한다.

규칙
- 이메일은 절대 보내지 않는다.
- 금액 · 단가 · 마진율은 답이나 할 일에 쓰지 않는다 (채팅은 여러 사람이 볼 수 있음).
- 개인정보(연락처 등)는 요청한 일에 꼭 필요할 때만 쓴다.
- 답은 한국어, 존댓말, 짧고 건조하게. 목록은 '· ' 로 시작하는 줄. 마크다운 표 · 제목은 쓰지 않는다.`
}

/** 호출마다 바뀌는 부분(캐시 제외) */
function contextPrompt(ctx: Ctx, where: string) {
  return `지금: ${nowLabel()}. 요청한 사람: ${ctx.requester.name}${ctx.requester.title ? ` (${ctx.requester.title})` : ''}${ctx.requester.role === 'admin' ? ', 관리자' : ''}. 대화 위치: ${where}.`
}

async function ask(ctx: Ctx, where: string, messages: Anthropic.MessageParam[], model: string = MODEL_CHAT): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return 'AI 연결 키 미설정 — 접수했습니다. 실시간 답변이 아직 연결되지 않아 다음 정기 실행(매일 07:57 메일 확인 · 평일 17:54 일일 보고)에서 처리합니다.'
  const client = new Anthropic({ apiKey })
  // 프롬프트 캐시: 시스템 프롬프트(고정 규칙) · 도구 정의는 호출마다 같으므로 캐시 → 입력비 10%
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt(ctx), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextPrompt(ctx, where) },
  ]
  const all = ctx.lead ? [...TOOLS, ...LEAD_TOOLS] : TOOLS
  const tools = all.map((t, i) => (i === all.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t))
  let useFallback = true
  for (let step = 0; step < MAX_STEPS; step++) {
    let res: Anthropic.Message
    const params = { model, max_tokens: 16000, system, tools, messages, output_config: { effort: 'medium' } }
    try {
      res = useFallback
        ? // 안전 분류로 거절되면 서버가 다른 모델로 이어서 답함
          ((await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never)) as unknown as Anthropic.Message)
        : await client.messages.create(params as never)
    } catch (e) {
      if (useFallback && e instanceof Anthropic.BadRequestError) {
        useFallback = false
        step--
        continue
      }
      throw e
    }
    if (res.stop_reason === 'refusal') return '이 요청은 처리할 수 없습니다. 다르게 표현해 주시면 다시 해 보겠습니다.'
    messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason === 'pause_turn') continue
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim() || '처리했습니다.'
    }
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const u of uses) {
      try {
        const out = await runTool(ctx, u.name, (u.input ?? {}) as Record<string, unknown>)
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 30000) })
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `오류: ${(e as Error).message ?? e}`, is_error: true })
      }
    }
    messages.push({ role: 'user', content: results })
  }
  return '요청이 길어 중간까지만 처리했습니다. 이어서 할 내용을 다시 말씀해 주세요.'
}

// ---------------------------------------------------------------------
// 채팅 · 지시 처리
// ---------------------------------------------------------------------
async function loadPeople(): Promise<Person[]> {
  const { data, error } = await sb.from('profiles').select('id, name, title, role, is_agent, active, today_status')
  if (error) throw error
  return data as Person[]
}

async function loadLeads(): Promise<Lead[]> {
  const { data, error } = await sb.from('agent_roster').select('code, name, group_name, owner_id, home').eq('is_lead', true).eq('active', true).like('code', 'LEAD-%')
  if (error) throw error
  return (data ?? [])
    .map(r => {
      const home = (r.home ?? {}) as Record<string, string>
      return { code: r.code, name: r.name, group_name: r.group_name, owner_id: r.owner_id, mention: home.mention ?? '', report_prefix: home.report_prefix ?? r.group_name }
    })
    .filter(l => l.mention)
}

async function handleChat(messageId: number) {
  const { data: msg } = await sb.from('chat_messages').select('id, room_id, user_id, content, created_at').eq('id', messageId).maybeSingle()
  if (!msg) return
  const [{ data: room }, people] = await Promise.all([sb.from('chat_rooms').select('id, name, members').eq('id', msg.room_id).maybeSingle(), loadPeople()])
  if (!room) return
  const requester = people.find(p => p.id === msg.user_id)
  if (!requester || requester.is_agent || !requester.active) return
  const agents = people.filter(p => p.is_agent && p.active)
  const members = (room.members as string[] | null) ?? null
  // '@마케팅팀장' · '@마케팅 팀장' 모두 인식 (띄어쓰기 무시)
  const compact = msg.content.replace(/\s+/g, '')
  const lead = (await loadLeads()).find(l => compact.includes(`@${l.mention}`))
  // 팀장 AI 는 별도 계정이 없어 AI 팀원 계정(WKLY 총괄)이 '[팀장 이름]' 머리말로 답한다
  const agent = (members && agents.find(a => members.includes(a.id))) || agents.find(a => msg.content.includes(`@${a.name}`)) || (lead ? agents[0] : undefined)
  if (!agent) return
  const ctx: Ctx = { agent, requester, people, lead }

  // 최근 대화 (오래된 것부터, 최대 20개)
  const { data: recent } = await sb.from('chat_messages').select('user_id, content, created_at').eq('room_id', room.id).lte('id', msg.id).order('id', { ascending: false }).limit(20)
  const history = (recent ?? []).reverse()
  const lines = history.map(m => `[${hhmm(m.created_at)}] ${nameOf(ctx, m.user_id)}: ${m.content}`).join('\n')
  const where = members ? `${requester.name}님과의 1:1 대화` : `채팅방 # ${room.name} (여러 사람이 봄)`
  const prompt = `최근 대화:\n${lines}\n\n위 대화의 마지막 메시지(${requester.name})에 답하고, 요청이 있으면 처리해.`
  const reply = await ask(ctx, where, [{ role: 'user', content: prompt }])
  const content = lead ? `[${lead.name}] ${reply}` : reply
  await sb.from('chat_messages').insert({ room_id: room.id, user_id: agent.id, content: content.slice(0, 4000) })
}

async function handleInstruction(id: string) {
  const { data: ins } = await sb.from('agent_instructions').select('id, agent_id, instruction, status, created_by').eq('id', id).maybeSingle()
  if (!ins || ins.status !== '대기' || ins.instruction.startsWith('[메일')) return
  const people = await loadPeople()
  const agent = people.find(p => p.id === ins.agent_id && p.active)
  const requester = people.find(p => p.id === ins.created_by)
  if (!agent || !requester) return
  await sb.from('agent_instructions').update({ status: '진행 중' }).eq('id', id)
  const ctx: Ctx = { agent, requester, people }
  let reply: string
  let status = '완료'
  try {
    reply = await ask(ctx, "인트라넷 'AI 팀원에게 지시' 패널 (팀원 모두가 봄)", [{ role: 'user', content: `${requester.name}님의 지시: ${ins.instruction}` }], MODEL_INSTRUCTION)
    if (reply.startsWith('AI 연결 키')) status = '대기'
  } catch (e) {
    reply = `처리 중 오류가 났습니다: ${(e as Error).message ?? e}`.slice(0, 500)
    status = '보류'
  }
  // 메일 확인으로 넘긴 경우는 '진행 중'으로 남김
  const { data: queued } = await sb.from('agent_instructions').select('id').eq('created_by', requester.id).like('instruction', '[메일 확인 필요]%').gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString()).limit(1)
  if (status === '완료' && queued?.length) status = '진행 중'
  await sb.from('agent_instructions').update({ status, response: reply.slice(0, 4000), responded_at: status === '대기' ? null : new Date().toISOString() }).eq('id', id)
  if (status === '완료' || status === '보류') await notify(requester.id, `AI 지시 ${status} · ${ins.instruction.slice(0, 40)}`, reply.slice(0, 300), '/')
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const { data: cfg } = await sb.rpc('push_config_get')
  if (!cfg || req.headers.get('x-push-secret') !== (cfg as { hook_secret: string }).hook_secret) return json({ error: 'forbidden' }, 403)
  let body: { type?: string; message_id?: number; id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  const job =
    body.type === 'chat' && body.message_id ? handleChat(Number(body.message_id)) : body.type === 'instruction' && body.id ? handleInstruction(body.id) : null
  if (!job) return json({ error: 'type' }, 400)
  // 바로 응답하고 뒤에서 처리 (DB 트리거가 기다리지 않게)
  const safe = job.catch(e => console.error('agent-chat', e))
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(safe)
  else await safe
  return json({ accepted: true }, 202)
})
