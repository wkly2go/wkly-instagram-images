// 서면 인터뷰 '한 화면 · 비교' 화면 확인용 지어낸 시험 자료 — 개발 서버에서 VITE_INTERVIEW_HARNESS=1 일 때만 (배포 묶음 · 체험 모드에는 없음)
import type { SalesInterview } from '../lib/types'

const base = (id: string, brand: string, extra: Partial<SalesInterview>): SalesInterview => ({
  id, batch: '[시험] 11월', brand, event_name: null, venue: null, stage: '자료 수령', send_channel: '메일', sent_on: '2026-11-03', contact: null, emails: [],
  reply_channel: '메일', replied_at: '2026-11-10T10:00:00+09:00', image_use: '사용 가능', interview_ok: '예', form_url: null, form_sent_at: null, form_note: null,
  material_due: '2026-11-25', material_note: null, upload_on: '2026-11-28', upload_note: null, post_url: null, note: null,
  answers: {}, answered_at: null, answered_note: null, sales_info: {}, owner_id: null, content_id: null,
  mail_threads: [], mail_last_in_at: null, mail_last_out_at: null, mail_attach_at: null, source: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-20T00:00:00Z',
  ...extra,
})

export const HARNESS_INTERVIEWS: SalesInterview[] = [
  base('h1', '[시험] 브랜드 가', { event_name: '겨울 향 팝업', venue: '성수', answers: { Q1: '골목 끝 창고 공간이라 발견하는 즐거움을 주고 싶었습니다.', Q2: '방문 1만 명 · 시향 후 구매 전환', Q3: '1~3천만 원', Q4: '향을 따라 걷는 동선과 조도', Q5: '거울 터널 포토존', Q10: '시공 품질과 일정 준수' }, sales_info: { category: '뷰티', region: '서울 성수', budget: '1~3천만 원' } }),
  base('h2', '[시험] 브랜드 나', { stage: '제작', event_name: '러닝 체험관', venue: '한남', answers: { Q1: '러너들이 모이는 동네라 골랐습니다.', Q2: '체험 3천 명', Q4: '트랙 바닥재와 조명', Q6: '체험 뒤 바로 구매', Q10: '체험 설계 경험' }, sales_info: { category: '스포츠', region: '서울 한남' } }),
  base('h3', '[시험] 브랜드 다', { stage: '답변', event_name: '책 읽는 밤', venue: '연남', answers: { Q1: '조용한 주거지라 머무는 경험에 맞았습니다.', Q3: '1천만 원 미만' } }),
]
