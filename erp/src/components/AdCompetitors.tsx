// 경쟁사 추적 (2026-11-20 · 광고 자동 운영 3단계) — 광고·콘텐츠 › 리서치·검색 › 경쟁사 분석 맨 위
// 서버가 매일 06:53 경쟁사 · 우리 계정의 네이버 블로그 글 · 유튜브 영상(조회수)을 모으고, 화면은 계산식으로 비교한다(AI 없음).
// 주제 제안 → '이 주제로 한 번에 만들기'(캠페인 준비의 한 번에 만들기에 주제를 채워 엶) — 사람은 고르고 승인만.
import { useState } from 'react'
import { ExternalLink, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel, shortDate } from '../lib/date'
import { Link } from '../lib/router'
import { adLibraryUrl, cadenceNote, cleanInstagramHandle, cleanNaverBlogId, cleanYoutubeHandle, competitorStats, topicIdeas, type Competitor, type CompetitorPost } from '../lib/competitorDigest'
import type { CompetitorInput } from '../lib/competitorApi'
import { ask } from './Ask'
import { Button, SectionHead } from './ui'
import './AdCompetitors.css'

const EMPTY: CompetitorInput = { name: '', brand: 'wkly', is_self: false, homepage: null, naver_blog_id: null, youtube_handle: null, instagram_handle: null, note: '', active: true }
const num = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString('ko-KR'))

export function AdCompetitors() {
  const { api, me, version, bump, toast } = useApp()
  const admin = me.role === 'admin'
  const data = useAsync(() => api.listCompetitors().catch(() => ({ competitors: [] as Competitor[], posts: [] as CompetitorPost[] })), [api, version], { competitors: [] as Competitor[], posts: [] as CompetitorPost[] })
  const [edit, setEdit] = useState<{ id: string | null; v: CompetitorInput; raw: { blog: string; yt: string; ig: string } } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { competitors, posts } = data.data
  const stats = competitorStats(competitors, posts)
  const ideas = topicIdeas(competitors, posts)
  const cadence = cadenceNote(stats)
  const byId = new Map(competitors.map(c => [c.id, c]))
  const recentTop = [...posts].filter(p => !byId.get(p.competitor_id)?.is_self).sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.published_at ?? '').localeCompare(a.published_at ?? '')).slice(0, 8)

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try { await fn(); if (ok) toast(ok); bump() } catch (e) { toast(e instanceof Error ? e.message : '처리하지 못했습니다.') } finally { setBusy(null) }
  }
  const open = (c?: Competitor) => setEdit(c
    ? { id: c.id, v: { name: c.name, brand: c.brand, is_self: c.is_self, homepage: c.homepage, naver_blog_id: c.naver_blog_id, youtube_handle: c.youtube_handle, instagram_handle: c.instagram_handle, note: c.note, active: c.active }, raw: { blog: c.naver_blog_id ?? '', yt: c.youtube_handle ?? '', ig: c.instagram_handle ?? '' } }
    : { id: null, v: { ...EMPTY }, raw: { blog: '', yt: '', ig: '' } })
  const save = () => edit && run('save', async () => {
    const v = { ...edit.v, name: edit.v.name.trim(), homepage: edit.v.homepage?.trim() || null,
      naver_blog_id: edit.raw.blog.trim() ? cleanNaverBlogId(edit.raw.blog) : null,
      youtube_handle: edit.raw.yt.trim() ? cleanYoutubeHandle(edit.raw.yt) : null,
      instagram_handle: edit.raw.ig.trim() ? cleanInstagramHandle(edit.raw.ig) : null }
    if (!v.name) throw new Error('이름을 넣어 주세요.')
    if (edit.raw.blog.trim() && !v.naver_blog_id) throw new Error('네이버 블로그 주소를 확인해 주세요. (blog.naver.com/아이디)')
    if (edit.raw.yt.trim() && !v.youtube_handle) throw new Error('유튜브 주소를 확인해 주세요. (youtube.com/@핸들)')
    if (v.homepage && !/^https?:\/\//.test(v.homepage)) throw new Error('홈페이지는 https:// 로 시작해야 합니다.')
    const id = await api.saveCompetitor(edit.id, v)
    setEdit(null)
    if (v.naver_blog_id || v.youtube_handle) { const r = await api.refreshCompetitor(id); toast(r.error ? `저장했습니다. 받기 일부 실패: ${r.error}` : `저장하고 블로그 ${r.blog} · 영상 ${r.youtube}건을 받았습니다.`) }
  })

  return (
    <section className="cmp" aria-label="경쟁사 추적">
      <SectionHead title="경쟁사 추적 (자동)" count={competitors.length || undefined}
        right={admin ? <Button size="sm" onClick={() => open()}><Plus size={13} /> 추가</Button> : undefined} />
      <p className="cmp-note">매일 아침 경쟁사와 우리 계정의 네이버 블로그 글 · 유튜브 영상(조회수)을 자동으로 모아 비교합니다. 메타 광고는 한국 일반 광고를 API 로 주지 않아 '광고 보기' 링크로 직접 확인합니다.{admin ? ' 우리 계정도 \'우리 회사\'로 하나 넣어 두면 차이를 계산합니다.' : ''}</p>

      {edit && (
        <div className="cmp-form">
          <div className="cmp-grid">
            <label><span>이름 *</span><input value={edit.v.name} maxLength={60} onChange={e => setEdit({ ...edit, v: { ...edit.v, name: e.target.value } })} placeholder="예: OO 팝업 에이전시" /></label>
            <label><span>구분</span><select value={edit.v.brand} onChange={e => setEdit({ ...edit, v: { ...edit.v, brand: e.target.value as CompetitorInput['brand'] } })}><option value="wkly">더위클리 경쟁</option><option value="arterior">아트리어 경쟁</option><option value="both">둘 다</option></select></label>
            <label><span>네이버 블로그</span><input value={edit.raw.blog} onChange={e => setEdit({ ...edit, raw: { ...edit.raw, blog: e.target.value } })} placeholder="blog.naver.com/아이디 주소 그대로" /></label>
            <label><span>유튜브</span><input value={edit.raw.yt} onChange={e => setEdit({ ...edit, raw: { ...edit.raw, yt: e.target.value } })} placeholder="youtube.com/@핸들 주소 그대로" /></label>
            <label><span>인스타그램 (링크만)</span><input value={edit.raw.ig} onChange={e => setEdit({ ...edit, raw: { ...edit.raw, ig: e.target.value } })} placeholder="instagram.com/계정" /></label>
            <label><span>홈페이지</span><input value={edit.v.homepage ?? ''} onChange={e => setEdit({ ...edit, v: { ...edit.v, homepage: e.target.value } })} placeholder="https://" /></label>
            <label className="wide"><span>메모</span><input value={edit.v.note} maxLength={500} onChange={e => setEdit({ ...edit, v: { ...edit.v, note: e.target.value } })} placeholder="강점 · 주 고객 등" /></label>
          </div>
          <div className="cmp-form-act">
            <label className="cmp-check"><input type="checkbox" checked={edit.v.is_self} onChange={e => setEdit({ ...edit, v: { ...edit.v, is_self: e.target.checked } })} /> 우리 회사 계정 (비교 기준)</label>
            <label className="cmp-check"><input type="checkbox" checked={edit.v.active} onChange={e => setEdit({ ...edit, v: { ...edit.v, active: e.target.checked } })} /> 매일 받기</label>
            <span className="grow" />
            <Button kind="outline" size="sm" onClick={() => setEdit(null)}>취소</Button>
            <Button size="sm" disabled={busy === 'save'} onClick={() => void save()}>{busy === 'save' ? '저장 · 받는 중…' : '저장하고 받기'}</Button>
          </div>
        </div>
      )}

      {competitors.length === 0 ? <p className="cmp-note">{data.loading ? '불러오는 중…' : admin ? "아직 등록된 곳이 없습니다. '추가'로 경쟁사와 우리 계정을 넣어 주세요." : '관리자가 경쟁사를 등록하면 여기에 비교가 나옵니다.'}</p> : (
        <>
          {cadence && <p className="cmp-cadence">{cadence}</p>}
          <div className="cmp-table-wrap">
            <table className="cmp-table">
              <thead><tr><th>이름</th><th>30일 글</th><th>주당</th><th>블로그 · 영상</th><th>영상 평균 조회</th><th>가장 반응 좋은 글</th><th>보기</th>{admin && <th />}</tr></thead>
              <tbody>
                {stats.map(s => {
                  const c = byId.get(s.id)!
                  return (
                    <tr key={s.id} className={s.isSelf ? 'self' : ''}>
                      <td><b>{s.name}</b>{s.isSelf && <span className="cmp-self">우리</span>}{!c.active && <span className="tx-sub"> (멈춤)</span>}{c.last_error && <div className="cmp-err">{c.last_error}</div>}<div className="tx-sub">{c.last_checked_at ? `받음 ${dateTimeLabel(c.last_checked_at)}` : '아직 안 받음'}</div></td>
                      <td className="n">{s.posts30}</td>
                      <td className="n">{s.perWeek}</td>
                      <td className="n">{s.blog30} · {s.video30}</td>
                      <td className="n">{num(s.avgViews)}</td>
                      <td>{s.top ? <a href={s.top.url} target="_blank" rel="noreferrer">{s.top.title}</a> : '–'}{s.top?.views != null && <span className="tx-sub"> · 조회 {num(s.top.views)}</span>}</td>
                      <td className="cmp-links">
                        {!s.isSelf && <a href={adLibraryUrl(c.name)} target="_blank" rel="noreferrer">광고 보기 <ExternalLink size={12} /></a>}
                        {c.instagram_handle && <a href={`https://www.instagram.com/${c.instagram_handle}/`} target="_blank" rel="noreferrer">인스타</a>}
                        {c.homepage && <a href={c.homepage} target="_blank" rel="noreferrer">홈페이지</a>}
                      </td>
                      {admin && <td className="cmp-act">
                        <button type="button" className="icon-btn" title="지금 받기" disabled={!!busy} onClick={() => void run(c.id, async () => { const r = await api.refreshCompetitor(c.id); toast(r.error ? `일부 실패: ${r.error}` : `블로그 ${r.blog} · 영상 ${r.youtube}건 받음`) })}><RefreshCw size={14} /></button>
                        <button type="button" className="icon-btn" title="고치기" onClick={() => open(c)}><Pencil size={14} /></button>
                        <button type="button" className="icon-btn" title="지우기" disabled={!!busy} onClick={() => void run('del', async () => { if (!(await ask(`'${c.name}'과 모은 글을 지울까요?`))) throw new Error('지우지 않았습니다.'); await api.deleteCompetitor(c.id) }, '지웠습니다.')}><Trash2 size={14} /></button>
                      </td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <SectionHead title="주제 제안 — 경쟁사는 쓰는데 우리는 안 쓴 낱말" />
          {ideas.length === 0 ? <p className="cmp-note">지난 30일 경쟁사 2곳 이상이 함께 쓴 낱말이 아직 없습니다. 등록한 곳이 늘고 글이 쌓이면 나옵니다.</p> : (
            <ul className="cmp-ideas">
              {ideas.map(i => (
                <li key={i.word}>
                  <div><b>{i.word}</b> <span className="tx-sub">{i.count}번 · {i.owners.join(', ')}</span></div>
                  <a className="tx-sub cmp-ex" href={i.example.url} target="_blank" rel="noreferrer">예: {i.example.title}</a>
                  <Link className="btn btn-outline btn-sm" to={`/ads?tab=studio&topic=${encodeURIComponent(`${i.word} — 경쟁사들이 다루는 주제를 더위클리 관점으로 (참고: ${i.example.title})`)}`}><Sparkles size={13} /> 이 주제로 한 번에 만들기</Link>
                </li>
              ))}
            </ul>
          )}

          {recentTop.length > 0 && <>
            <SectionHead title="경쟁사 반응 좋은 글 · 영상" />
            <ul className="cmp-posts">
              {recentTop.map(p => (
                <li key={p.id}>
                  <span className="cmp-src">{p.source === 'youtube' ? '영상' : '블로그'}</span>
                  <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a>
                  <span className="tx-sub">{byId.get(p.competitor_id)?.name} · {p.published_at ? shortDate(p.published_at.slice(0, 10)) : ''}{p.views != null ? ` · 조회 ${num(p.views)}` : ''}</span>
                </li>
              ))}
            </ul>
          </>}
        </>
      )}
    </section>
  )
}
