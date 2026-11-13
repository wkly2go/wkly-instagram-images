import { newSalesDraft, validateSales, type SalesDraft } from './sales.ts'

export const PROSPECT_PLAYS = [
  { id: 'launch', label: '팝업·신제품', signal: '팝업 오픈 신제품 출시', target: '브랜드 마케팅·PR 담당자, 팝업 운영사', offer: '팝업 소개·현장 취재·콘텐츠 제작·광고 준비', question: '오픈 전 인지도와 현장 방문 중 어떤 성과가 우선인가요?', evidence: '공식 오픈 공지, 기간·장소, 기존 홍보 채널', lead: 42, division: 'TW' },
  { id: 'exhibition', label: '전시·박람회 참가사', signal: '전시 박람회 참가기업 참가사', target: '참가 브랜드, 전시 주최사, 부스 운영 담당자', offer: '참가사 인터뷰·부스 콘텐츠·전후 홍보 패키지', question: '이번 전시에서 만나려는 고객과 확보하려는 문의는 무엇인가요?', evidence: '주최사 일정, 참가기업 목록, 부스·홍보 담당 부서', lead: 60, division: 'TW' },
  { id: 'space', label: '신규 매장·리뉴얼', signal: '플래그십 신규 매장 리뉴얼 오픈', target: '브랜드 공간·VMD·점포 개발 담당자, 건물 운영사', offer: '공간 기획·설계·시공과 오픈 콘텐츠 연계', question: '오픈 목표일과 공간 변경 범위, 의사결정 일정은 어떻게 되나요?', evidence: '공식 출점 계획, 공사·발주 일정, 현장 조건', lead: 90, division: 'AR' },
  { id: 'office', label: '오피스 이전·리뉴얼', signal: '사무실 이전 신사옥 오피스 리뉴얼 인테리어', target: '기업 총무·구매·시설 담당자, 건물 자산 운영사', offer: '업무 공간 진단·레이아웃 설계·단계별 시공', question: '입주일·면적·현재 임대차 일정과 근무 중 공사 가능 범위는 어떻게 되나요?', evidence: '공식 이전 계획, 현장 도면·설비 조건, 발주 담당과 예산 승인 일정', lead: 120, division: 'AR' },
  { id: 'retail', label: '매장·쇼룸 인테리어', signal: '신규 출점 쇼룸 리뉴얼 실내건축 인테리어 발주', target: '브랜드 점포 개발·VMD·구매 담당자, 프랜차이즈 본사', offer: '매장·쇼룸 설계·시공·집기·사인과 오픈 콘텐츠', question: '공간 계약과 설계·시공사 선정은 어디까지 진행됐고 아직 발주하지 않은 범위는 무엇인가요?', evidence: '공식 오픈 계획, 면적·현장 인도일, 미발주 범위, 의사결정자', lead: 90, division: 'AR' },
  { id: 'season', label: '시즌·기념일 캠페인', signal: '시즌 캠페인 기념일 프로모션', target: '뷰티·패션·F&B 브랜드 마케팅팀', offer: '시즌 메시지·연재 콘텐츠·채널별 광고 소재', question: '이번 시즌에 집중할 제품과 고객 행동은 무엇인가요?', evidence: '공식 캠페인 일정, 제품 정보, 이전 시즌 결과', lead: 45, division: 'TW' },
  { id: 'public', label: '공공·지원사업', signal: '홍보 행사 운영 용역 모집 공고', target: '발주기관·공고 담당 부서, 선정 기업', offer: '공고 범위에 맞춘 행사·콘텐츠·홍보 제안', question: '참가 자격·제출 서류·질의 마감과 평가 기준은 무엇인가요?', evidence: '원문 공고, 참가 자격, 질의·입찰 마감, 예산', lead: 45, division: 'TW' },
  { id: 'partner', label: '대행사·공간 제휴', signal: '브랜드 대행사 공간 대관 제휴', target: '광고·PR 대행사, 공간 운영사, 제작 파트너', offer: '공동 제안·제작 지원·상호 소개', question: '현재 보완이 필요한 제작 역량과 협업 가능한 프로젝트가 있나요?', evidence: '최근 수행 프로젝트, 협업 문의 창구, 역할·수익 배분', lead: 30, division: 'AR' },
  { id: 'return', label: '기존 고객 재접촉', signal: '브랜드 새 소식 캠페인', target: '이전 거래처·미팅 고객·보류 기회', offer: '이전 성과 점검 후 추가 콘텐츠·공간·시즌 제안', question: '이전 프로젝트 이후 달라진 목표와 다음 실행 일정은 무엇인가요?', evidence: '기존 활동 이력, 보류 사유, 담당자 변경, 최근 소식', lead: 21, division: 'TW' },
] as const
export type ProspectPlayId = typeof PROSPECT_PLAYS[number]['id']
export interface ProspectPlan {
  play: ProspectPlayId; target: string; industry: string; region: string; month: string
  event: string; start: string; end: string; certainty: '미확인' | '예정' | '확인'; sourceUrl: string; verifiedOn: string
  contact: string; need: string; evidence: string; leadDays: number
}
export const RESEARCH_SOURCES = [
  { label: '코엑스 공식 행사 일정', url: 'https://www.coex.co.kr/event/exhibitions-calendar/', hint: '행사 원문 → 주최사 → 참가기업 목록 확인' },
  { label: '기업마당', url: 'https://www.bizinfo.go.kr/', hint: '지원사업·행사 공고에서 수요와 제출 기한 확인' },
  { label: 'K-Startup', url: 'https://www.k-startup.go.kr/', hint: '모집 공고와 행사·기업 소식 확인' },
] as const
export function newProspectPlan(): ProspectPlan {
  return { play: 'launch', target: '', industry: '', region: '', month: '', event: '', start: '', end: '', certainty: '미확인', sourceUrl: '', verifiedOn: '', contact: '', need: '', evidence: '', leadDays: 42 }
}
export function prospectPlay(id: ProspectPlayId) { return PROSPECT_PLAYS.find(x => x.id === id) ?? PROSPECT_PLAYS[0] }
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '2000-01-01' && value <= '2100-12-31' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
export function shiftDate(value: string, days: number): string {
  if (!validDate(value) || !Number.isInteger(days)) throw new Error('날짜를 확인해 주세요.')
  return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
}
export function validateProspect(p: ProspectPlan, today: string): string | null {
  if (!PROSPECT_PLAYS.some(x => x.id === p.play)) return '발굴 경로를 선택해 주세요.'
  if (!p.target.trim() || p.target.length > 80) return '대상 브랜드·기관을 80자 이내로 입력해 주세요.'
  if (!['미확인','예정','확인'].includes(p.certainty)) return '일정 확인 상태를 선택해 주세요.'
  if (p.month && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(p.month)) return '검색할 연월을 확인해 주세요.'
  if (!Number.isInteger(p.leadDays) || p.leadDays < 7 || p.leadDays > 180) return '준비 기간은 7~180일의 정수로 입력해 주세요.'
  if ([p.start, p.end, p.verifiedOn].some(x => x && !validDate(x))) return '행사·확인 날짜를 확인해 주세요.'
  if (p.end && (!p.start || p.end < p.start)) return '종료일은 시작일 이후로 입력해 주세요.'
  if (p.verifiedOn && p.verifiedOn > today) return '확인일은 오늘 이후로 지정할 수 없습니다.'
  if (p.start && !p.event.trim()) return '일정의 행사·사업명을 입력해 주세요.'
  if (p.certainty === '확인' && (!p.start || !p.sourceUrl || !p.verifiedOn || !p.evidence.trim())) return '확인한 일정에는 시작일·출처·확인일·확인 근거가 필요합니다.'
  if (p.sourceUrl) {
    try { const u = new URL(p.sourceUrl); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return '공식 출처는 http(s) 주소로 입력해 주세요.' } catch { return '공식 출처 주소를 확인해 주세요.' }
  }
  if (p.industry.length > 80 || p.region.length > 80 || p.event.length > 120 || p.contact.length > 300 || p.need.length > 1000 || p.evidence.length > 2000 || p.sourceUrl.length > 2000) return '입력 내용을 줄여 주세요.'
  return null
}
export function researchLinks(p: ProspectPlan) {
  const base = [p.target, p.industry, p.region, p.month].map(s => s.trim()).filter(Boolean).join(' ')
  const queries = [
    ['수요·일정 찾기', `${base} ${prospectPlay(p.play).signal}`],
    ['공식 공지 찾기', `${base} ${p.event} 공식 일정 보도자료`],
    ['담당 부서 찾기', `${p.target || p.industry} ${prospectPlay(p.play).division === 'AR' ? '공식 시설 구매 점포개발 공간 VMD 담당' : '공식 제휴 문의 마케팅 담당'}`],
    ['참가사·협력사 찾기', `${base} ${p.event} 참가기업 주최사 협력사`],
  ]
  return queries.map(([label, query]) => ({ label, query, google: `https://www.google.com/search?q=${encodeURIComponent(query)}`, naver: `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}` }))
}
export function prospectTimeline(p: ProspectPlan, today: string) {
  if (!validDate(p.start) || !Number.isInteger(p.leadDays) || p.leadDays < 7 || p.leadDays > 180) return []
  const end = validDate(p.end) && p.end >= p.start ? p.end : p.start
  return [
    { label: '수요·담당자 확인', date: shiftDate(p.start, -p.leadDays) },
    { label: '맞춤 제안·미팅', date: shiftDate(p.start, -Math.max(7, Math.floor(p.leadDays / 2))) },
    { label: '진행 여부·일정 재확인', date: shiftDate(p.start, -7) },
    { label: '행사·사업 시작', date: p.start },
    { label: '결과 점검·후속 제안', date: shiftDate(end, 3) },
  ].map(x => ({ ...x, overdue: x.date < today }))
}
export function researchReadiness(p: ProspectPlan, today: string) {
  const checks = [
    { label: '출처·확인 근거', points: 25, done: !!p.sourceUrl && !!p.evidence.trim() && validDate(p.verifiedOn) && p.verifiedOn <= today },
    { label: '확인된 일정', points: 20, done: p.certainty === '확인' && validDate(p.start) },
    { label: '문의 창구', points: 15, done: !!p.contact.trim() },
    { label: '구체적인 수요', points: 25, done: !!p.need.trim() },
    { label: '앞으로의 일정', points: 15, done: validDate(p.start) && p.start >= today },
  ]
  return { checks, score: checks.reduce((n,x) => n + (x.done ? x.points : 0), 0) }
}
export function buildProspectDraft(p: ProspectPlan, owner: string, today: string): SalesDraft {
  const error = validateProspect(p, today); if (error) throw new Error(error)
  const play = prospectPlay(p.play), timeline = prospectTimeline(p, today)
  const past = !!p.start && (p.end || p.start) < today
  const action = past ? '종료 행사 결과·다음 회차 수요 확인' : p.certainty === '확인' ? '담당 부서·수요 확인 후 맞춤 제안 준비' : '공식 일정·담당 부서·수요 먼저 확인'
  const firstDate = timeline[0]?.date
  const date = !past && p.certainty === '확인' && firstDate && firstDate > today ? firstDate : today
  const d = { ...newSalesDraft(owner), title: `${p.target.trim()} · ${p.event.trim() || play.label}`.slice(0, 160), division: play.division,
    source: (p.play === 'public' ? '기타' : '직접 발굴') as SalesDraft['source'], source_url: p.sourceUrl.trim(), next_date: date, next_action: action,
    description: [
      '[신규 영업 발굴 계획]', `대상: ${p.target.trim()}`, `발굴 경로: ${play.label}`, `업종·지역·검색월: ${[p.industry,p.region,p.month].filter(Boolean).join(' / ') || '미확인'}`,
      `행사·사업: ${p.event || '미확인'}`, `일정: ${p.start || '미정'} ~ ${p.end || p.start || '미정'} (${p.certainty})`,
      `공식 출처: ${p.sourceUrl || '미확인'}`, `출처 확인일: ${p.verifiedOn || '미확인'}`, `확인 근거: ${p.evidence || '미확인'}`,
      `문의 창구: ${p.contact || '미확인'}`, `수요·접근 계기: ${p.need || '미확인'}`, `제안 방향: ${play.offer}`, `첫 미팅 질문: ${play.question}`,
      '', '[권장 업무 일정 · 실제 계약 일정 아님]', ...timeline.map(x => `${x.date} · ${x.label}${x.overdue ? ' (경과: 재조정 필요)' : ''}`),
      !timeline.length ? '일정 미정: 공식 공지 확인 후 다음 연락일을 조정하세요.' : '',
      '', '검색 결과는 사실 확인이 필요합니다. 일정 변경 시 이 계획과 다음 연락일을 함께 수정하세요. 자동 발송·예약 등록은 하지 않습니다.',
    ].filter(Boolean).join('\n') }
  const invalid = validateSales(d); if (invalid) throw new Error(invalid)
  return d
}
