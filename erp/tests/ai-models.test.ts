import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 2026-11-23 대표 지시 '내 비서만 오퍼스로 하고 나머지는 소넷으로 지정해'
const chat = readFileSync(new URL('../supabase/functions/agent-chat/index.ts', import.meta.url), 'utf8')
const sql = readFileSync(new URL('../supabase/migrations/20261123150000_models_sonnet_except_ceo_secretary.sql', import.meta.url), 'utf8')

test('채팅 AI: 기본은 소넷 · 오퍼스는 ai_agents.model 이 꼼꼼일 때만', () => {
  assert.match(chat, /const MODEL_CHAT = 'claude-sonnet-5-5'/)
  assert.match(chat, /if \(ctx\.custom\?\.model === '꼼꼼'\) model = MODEL_INSTRUCTION/)
  // 어느 호출도 오퍼스를 직접 고르지 않는다 (지시 · 예약 경로 포함)
  assert.equal((chat.match(/MODEL_INSTRUCTION/g) ?? []).length, 2)
})

test('자료: API 에이전트는 모두 소넷 · 꼼꼼은 대표의 개인 비서만', () => {
  assert.doesNotMatch(sql, /\bdrop\s|\bdelete\s/i)
  assert.match(sql, /update public\.api_agents set model = 'claude-sonnet-5-5'/)
  assert.match(sql, /set model = '꼼꼼'[\s\S]*a\.private[\s\S]*o\.title = '대표'/)
  assert.match(sql, /set model = '기본'[\s\S]*and not \(a\.private and exists/)
})
