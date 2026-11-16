import type { GrowthSummary } from './growth.ts'
import type { SalesDraft } from './sales.ts'
import { readSalesPlan } from './salesPlan.ts'

export const SALES_METHOD_VERSION = '2026-11-14.1'
export interface SalesMethod {
 id: string; title: string; target: string; intent: string; buyer: string; channel: string;
 offer: string; questions: string[]; steps: string[]; proof: string; nextAction: string;
 objection: string; response: string; exit: string;
}
export const SALES_METHODS: SalesMethod[] = [
 {id:'inquiry',title:'기존 문의 후속 상담',target:'구체적인 팝업·제작·운영 문의가 남아 있는 대상',intent:'기존 공간·행사 문의의 현재 수요와 미발주 업무를 확인하는 영업',buyer:'문의한 담당자 → 예산 승인자·구매 담당자 확인',channel:'기존 문의 스레드로 회신하거나 합의한 연락 경로 사용',offer:'요청 범위·일정·제약을 정리한 1쪽 답변과 범위별 견적안',questions:['현재도 추진 중인 건이며 이미 맡긴 업무는 무엇인가요?','기획·공간 제작·현장 운영 중 필요한 범위는 무엇인가요?','오픈일, 예산 범위와 최종 결정 절차는 어떻게 되나요?'],steps:['먼저 기존 답변과 미해결 질문을 확인한다.','필요 범위를 확인한 뒤 관련 수행 사례와 준비안을 보낸다.','제안 검토일과 다음 연락일을 담당자와 합의한다.'],proof:'공개·공유 가능한 유사 수행 사례, 실제 담당 범위, 검증된 결과',nextAction:'기존 문의의 현재 진행 여부와 미발주 범위 확인 후 상담 일정 협의',objection:'이미 다른 업체와 진행 중입니다.',response:'이미 확정된 범위를 확인하고 남아 있는 과업이나 다음 회차 수요가 있는지 묻습니다.',exit:'담당자가 필요 범위와 제안 검토 일정을 확인하면 제안 단계로 진행'},
 {id:'brand',title:'브랜드 맞춤 제안',target:'신제품·신규 매장·팝업 계획의 공식 단서가 있는 브랜드',intent:'브랜드 목표에 맞춘 팝업 기획·제작·운영 대행 제안',buyer:'브랜드 마케팅·리테일 담당자 → 의사결정자 확인',channel:'공식 제휴 창구 또는 기존 소개 경로부터 확인',offer:'목표 고객·공간 활용·실행 범위의 제안 가설을 1쪽으로 정리',questions:['이번 오프라인 활동에서 가장 중요한 고객 행동은 무엇인가요?','공간·일정·대행사는 어느 범위까지 정해졌나요?','제안 검토 담당자와 의사결정 시점은 언제인가요?'],steps:['공식 발표와 최근 접촉 이력에서 지금 제안할 이유를 찾는다.','공유해도 되는 관련 사례 하나와 작은 제안 가설을 준비한다.','먼저 자료 검토 의향을 확인하고 관심이 있을 때 상담한다.'],proof:'해당 업종과 목표에 맞는 실제 수행 범위·사례',nextAction:'브랜드의 공식 추진 단서와 담당 부서를 확인하고 1쪽 제안 검토 의향 문의',objection:'아직 예산이나 계획이 없습니다.',response:'현재 수요가 없으면 보류하고 계획을 검토하는 시점을 확인합니다.',exit:'실제 목표·일정·미발주 범위를 확인한 뒤 정식 제안'},
 {id:'partner',title:'협력사 공동 제안',target:'제작·패키지·장비·운영 업체가 협력을 제안한 자료',intent:'공급·협력 제안 검토. 직접 발주 수요는 아직 확인되지 않음',buyer:'협력사의 사업개발·프로젝트 책임자',channel:'받은 협력 제안의 기존 회신 경로',offer:'역할 분담·고객 소개·공동 견적이 가능한 구체적인 과업 검토',questions:['직접 발주할 과업인가요, 공급·협력을 제안하시는 건가요?','함께 제안할 실제 고객 건이 있으며 소개 동의를 받았나요?','수행 범위·정산 방식·고객 대응 책임은 어떻게 나누나요?'],steps:['발주처인지 공급 파트너인지 먼저 구분한다.','실제 고객 건과 서로 맡을 과업이 있을 때 공동 제안을 검토한다.','합의한 범위와 고객 소개 경로를 기록한다.'],proof:'수행 가능 범위, 납기·품질 검증 자료와 협업 조건',nextAction:'협력 제안의 역할과 실제 공동 수주 건 유무 확인',objection:'고객 없이 먼저 제휴부터 하고 싶습니다.',response:'가능한 역할을 기록하고 구체적인 고객 과업이 생기는 시점에 재검토합니다.',exit:'실제 고객 건과 공동 수행 범위가 확인되면 협업 영업으로 연결'},
 {id:'venue',title:'공간 운영사 연계 제안',target:'팝업 공간·쇼핑몰·복합시설을 운영하는 대상',intent:'공간에 맞는 브랜드 유치와 팝업 운영 협업 제안',buyer:'공간 운영·임대·MD·마케팅 담당자',channel:'운영사의 공식 제휴·임대 문의 창구',offer:'가능 일정·시설 조건·브랜드 적합성을 담은 운영안',questions:['활용 가능한 일정과 공간 조건은 무엇인가요?','브랜드 유치와 제작·운영 중 필요한 역할은 무엇인가요?','대관·안전·철수·정산의 책임과 조건은 어떻게 되나요?'],steps:['운영 주체와 공식 임대·제휴 조건을 확인한다.','입점 가능한 브랜드군과 준비 일정을 맞춘다.','구체적인 브랜드 건에 대해 역할과 견적을 제안한다.'],proof:'공간 도면·반입 조건·실제 운영 사례',nextAction:'공간 운영 주체와 가능 일정·브랜드 유치 수요 확인',objection:'대관만 가능하고 운영 예산은 없습니다.',response:'임대 중개와 대행 발주를 구분하고 수익 구조가 맞는지 먼저 검토합니다.',exit:'공간 조건·수행 역할·비용 부담 주체가 확인되면 제안'},
 {id:'tender',title:'공식 공고 대응',target:'발주기관·마감·과업이 있는 입찰 공고',intent:'공고에 명시된 과업의 용역·제작 수주 검토',buyer:'공고의 공식 질의 담당자 및 계약 부서',channel:'공식 공고에 지정된 질의·제출 절차',offer:'참가 자격·평가 항목에 맞춘 과업 수행안과 제출 서류',questions:['원문 정정 여부와 참가 자격을 충족하나요?','실적·인력·제출 서류와 현장 조건은 무엇인가요?','질의·제출 마감과 평가 기준을 확인했나요?'],steps:['공식 원문·정정 공고·첨부 과업을 대조한다.','참여 여부와 준비 담당자·제출 일정을 결정한다.','평가 항목별 증빙과 견적을 검토한다.'],proof:'공식 공고·과업지시서·자격 및 실적 증빙',nextAction:'공식 원문의 자격·과업·마감 대조 후 참여 여부 결정',objection:'자격 또는 실적이 부족합니다.',response:'충족 여부가 확인될 때까지 참여를 보류하고 허용된 공동 수행 조건만 검토합니다.',exit:'참여 검토를 통과하고 제출 서류와 담당자가 확정되면 제안 준비'},
 {id:'event',title:'공개 행사 연계 가능성 조사',target:'서울시·코엑스 등 공개 행사 일정',intent:'행사 연계 또는 다음 회차의 협업 가능성 조사. 발주 공고는 아님',buyer:'행사 주최·주관기관의 사업 담당 부서',channel:'행사 공식 원문에서 사업·협업 문의 창구 확인',offer:'행사 목표와 연계 가능한 팝업·체험 공간·운영 범위 가설',questions:['행사 안내 문의와 사업 발주 담당 부서는 같은가요?','현재 미발주 범위나 협업 모집이 있나요?','이번 회차가 확정됐다면 다음 회차 검토 시점은 언제인가요?'],steps:['행사 일정·주최기관과 원문 최신성을 확인한다.','협업 모집·조달 공고·남은 과업을 확인한다.','확인된 수요가 있을 때 관련 수행안으로 연결한다.'],proof:'공식 행사 원문, 실제 모집·발주 근거 또는 담당자 답변',nextAction:'행사 주최기관의 미발주 과업·협업 모집 여부 확인',objection:'운영 업체와 예산이 모두 확정됐습니다.',response:'이번 회차 수주 대상에서 보류하고 다음 회차 일정만 확인합니다.',exit:'실제 발주·협업 수요가 확인되기 전에는 수주 가능 건으로 확정하지 않음'},
]
const RESEARCH:SalesMethod={id:'research',title:'영업 내용 먼저 확인',target:'역할·수요 근거가 부족한 자료',intent:'이름과 연락처만으로는 어떤 수주인지 판단할 수 없음',buyer:'소속 회사와 사업 담당 역할부터 확인',channel:'기존 접촉 기록과 공식 홈페이지 확인',offer:'수요가 확인된 뒤 필요한 과업만 제안',questions:['어떤 회사와 역할의 연락처인가요?','실제 문의·발주 또는 협업 과업이 있나요?','원문에서 일정과 담당 부서를 확인할 수 있나요?'],steps:['출처와 연락 맥락을 읽는다.','발주처·협력사·단순 안내를 구분한다.','구체적인 과업을 확인한 뒤 영업 방법을 결정한다.'],proof:'소속·역할 및 구체적인 수요를 뒷받침하는 기록',nextAction:'원문에서 회사 역할과 실제 영업 과업 확인',objection:'자료가 안내·뉴스레터에 불과합니다.',response:'발주 수요로 분류하지 않고 관련 공식 사업 근거가 있는지 조사합니다.',exit:'구체적 수요·역할·근거를 확인한 뒤 영업 연결'}
const STOP:SalesMethod={...RESEARCH,id:'hold',title:'연락 보류',intent:'제외·보류 사유를 먼저 검토해야 하는 대상',nextAction:'제외·보류 근거 확인',channel:'새 연락을 제안하지 않음',offer:'기존 기록의 제외·보류 사유 확인',steps:['수신 거부·종료·보류 사유를 확인한다.'],exit:'새로운 근거와 담당자 검토 없이는 영업 연결하지 않음'}
export interface MethodInput {name:string;source?:string;evidence?:string;organization?:string;contact?:string;blocked?:boolean;assessment?:string;verifiedRole?:string}
export function salesEvidenceLinks(p:{source:string;source_url?:string;evidence?:string}):{label:string;url:string}[]{
 const links:{label:string;url:string}[]=[]
 const thread=p.evidence?.match(/\bGmail thread ([a-f0-9]{16})\b/i)?.[1]
 if(thread)links.push({label:'관련 메일 열기',url:`https://mail.google.com/mail/u/0/#all/${thread}`})
 if(/^https?:\/\//i.test(p.source_url??''))links.push({label:p.source==='거래처'?'등록 홈페이지 열기':'등록 출처 열기',url:p.source_url!})
 return links
}
export function recommendSalesMethod(p:MethodInput):SalesMethod {
 if(p.blocked||['제외','보류'].includes(p.assessment??''))return STOP
 const text=[p.name,p.organization,p.source,p.evidence].filter(Boolean).join(' ')
 const find=(id:string)=>SALES_METHODS.find(m=>m.id===id)!
 if(p.verifiedRole==='협력사'||p.verifiedRole==='소개·제휴')return find('partner')
 if(/나라장터|입찰 공고|입찰공고|보관 공고/.test(p.source??'')||/입찰공고|과업지시서|공고번호/.test(p.evidence??''))return find('tender')
 if(/서울시 문화행사|코엑스 행사/.test(p.source??''))return find('event')
 if(/협력사|공급업체|납품업체|협력 제안|협업 제안|크루 참여|크루 제안|패키지 제작 크루/.test(text))return find('partner')
 if(/공간 운영사|대관 운영|임대 문의|입점 제안|대관 문의|임대 공간|쇼핑몰 운영/.test(text))return find('venue')
 if(/뉴스레터|수신거부|구독 안내/.test(text))return RESEARCH
 if(/팝업|전시|시공|제작|운영|인테리어/.test(text)&&/문의|견적 요청|의뢰|제안 요청|재문의/.test(p.evidence??''))return find('inquiry')
 if(/출시|론칭|신제품|브랜드|리테일|신규 매장/.test(text))return find('brand')
 return RESEARCH
}
export function methodInputFromGrowth(p:GrowthSummary):MethodInput{return {name:p.title,source:p.kind==='tender'?'나라장터':p.document?.source,organization:p.document?.brand,contact:p.document?.email||p.document?.instagram,evidence:[p.document?.segment,p.document?.note].filter(Boolean).join(' · '),assessment:p.status==='제외'?'제외':undefined}}
export function methodInputFromDraft(d:SalesDraft):MethodInput{const {notes,plan}=readSalesPlan(d.description);return {name:d.title,source:d.source,organization:plan.target,contact:plan.contact,evidence:[notes,plan.demand,plan.evidence].join(' · '),assessment:['실주','보류'].includes(d.stage)?'보류':undefined}}
export function salesMethodDraft(p:MethodInput,m:SalesMethod):string {
 if(m.id==='hold')return '연락 보류 대상입니다. 새 연락 문안을 만들지 않습니다.'
 return `제목: ${p.name.slice(0,70)} 관련 ${m.id==='partner'?'협력 범위':'사업 담당'} 확인\n\n안녕하세요. ${p.name.slice(0,100)} 관련 기록을 검토하고 있습니다.\n${m.questions[0]}\n확인 후 준비할 내용: ${m.offer}.\n감사합니다.\n\n[보내기 전: 원문·담당자·현재 수요 확인, 실제 발신자와 연락처 기재]`
}
