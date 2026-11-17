/**
 * What the company sells, what it may not bid for, and the sales methods the planner chooses from.
 * Source: 2026-11-15 대표 지시와 제출한 확인서 6종 (디자인전문회사 · 직접생산확인 · 벤처기업 · 연구개발전담부서 · 출판사 · 소기업).
 * The planner reads this on every run; approvals and rejection reasons per method are added from the database.
 */
export const COMPANY_LIMITS='회사 조건: 우리가 파는 것은 팝업과 행사의 기획·대행이다(공간 디자인, 제작·설치, 현장 운영, 홍보 콘텐츠 포함). 아트리어디자인스튜디오가 공간 디자인과 제작·설치를, 더위클리가 행사 기획·운영과 광고·콘텐츠(팝업 매거진)를 맡는다. 팝업이나 행사를 열거나 준비하는, 이 서비스가 필요한 곳만 영업 대상으로 삼아라. 이 범위 밖의 상품(수출 상담, 교육, 일반 컨설팅 등)이나 팝업·행사 수요의 단서가 없는 곳은 제안하지 마라. 실내건축공사업 등 건설업 면허가 없다. 면허가 필요한 공사 입찰·시공 도급은 참여할 수 없으니 제안하지 말고, 참여 가능한 용역(기획·디자인·제작·설치·운영)과 민간 제안만 다뤄라. 보유 자격은 산업디자인전문회사(종합: 시각·환경·멀티미디어디자인), 직접생산확인, 벤처기업, 연구개발전담부서, 출판사 신고다. 공고의 참가 자격이 이 범위를 벗어나면 참여 불가로 적어라. '
export interface SalesMethod {name:string;signal:string;offer:string;first:string}
/** Each method starts from an observable signal, so a plan always names why this customer and why now. */
export const SALES_PLAYBOOK:readonly SalesMethod[]=[
 {name:'팝업 오픈 브랜드 후속 제안',signal:'브랜드의 팝업 운영·예정 보도',offer:'다음 시즌·다음 지역 팝업의 기획·대행(공간 디자인, 제작·설치, 운영)',first:'이번 팝업의 공개 정보를 근거로 다음 회차 일정과 공간 계획을 묻는다'},
 {name:'신규 매장·플래그십 오픈 후속',signal:'매장·쇼룸·플래그십 오픈 보도',offer:'오픈 기념 행사와 프로모션 팝업의 기획·대행',first:'오픈 사실을 짚고 오픈 행사·시즌 팝업 계획을 묻는다'},
 {name:'박람회·전시 참가사 부스 제안',signal:'박람회·전시회 참가기업 모집, 참가사 목록',offer:'참가 부스의 기획·디자인·제작·설치·현장 운영 대행',first:'행사명과 일정에 맞춘 부스 규모별 구성을 제시한다'},
 {name:'공공 용역 입찰 참여',signal:'나라장터 행사·전시·홍보 용역 공고',offer:'행사·전시·홍보의 기획·운영 대행 용역 제안서(면허 불필요 범위)',first:'참가 자격·추정가격·마감을 대조해 참여 여부를 판단한다'},
 {name:'면허 보유사와 공동 참여',signal:'실내건축 면허와 디자인 자격을 함께 요구하는 공고(공동수급 허용)',offer:'디자인·콘텐츠 분담의 공동수급 구성',first:'공동수급 허용 여부를 확인하고 면허 보유 협력사에 분담안을 제안한다'},
 {name:'기존 거래처 재수주',signal:'거래처의 새 캠페인·행사·출점 소식, 지난 프로젝트 종료 후 기간 경과',offer:'지난 프로젝트를 잇는 다음 팝업·행사 기획·대행',first:'지난 프로젝트 결과를 근거로 다음 일정을 묻는다'},
 {name:'대행사·기획사 협력 제안',signal:'행사·캠페인을 수주한 대행사 보도, 대행사 선정 공고',offer:'대행사가 수주한 행사의 팝업·공간 파트 기획·제작 협력',first:'수주한 행사의 공간 파트 협력 범위를 제안한다'},
 {name:'공간 운영사·유통사 제휴',signal:'대관 공간·백화점·쇼핑몰의 팝업 유치 계획',offer:'입점 브랜드용 팝업 기획·운영 패키지, 공간 연간 운영 대행',first:'공간의 입점 일정에 맞춘 패키지 운영안을 제안한다'},
 {name:'매거진 취재 연계',signal:'더위클리 매거진이 다룰 만한 팝업·브랜드',offer:'취재·콘텐츠로 관계를 만든 뒤 다음 팝업·행사 기획·대행 제안',first:'취재 요청으로 담당자와 접점을 만든다'},
]
export interface MethodLearning {category:string;approved:number;rejected:number;reasons:string[]}
/** The database playbook is used when the job carries one; the built-in list is the fallback. */
export const playbookText=(methods:readonly SalesMethod[]=SALES_PLAYBOOK)=>(methods.length?methods:SALES_PLAYBOOK).slice(0,16).map((m,i)=>`${i+1}. ${m.name} | 신호: ${m.signal} | 제안: ${m.offer} | 첫 접근: ${m.first}`).join('\n')

/** 검증된 영업 스킬(계정 등급 · 첫 메일 3단 · 이해관계자 · 반론 · 후속 순서 · 휴면 거래처 · 받은 문의)에서 뽑은 원칙 — 기획 요청에 붙는다 (2026-11-17 대표 지시 '영업 스킬 학습해 능력을 높여') */
export const SALES_SKILLS='영업 기술(검증된 영업 방법에서 배운 원칙): ① 대상 우선순위는 적합도(팝업·행사·공간 수요와 규모)×시기(행사 전·예정)로 정한다. 적합도는 높은데 접점이 없으면 매거진 취재·공간 소개로 접점부터 만든다. ② 첫 메일은 3단: 상대의 공개된 구체 사실 한 줄(날짜·장소) → 그 상황에서 우리가 덜어 줄 일 1~2문장 → 부담 낮은 요청 하나(자료 받기 또는 20분 통화). ③ 받을 사람은 브랜드 마케팅·BX·공간/리테일 담당이 먼저, 대행사가 정해진 행사는 대행사 담당. 한 경로에만 기대지 말고 두 번째 경로(공개 문의 창구·대행사)를 approach에 적는다. ④ 예상 반론을 미리 준비한다: 이미 대행사 있음→공간 파트·부분 협력, 예산 없음→규모별 단계 제안, 시기 아님→다음 시즌 일정 확인. steps에 반론 대응 한 줄을 넣는다. ⑤ 후속은 3일 뒤 새 정보 하나(사례·공간) → 7일 뒤 다른 각도 → 14일 뒤 마무리 인사. 같은 말 반복 금지, 회신·거절이 오면 멈춘다. ⑥ 지난 거래처는 첫 연락에서 팔지 않는다. 지난 프로젝트를 구체적으로 짚고 근황을 묻는다. ⑦ 받은 문의는 24시간 안에, 상대 질문에 먼저 답하고 모르는 것은 질문 하나로 확인한다. '
/** 메일 초안 준비 단계용 짧은 원칙 */
export const SALES_SKILLS_DRAFT='첫 메일: 상대의 구체 사실 → 우리가 덜어 줄 일 → 부담 낮은 요청 하나. 예상 반론(대행사·예산·시기)의 답을 아이디어 안에 녹인다. '
