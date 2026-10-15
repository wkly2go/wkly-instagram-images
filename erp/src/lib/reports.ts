import type { Client, ReportTemplate } from './types'

/** 기본 거래처 리서치 보고서 양식 (DB 0018 기본값과 같음) */
export const DEFAULT_REPORT_BODY = '# {{거래처}} 리서치 보고서\n\n구분: {{구분}}\n작성일: {{작성일}}\n작성자: {{작성자}}\n홈페이지:\n받은 메일: (언제 · 누가 · 무슨 요청인지 한 줄)\n\n## 1. 한눈에 보기\n- 핵심 요약 1\n- 핵심 요약 2\n- 핵심 요약 3\n\n## 2. 회사 · 브랜드 개요\n- 업종 · 주요 제품/서비스\n- 규모 · 설립 · 본사/매장 위치\n- 주요 고객층\n\n## 3. 최근 동향 (최근 6개월)\n- 뉴스 · 보도자료 · 신제품 · 투자 · 인사\n\n## 4. 마케팅 방향성\n- 타깃 고객\n- 브랜드 톤앤매너 · 핵심 메시지\n- 주력 채널 (인스타그램 · 유튜브 · 오프라인 팝업 · 커머스 등)\n- 최근 캠페인 · 팝업 · 협업 사례\n- 앞으로의 방향 (추정 근거와 함께)\n\n## 5. 경쟁사 · 시장 흐름\n- 경쟁 브랜드와 차이점\n- 업계 흐름\n\n## 6. WKLY 제안 포인트\n- 협업 기회 (팝업 · 공간 · 콘텐츠 · 캠페인)\n- 첫 미팅에서 꺼낼 이야기\n\n## 7. 확인할 점 · 리스크\n-\n\n## 8. 출처\n-\n'

/** 양식의 {{거래처}} {{구분}} {{작성일}} {{작성자}} 채우기 */
export function fillReport(body: string, client: Pick<Client, 'name' | 'category'> | null, author: string, today: string): string {
  return body
    .replace(/\{\{거래처\}\}/g, client?.name ?? '거래처')
    .replace(/\{\{구분\}\}/g, client ? (client.category === '클라이언트' ? '클라이언트 (발주처)' : client.category) : '')
    .replace(/\{\{작성일\}\}/g, today.replace(/-/g, '.'))
    .replace(/\{\{작성자\}\}/g, author)
}

export const defaultTemplate = (list: ReportTemplate[]) => list.find(t => t.is_default) ?? list[0] ?? null
