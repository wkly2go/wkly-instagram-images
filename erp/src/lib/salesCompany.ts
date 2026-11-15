/**
 * What the company sells, what it may not bid for, and the sales methods the planner chooses from.
 * Source: 2026-11-15 대표 지시와 제출한 확인서 6종 (디자인전문회사 · 직접생산확인 · 벤처기업 · 연구개발전담부서 · 출판사 · 소기업).
 * The planner reads this on every run; approvals and rejection reasons per method are added from the database.
 */
export const COMPANY_LIMITS='회사 조건: 아트리어디자인스튜디오는 팝업스토어·전시 부스·매장·플래그십의 공간 디자인과 제작·설치를, 더위클리는 행사·광고·콘텐츠(팝업 매거진)를 판다. 이 범위 밖의 상품(수출 상담, 교육, 일반 컨설팅 등)은 제안하지 마라. 실내건축공사업 등 건설업 면허가 없다. 면허가 필요한 공사 입찰·시공 도급은 참여할 수 없으니 제안하지 말고, 참여 가능한 용역(기획·디자인·제작·설치·운영)과 민간 제안만 다뤄라. 보유 자격은 산업디자인전문회사(종합: 시각·환경·멀티미디어디자인), 직접생산확인, 벤처기업, 연구개발전담부서, 출판사 신고다. 공고의 참가 자격이 이 범위를 벗어나면 참여 불가로 적어라. '
export interface SalesMethod {name:string;signal:string;offer:string;first:string}
/** Each method starts from an observable signal, so a plan always names why this customer and why now. */
export const SALES_PLAYBOOK:readonly SalesMethod[]=[
 {name:'팝업 오픈 브랜드 후속 제안',signal:'브랜드의 팝업 운영·예정 보도',offer:'다음 시즌·다음 지역 팝업의 공간 디자인과 제작·설치',first:'이번 팝업의 공개 정보를 근거로 다음 회차 일정과 공간 계획을 묻는다'},
 {name:'신규 매장·플래그십 오픈 후속',signal:'매장·쇼룸·플래그십 오픈 보도',offer:'오픈 프로모션 공간, 시즌 리뉴얼, 추가 지점 디자인',first:'오픈 공간을 구체적으로 짚고 시즌 연출 수요를 묻는다'},
 {name:'박람회·전시 참가사 부스 제안',signal:'박람회·전시회 참가기업 모집, 참가사 목록',offer:'부스 디자인과 제작·설치·철거 일괄',first:'행사명과 일정에 맞춘 부스 규모별 구성을 제시한다'},
 {name:'공공 용역 입찰 참여',signal:'나라장터 행사·전시·홍보 용역 공고',offer:'면허가 필요 없는 기획·디자인·제작·운영 용역 제안서',first:'참가 자격·추정가격·마감을 대조해 참여 여부를 판단한다'},
 {name:'면허 보유사와 공동 참여',signal:'실내건축 면허와 디자인 자격을 함께 요구하는 공고(공동수급 허용)',offer:'디자인·콘텐츠 분담의 공동수급 구성',first:'공동수급 허용 여부를 확인하고 면허 보유 협력사에 분담안을 제안한다'},
 {name:'기존 거래처 재수주',signal:'거래처의 새 캠페인·행사·출점 소식, 지난 프로젝트 종료 후 기간 경과',offer:'지난 프로젝트를 잇는 다음 프로젝트',first:'지난 프로젝트 결과를 근거로 다음 일정을 묻는다'},
 {name:'대행사·기획사 협력 제안',signal:'행사·캠페인을 수주한 대행사 보도, 대행사 선정 공고',offer:'대행사의 공간 파트 디자인·제작 협력',first:'수주한 행사의 공간 파트 협력 범위를 제안한다'},
 {name:'공간 운영사·유통사 제휴',signal:'대관 공간·백화점·쇼핑몰의 팝업 유치 계획',offer:'입점 브랜드용 표준 팝업 패키지, 공간 연간 운영',first:'공간의 입점 일정에 맞춘 패키지 운영안을 제안한다'},
 {name:'매거진 취재 연계',signal:'더위클리 매거진이 다룰 만한 팝업·브랜드',offer:'취재·콘텐츠로 관계를 만든 뒤 다음 프로젝트 제안',first:'취재 요청으로 담당자와 접점을 만든다'},
]
export interface MethodLearning {category:string;approved:number;rejected:number;reasons:string[]}
export const playbookText=()=>SALES_PLAYBOOK.map((m,i)=>`${i+1}. ${m.name} | 신호: ${m.signal} | 제안: ${m.offer} | 첫 접근: ${m.first}`).join('\n')
