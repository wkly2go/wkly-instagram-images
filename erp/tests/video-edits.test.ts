import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { folderLabel, videoInputProblem, workerState } from '../src/lib/videoEdits.ts'

// 영상 편집 요청 (2026-11-27): 인트라넷은 요청만 쌓고, 맥 작업 처리기가 열쇠로 정해진 함수만 부른다
const sql = readFileSync(new URL('../supabase/migrations/20261127160000_video_edit_jobs.sql', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../tools/video-worker/worker.mjs', import.meta.url), 'utf8')

test('작업 처리기는 5분 안에 다녀갔을 때만 켜진 것으로 본다', () => {
  const now = Date.parse('2026-11-27T07:00:00Z')
  assert.equal(workerState(null, now), 'never')
  assert.equal(workerState('2026-11-27T06:57:00Z', now), 'on')
  assert.equal(workerState('2026-11-27T06:40:00Z', now), 'off')
})

test('촬영 폴더 이름: 끝이 "원본"이면 한 단계 위 이름을 함께 보여 준다', () => {
  const l = folderLabel('#WKLY_2026/01. 매거진 촬영본/11월/성수/4주차_팝업/원본')
  assert.equal(l.name, '4주차_팝업 / 원본')
  assert.match(l.parent, /성수$/)
  assert.equal(folderLabel('#WKLY_2026/03. 영상 제작/인터뷰').name, '인터뷰')
})

test('요청은 제목과 폴더가 있어야 한다', () => {
  const base = { title: '성수', source_folder: 'a/b', template: 'cuts' as const, instructions: '', target_seconds: 20 }
  assert.equal(videoInputProblem(base), null)
  assert.match(videoInputProblem({ ...base, title: ' ' })!, /제목/)
  assert.match(videoInputProblem({ ...base, source_folder: '' })!, /폴더/)
})

test('표는 로그인 없는 사람에게 닫혀 있고, 팀원은 넣기만 (고치기는 서버 함수로만)', () => {
  assert.match(sql, /revoke all on public\.video_edit_jobs, public\.video_source_folders from anon/)
  assert.match(sql, /grant select, insert on public\.video_edit_jobs to authenticated/)
  assert.doesNotMatch(sql, /grant[^;]*update[^;]*video_edit_jobs/)
  assert.match(sql, /status = '대기'\s+and worker is null and plan is null/)
})

test('작업 처리기 함수는 모두 열쇠를 먼저 확인한다', () => {
  for (const name of ['agent_video_folders_save', 'agent_video_job_claim', 'agent_video_job_finish', 'agent_video_job_check']) {
    const at = sql.indexOf(`function public.${name}`)
    const body = sql.slice(at, sql.indexOf('end $$;', at))
    assert.match(body, /begin\s+perform public\.agent_token_check\(p_token, 'video_worker'\)/, name)
  }
  const token = readFileSync(new URL('../supabase/migrations/20261127161000_video_worker_token.sql', import.meta.url), 'utf8')
  assert.match(token, /private\.video_worker_check\(p_token\)/)
})

test('작업 처리기: 원본은 읽기만 · 완성본은 편집본 폴더에 새 파일 · 음악 없음 · 허용 폴더 밖은 거절', () => {
  assert.doesNotMatch(worker, /fs\.(unlink|rm)\((?!tmp)/)
  assert.match(worker, /COPYFILE_EXCL/)
  assert.match(worker, /'-an'/)
  assert.match(worker, /rel\.includes\('\.\.'\)/)
  assert.match(worker, /허용된 촬영 폴더가 아닙니다/)
})

test('끝난 요청은 만든 사람에게만 알리고 제목에 금액이 없다', () => {
  assert.match(sql, /perform public\.notify\(v_job\.created_by, '시스템',\s+case when v_ok then '영상 편집 완료' else '영상 편집 실패' end/)
})
