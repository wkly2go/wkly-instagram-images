// Render / perspective scenes of a project (3D step). Follows the learned standard: two-digit order + floor + room name,
// same room from another angle as -1, -2; lower floor first, then along the route. Keeps a small preview and a link to the original.
import { useState } from 'react'
import { Badge, Button, Empty } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import type { DesignProject, DesignRender, ModelVersion } from '../lib/design'
import type { PlanGeometry } from '../lib/designPlan'
import { makeImagePreview } from '../lib/imagePreview'
import { confirmDelete } from './DesignWorkspace'

const pad = (n: number) => String(n).padStart(2, '0')

export function DesignRenders({ project }: { project: DesignProject }) {
  const { api, version } = useApp()
  const { run, busy } = useAction()
  const { data: scenes } = useAsync(() => api.listRenders(project.id), [project.id, version], [] as DesignRender[])
  const { data: plan } = useAsync(() => api.getDesignPlan(project.id), [project.id, version], null as PlanGeometry | null)
  const { data: versions } = useAsync(() => api.listModelVersions(project.id), [project.id, version], [] as ModelVersion[])
  const SRC: Record<string, string> = { model: '모델 · 평면', manual: '직접 입력' }
  const [title, setTitle] = useState('')
  const next = scenes.length + 1
  const add = (t: string, n = next) => run(() => api.addRender({ project_id: project.id, no: pad(n), title: t, sort: n * 10 }))
  const missing = (plan?.rooms ?? []).filter(r => r.name.trim() && !scenes.some(s => s.title.includes(r.name.trim())))
  const fromRooms = () => run(async () => { let n = next; for (const r of missing) { await api.addRender({ project_id: project.id, no: pad(n), title: r.name.trim(), sort: n * 10 }); n++ } }, `${missing.length}개 장면을 만들었습니다`)
  const pick = (s: DesignRender, file: File | undefined) => file && run(async () => {
    const blob = await makeImagePreview(file)
    if (!blob) throw new Error('그림을 읽지 못했습니다. JPG · PNG 파일로 다시 올려 주세요')
    const data = await new Promise<string>((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => no(fr.error); fr.readAsDataURL(blob) })
    await api.updateRender(s.id, { data })
  }, '그림을 넣었습니다')
  const done = scenes.filter(s => s.status === 'final').length
  return (<>
    {versions.length > 0 && <div className="design-plan-qty" aria-label="모델 버전 이력">
      <div className="row wrap"><b className="t-bodyb">모델 버전 이력</b><span className="t-cap">스케치업 '수량 보내기'나 '수량표에 반영'을 할 때마다 새 버전이 됩니다. 지금 쓰는 버전은 {project.model_version}번째입니다.</span></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>버전</th><th>만든 날</th><th className="num">수량 줄</th><th>출처</th><th /></tr></thead>
        <tbody>{versions.slice(0, 12).map(v => <tr key={v.version}><td className="strong">{v.version}번째</td><td className="nowrap">{v.at.slice(0, 16).replace('T', ' ')}</td><td className="num">{v.lines}</td><td>{v.sources.map(x => SRC[x] ?? x).join(' · ')}</td><td>{v.version === project.model_version && <Badge tone="blue">사용 중</Badge>}</td></tr>)}</tbody></table></div>
    </div>}
    <div className="design-plan-qty" aria-label="투시도 장면">
      <div className="row wrap">
        <b className="t-bodyb">투시도 · 렌더 장면 {scenes.length ? `· 확정 ${done}/${scenes.length}` : ''}</b>
        <span className="t-cap">번호 + 층 + 실 이름으로 적습니다(같은 실의 다른 시점은 -1, -2). 아래층부터, 층 안에서는 동선 순서로.</span>
        <span className="design-gap" />
        {missing.length > 0 && <Button size="sm" kind="outline" disabled={busy} onClick={fromRooms}>실 목록에서 장면 만들기 ({missing.length})</Button>}
      </div>
      <form className="design-add" onSubmit={e => { e.preventDefault(); if (title.trim()) add(title.trim()).then(ok => ok && setTitle('')) }}>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder={`장면 이름 (예: 1F 로비라운지) — ${pad(next)}번으로 들어갑니다`} aria-label="장면 이름" />
        <Button size="sm" disabled={busy || !title.trim()}>장면 추가</Button>
      </form>
      {scenes.length === 0 ? <Empty>아직 장면이 없습니다. 스케치업 · Enscape 에서 뽑은 그림을 장면마다 올려 두면 제안서 · 디자인 보고서에서 같은 순서로 씁니다.</Empty> : (
        <ul className="design-renders">{scenes.map(s => <li key={s.id}>
          <div className="design-render-img">{s.data ? <img src={s.data} alt={`${s.no} ${s.title}`} /> : <span className="t-cap">그림 없음</span>}</div>
          <div className="row"><b className="design-spec-code">{s.no}</b>
            <input className="input" defaultValue={s.title} aria-label={`${s.no} 장면 이름`} onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.title) run(() => api.updateRender(s.id, { title: v })) }} />
            <button type="button" className="design-status" disabled={busy} title="눌러서 초안 ↔ 확정" onClick={() => run(() => api.updateRender(s.id, { status: s.status === 'final' ? 'draft' : 'final' }))}><Badge tone={s.status === 'final' ? 'blue' : 'outline'}>{s.status === 'final' ? '확정' : '초안'}</Badge></button></div>
          <input className="input" type="url" defaultValue={s.original_url ?? ''} placeholder="원본 파일 주소 (드라이브 링크)" aria-label={`${s.no} 원본 주소`} onBlur={e => { const v = e.target.value.trim() || null; if (v !== s.original_url) run(() => api.updateRender(s.id, { original_url: v })) }} />
          <div className="row wrap"><input type="file" accept="image/*" aria-label={`${s.no} 그림 올리기`} disabled={busy} onChange={e => { pick(s, e.target.files?.[0]); e.target.value = '' }} />
            {s.original_url && <a href={s.original_url} target="_blank" rel="noreferrer">원본 열기</a>}<span className="design-gap" />
            <Button size="sm" kind="ghost" disabled={busy} onClick={async () => { if (await confirmDelete(`${s.no} 장면을`)) void run(() => api.deleteRender(s.id)) }} aria-label={`${s.no} 장면 지우기`}>지우기</Button></div>
        </li>)}</ul>
      )}
      <p className="t-cap">여기에는 작게 줄인 미리보기만 보관합니다. 큰 원본은 드라이브에 두고 주소를 적어 주세요.</p>
    </div>
  </>)
}
