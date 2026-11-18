// 개발 서버(체험 모드)에서 정부지원사업 화면을 확인하기 위한 지어낸 자료. 실제 공고 · 회사 서류가 아니며 배포 묶음에 들어가지 않는다.
import type { GovCompany, GovProgram } from '../lib/gov'

const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const base = { source: 'sample', supervising: '공공기관', target: '일반기업', biz_years: '7년미만', exclude_detail: null, apply_start: day(-10), detail_url: 'https://example.com/notice', apply_url: null, contact: '시험 기관 02-000-0000', owner_id: null, decision_note: null, first_seen_at: new Date().toISOString(), fit_company: 'wkly' } as const

export const SAMPLE_COMPANIES: GovCompany[] = [
  { key: 'wkly', name: '시험 콘텐츠 주식회사', short: '더위클리', founded: '2025-11-26', region: '서울', industries: '광고 대행 · 행사 대행 · 콘텐츠 제작', certifications: [], cert_notes: '보유 인증 없음', include_keywords: ['콘텐츠', '광고', '행사', '팝업'], exclude_keywords: ['바이오', '반도체'], sort: 1 },
  { key: 'arterior', name: '시험 디자인 주식회사', short: '아트리어', founded: '2021-07-13', region: '서울', industries: '인테리어 디자인 · 공간 설계', certifications: ['벤처기업', '산업디자인전문회사'], cert_notes: '벤처기업 · 산업디자인전문회사 (시험 자료)', include_keywords: ['디자인', '인테리어', '공간'], exclude_keywords: ['바이오'], sort: 2 },
]

export const SAMPLE_PROGRAMS: GovProgram[] = [
  { ...base, id: 's1', title: '(시험) 콘텐츠 스타트업 사업화 지원', org: '시험진흥원', category: '사업화', region: '전국', target_detail: '창업 7년 이내 콘텐츠 분야 기업', summary: '콘텐츠 제작 · 마케팅 비용을 지원하는 시험 공고입니다.', support_content: '사업화 자금 · 홍보 지원', apply_end: day(3), fit: '높음', fit_score: 86, fits: { wkly: { fit: '높음', score: 86, note: '업력 조건 충족(7년 미만) · 관심 분야: 콘텐츠, 마케팅 · 공공기관 주관' }, arterior: { fit: '보통', score: 52, note: '업력 조건 충족(7년 미만) · 공공기관 주관' } }, status: '검토 중' },
  { ...base, id: 's2', title: '(시험) 디자인전문회사 해외 진출 바우처', org: '시험디자인재단', category: '판로ㆍ해외진출', region: '서울', target_detail: '산업디자인전문회사 신고 기업', summary: '디자인 기업의 해외 전시 참가를 지원하는 시험 공고입니다.', support_content: '전시 참가비 · 통번역', apply_end: day(12), fit: '높음', fit_score: 92, fit_company: 'arterior', fits: { wkly: { fit: '보통', score: 58, note: '관심 분야: 전시, 해외' }, arterior: { fit: '높음', score: 92, note: '관심 분야: 디자인, 전시 · 보유 인증 언급: 산업디자인전문회사' } }, status: '신규' },
  { ...base, id: 's3', title: '(시험) 지역 창업보육센터 입주기업 모집', org: '시험대학교', category: '시설ㆍ공간ㆍ보육', region: '부산', target_detail: '부산 소재 창업 3년 이내 기업', summary: '입주 공간을 제공하는 시험 공고입니다.', support_content: '사무 공간', apply_end: day(20), fit: '제외', fit_score: 0, fits: { wkly: { fit: '제외', score: 0, note: '지역 제한: 부산' }, arterior: { fit: '제외', score: 0, note: '지역 제한: 부산 · 업력 3년 미만 대상 (현재 5.3년)' } }, status: '신규' },
  { ...base, id: 's4', title: '(시험) 청년 고용 장려금 참여기업 모집', org: '시험고용센터', category: '인력', region: '전국', target_detail: '상시근로자 5인 이상 기업', summary: '청년 채용 기업에 인건비 일부를 지원하는 시험 공고입니다.', support_content: '인건비 지원', apply_end: null, fit: '보통', fit_score: 52, fits: { wkly: { fit: '보통', score: 52, note: '공공기관 주관' }, arterior: { fit: '보통', score: 52, note: '공공기관 주관' } }, status: '신규' },
  { ...base, id: 's5', title: '(시험) 로컬 브랜드 팝업 운영 지원', org: '시험구청', category: '사업화', region: '서울', target_detail: '서울 소재 중소기업', summary: '팝업스토어 운영비를 지원하는 시험 공고입니다.', support_content: '운영비 · 공간', apply_end: day(6), fit: '높음', fit_score: 80, fits: { wkly: { fit: '높음', score: 80, note: '관심 분야: 팝업, 브랜드, 로컬 · 지자체 주관' }, arterior: { fit: '높음', score: 74, note: '관심 분야: 팝업, 브랜드, 공간 · 지자체 주관' } }, status: '신청 준비' },
]
