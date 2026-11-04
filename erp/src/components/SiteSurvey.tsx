// 현장 실측 체크리스트 (대표 지시 2026-11-04 "현장 실측 체크리스트를 프로젝트 항목에 넣어")
//   - 표준 38항목: AR2610 포켓몬화석박물관 실측기록지(경계 · 구조 · 고정요소 · 바닥·벽 · 전기·통신 · 반입 · 창고 · 동선 · 규정)
//   - 항목마다 가로 · 세로 · 높이(mm) · 위치 메모(기준점 대비) · 사진 번호 · 확인자 · 상태(미확인 · 확인 · 추가확인 · 해당없음)
//   - 칸을 벗어나면 바로 저장 · 휴대폰에서도 한 손으로 입력 (현장에서 바로)
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, Plus, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import type { Project, SiteSurveyItem, SurveyStatus } from '../lib/types'
import { Button, Help, SectionHead } from './ui'

type Seed = [category: string, item: string, basis: string, priority: '상' | '중' | '하']
/** 표준 실측 항목 (근거는 현장마다 다르므로 일반 표현) */
export const SURVEY_TEMPLATE: Seed[] = [
  ['경계', '사용 구역 경계 (바닥 기준 가로 · 세로)', '평면 · 조닝도', '상'],
  ['경계', '입구 폭 · 높이 (동선 진입부)', '평면도', '상'],
  ['경계', '출구 폭 · 높이', '평면도', '상'],
  ['경계', '입구 외벽 · 경계 마감 주체 (측정 아님, 확인자 기록)', '협의', '상'],
  ['구조', '기둥 1 (위치, 가로 · 세로 · 높이)', '평면도', '상'],
  ['구조', '기둥 2 이상 (있으면 행 추가)', '평면도', '상'],
  ['구조', '층고: 바닥 ~ 천장 유효 높이', '체크리스트', '상'],
  ['구조', '천장: 스프링클러 · 감지기 · 조명 위치와 높이', '체크리스트', '상'],
  ['구조', '행잉 포인트 · 매입 가능 여부 (사인 · 조명)', '협의', '중'],
  ['고정요소', '항온항습기 · 설비 위치와 벽 · 주변과의 이격', '평면도 · 캐드', '상'],
  ['고정요소', '설비 점검 · 배기 공간 (전면 여유)', '평면도', '중'],
  ['고정요소', '소화전 위치와 전면 여유', '평면도 · 캐드', '상'],
  ['고정요소', '소방 수신기 위치', '평면도 · 캐드', '상'],
  ['고정요소', '불꽃 · 화재 감지기함 위치', '평면도 · 캐드', '상'],
  ['고정요소', '전등 컨트롤러 · 스위치 위치', '평면도 · 캐드', '중'],
  ['고정요소', '안내데스크 위치와 치수', '평면도', '중'],
  ['바닥·벽', '바닥 마감 재질, 허용 하중, 보양 필요 여부', '체크리스트', '상'],
  ['바닥·벽', '벽면 마감과 부착 가능 범위 (시트 · 테이프 · 피스)', '체크리스트', '중'],
  ['바닥·벽', '구조물 고정 방식: 앵커 · 타공 가능 여부, 불가 시 자립식', '체크리스트', '상'],
  ['전기·통신', '분전반 위치', '체크리스트', '상'],
  ['전기·통신', '콘센트 위치와 개수', '체크리스트', '상'],
  ['전기·통신', '사용 가능 전기 용량 (kW)', '체크리스트', '상'],
  ['전기·통신', '가설전기 신청 절차 · 비용 · 담당자', '체크리스트', '상'],
  ['전기·통신', '통신: Wi-Fi · 유선 · LTE 수신 (결제 단말)', '체크리스트', '상'],
  ['반입', '하역 위치 → 현장까지 경로와 거리', '체크리스트', '상'],
  ['반입', '화물 엘리베이터 내부 폭 · 깊이 · 높이, 문 폭 · 높이, 적재 하중', '체크리스트', '상'],
  ['반입', '반입 경로 출입문 최소 폭 · 높이', '체크리스트', '상'],
  ['반입', '단차 · 경사로', '체크리스트', '중'],
  ['반입', '차량 진입 톤수 · 높이 제한, 주차 · 대기', '체크리스트', '상'],
  ['반입', '임시 적치 공간', '체크리스트', '중'],
  ['창고', '내부 창고 가로 · 세로 · 높이', '협의', '상'],
  ['창고', '외부 컨테이너 · 창고 위치와 사용 여부', '협의', '상'],
  ['창고', '창고 잠금 · CCTV', '협의', '중'],
  ['동선', '포토존 후보 위치 (관람 동선과 간섭 여부)', '협의', '중'],
  ['동선', '대기열 가능 구역과 길이', '체크리스트', '상'],
  ['동선', '결제 카운터 후보 위치 (전기 · 통신 접근)', '체크리스트', '중'],
  ['동선', '소방 피난 통로 폭 기준', '체크리스트', '상'],
  ['규정', '폐기물 반출, 원상복구 기준 (확인자 기록)', '체크리스트', '중'],
]
const STATUSES: SurveyStatus[] = ['미확인', '확인', '추가확인', '해당없음']
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, '')) || null)

export function SiteSurveySection({ project }: { project: Project }) {
  const { api, version, me } = useApp()
  const { busy, run } = useAction()
  const { data: items, reload } = useAsync(() => api.listSurvey(project.id).catch(() => [] as SiteSurveyItem[]), [project.id, version], [] as SiteSurveyItem[])
  const [open, setOpen] = useState(false)
  const [onlyOpen, setOnlyOpen] = useState(false)
  // 구분(경계 · 구조 …)별 묶음 · 묶음과 항목 모두 접고 펼침 (대표 지시 2026-11-04 "세분화해서 접을 수 있게")
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [openItem, setOpenItem] = useState<string | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, SiteSurveyItem[]>()
    for (const i of items) m.set(i.category || '기타', [...(m.get(i.category || '기타') ?? []), i])
    return [...m.entries()]
  }, [items])
  const done = items.filter(i => i.status === '확인' || i.status === '해당없음').length
  const extra = items.filter(i => i.status === '추가확인').length
  const toggleCat = (c: string) => setOpenCats(prev => {
    const n = new Set(prev)
    if (n.has(c)) n.delete(c)
    else n.add(c)
    return n
  })
  const allOpen = groups.length > 0 && groups.every(([c]) => openCats.has(c))
  const dims = (i: SiteSurveyItem) => [i.width_mm, i.depth_mm, i.height_mm].some(v => v != null) ? [i.width_mm, i.depth_mm, i.height_mm].map(v => (v == null ? '–' : Number(v).toLocaleString('ko-KR'))).join(' × ') : ''

  const save = (i: SiteSurveyItem, patch: Partial<SiteSurveyItem>) =>
    run(async () => {
      await api.saveSurveyItem({ ...patch, id: i.id, project_id: i.project_id, item: patch.item ?? i.item })
      reload()
    })
  const seed = () =>
    run(async () => {
      for (const [k, [category, item, basis, priority]] of SURVEY_TEMPLATE.entries())
        await api.saveSurveyItem({ project_id: project.id, no: k + 1, category, item, basis, priority, status: '미확인' })
      reload()
      setOpen(true)
    })
  const add = (addCat: string) =>
    run(async () => {
      const no = Math.max(0, ...items.map(i => i.no)) + 1
      const row = await api.saveSurveyItem({ project_id: project.id, no, category: addCat, item: '새 항목', priority: '중', status: '미확인' })
      reload()
      setOpenCats(prev => new Set(prev).add(addCat))
      setOpenItem(row.id)
    })
  const csv = () => {
    const head = ['No', '구분', '점검 항목', '근거', '우선순위', '가로(mm)', '세로(mm)', '높이(mm)', '위치·메모', '사진 번호', '확인자', '상태']
    const rows = items.map(i => [i.no, i.category, i.item, i.basis ?? '', i.priority, i.width_mm ?? '', i.depth_mm ?? '', i.height_mm ?? '', i.memo ?? '', i.photo_no ?? '', i.checker ?? '', i.status])
    const text = '﻿' + [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
    a.download = `${project.code ?? ''} ${project.name} 실측 체크리스트.csv`.trim()
    a.click()
  }

  return (
    <div className="col gap-6 survey">
      <SectionHead
        title="현장 실측 체크리스트"
        count={items.length ? `${done}/${items.length}` : undefined}
        right={
          <span className="row" style={{ gap: 6 }}>
            {items.length > 0 && (
              <button type="button" className="quick-btn" onClick={() => setOpen(!open)}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {open ? '접기' : '펼치기'}
              </button>
            )}
            <Help text="단위 mm. 기준점(예: 입구 왼쪽 안쪽 코너 A)을 정하고 위치 · 메모에 기준점으로부터의 거리를 적습니다. 도면과 현장이 다르면 상태를 '추가확인'으로 바꾸고 차이를 메모합니다. 칸을 벗어나면 바로 저장됩니다." />
          </span>
        }
      />
      {items.length === 0 ? (
        <div className="survey-empty">
          <span className="t-small">현장 실측 전에 표준 체크리스트(경계 · 구조 · 고정요소 · 바닥·벽 · 전기·통신 · 반입 · 창고 · 동선 · 규정, 38항목)를 불러와 현장에서 바로 기록합니다.</span>
          <Button kind="blue" disabled={busy} onClick={seed}>
            <Plus size={14} /> 표준 체크리스트 불러오기
          </Button>
        </div>
      ) : (
        <>
          <div className="survey-bar" aria-label="진행">
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <span className="t-cap">
            확인 {done} · 남음 {items.length - done}
            {extra ? ` · 추가확인 ${extra}` : ''}
          </span>
          {open && (
            <>
              <div className="row survey-tools">
                <button type="button" className="quick-btn" onClick={() => setOpenCats(allOpen ? new Set() : new Set(groups.map(([c]) => c)))}>
                  {allOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {allOpen ? '모두 접기' : '모두 펼치기'}
                </button>
                <label className="row t-small survey-only">
                  <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> 남은 것만
                </label>
                <button type="button" className="quick-btn" onClick={csv} title="엑셀로 열 수 있는 파일">
                  <Download size={13} /> 엑셀
                </button>
              </div>
              <div className="survey-groups">
                {groups.map(([c, list]) => {
                  const ok = list.filter(i => i.status === '확인' || i.status === '해당없음').length
                  const more = list.filter(i => i.status === '추가확인').length
                  const rows = list.filter(i => !onlyOpen || i.status === '미확인' || i.status === '추가확인')
                  const isOpen = openCats.has(c)
                  return (
                    <div key={c} className={`survey-group ${isOpen ? 'open' : ''}`}>
                      <button type="button" className="survey-ghead" onClick={() => toggleCat(c)} aria-expanded={isOpen}>
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <b className="survey-gname">{c}</b>
                        <span className="survey-gbar" aria-hidden="true">
                          <span style={{ width: `${(ok / list.length) * 100}%` }} />
                        </span>
                        <span className="survey-gcount">
                          {ok}/{list.length}
                          {more ? <em> · 추가 {more}</em> : null}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="survey-list">
                          {rows.map(i => {
                            const itemOpen = openItem === i.id
                            return (
                              <div key={i.id + i.updated_at} className={`survey-row st-${i.status} ${itemOpen ? 'open' : ''}`}>
                                <div className="survey-line">
                                  <button type="button" className="survey-linebtn" onClick={() => setOpenItem(itemOpen ? null : i.id)} aria-expanded={itemOpen}>
                                    <span className="survey-no">{i.no}</span>
                                    <span className={`survey-pri p-${i.priority}`}>{i.priority}</span>
                                    <span className="survey-text">{i.item}</span>
                                    {dims(i) && <span className="survey-dims">{dims(i)}</span>}
                                  </button>
                                  <select
                                    className={`select survey-st st-${i.status}`}
                                    value={i.status}
                                    onChange={e => save(i, { status: e.target.value as SurveyStatus, checker: i.checker || me.name })}
                                    aria-label="상태"
                                  >
                                    {STATUSES.map(st => (
                                      <option key={st}>{st}</option>
                                    ))}
                                  </select>
                                </div>
                                {itemOpen && (
                                  <div className="survey-detail">
                                    <label className="survey-pair wide">
                                      <span>항목</span>
                                      <input defaultValue={i.item} onBlur={e => e.target.value.trim() && e.target.value !== i.item && save(i, { item: e.target.value.trim() })} aria-label="점검 항목" />
                                    </label>
                                    <div className="survey-nums">
                                      {(
                                        [
                                          ['width_mm', '가로'],
                                          ['depth_mm', '세로'],
                                          ['height_mm', '높이'],
                                        ] as const
                                      ).map(([k, label]) => (
                                        <label key={k} className="survey-pair">
                                          <span>{label}</span>
                                          <input inputMode="decimal" defaultValue={i[k] ?? ''} placeholder="mm" onBlur={e => num(e.target.value) !== i[k] && save(i, { [k]: num(e.target.value) })} />
                                        </label>
                                      ))}
                                    </div>
                                    <label className="survey-pair wide">
                                      <span>메모</span>
                                      <input defaultValue={i.memo ?? ''} placeholder="기준점 대비 거리 · 차이" onBlur={e => (e.target.value || null) !== i.memo && save(i, { memo: e.target.value || null })} />
                                    </label>
                                    <div className="survey-foot">
                                      <label className="survey-pair">
                                        <span>사진</span>
                                        <input defaultValue={i.photo_no ?? ''} placeholder="P01" onBlur={e => (e.target.value || null) !== i.photo_no && save(i, { photo_no: e.target.value || null })} />
                                      </label>
                                      <span className="survey-meta">
                                        {i.basis ? <span>근거 {i.basis}</span> : null}
                                        {i.checker ? <span>확인 {i.checker}</span> : null}
                                      </span>
                                      <button type="button" className="icon-btn sm" title="항목 지우기" aria-label="항목 지우기" onClick={() => run(async () => (await api.deleteSurveyItem(i.id), reload()))}>
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {rows.length === 0 && <span className="t-cap survey-none">남은 항목이 없습니다.</span>}
                          <button type="button" className="survey-add" onClick={() => add(c)} disabled={busy}>
                            <Plus size={14} /> {c}에 항목 추가
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
