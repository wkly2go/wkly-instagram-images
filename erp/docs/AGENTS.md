# AI 에이전트 연결 안내

리서치 에이전트, 프로젝트 총괄 매니저 같은 AI 팀원은 사람처럼 로그인하지 않고 **연결 키**로 ERP에 기록합니다.
키마다 할 수 있는 일이 정해져 있고(아래 scope), 관리 화면에서 언제든 끊을 수 있습니다.

## 1. 준비 (관리자)

1. 관리 › 팀원 관리 › 팀원 추가 → 구분 **AI**, 이름 예) `총괄 매니저`
   (일일 보고·할 일 배정이 이 이름으로 남습니다. 이 계정으로 로그인할 일은 없습니다.)
2. 관리 › AI 에이전트 연결 키 › **새 키 만들기**
   - 연결할 AI 팀원: 위에서 만든 팀원 (리서치만 하는 에이전트는 비워도 됨)
   - 할 수 있는 일(scope)

| scope | 할 수 있는 일 | 들어가는 곳 |
|---|---|---|
| `read` | 오늘 현황 읽기 (`agent_snapshot`) — 금액 정보 없음 | – |
| `research` | 리서치 자료 등록 | 자료실 › 새 자료 |
| `contact` | 브랜드 담당자 등록 (같은 이메일이면 빈 칸만 채움, 수신거부·상태는 그대로) | 자료실 › 브랜드 담당자 |
| `task` | 할 일 만들기·배정 (알람 포함) | 내 할 일 · 알림 |
| `daily_report` | 일일 보고 제출 (AI 팀원과 연결된 키만) | 승인 › 일일 보고 |
| `notify` | 알림 보내기 (한 명 또는 관리자 전체) | 종 모양 알림함 |

3. 화면에 **한 번만** 보이는 키를 에이전트 실행 환경의 비밀 설정에 넣습니다. 채팅·메일·문서에 붙여 넣지 마세요.

```
WKLY_ERP_URL=https://<프로젝트>.supabase.co
WKLY_ERP_ANON_KEY=<Supabase 공개(anon/publishable) 키>
WKLY_ERP_AGENT_TOKEN=wkly_…
```

service_role(secret) 키는 에이전트에게도 주지 않습니다. 키는 DB에 해시로만 저장됩니다.

## 2. 호출 방법

모든 기록은 RPC 두 개로 합니다. 헤더는 공개 키, 본문에 연결 키를 넣습니다.

```bash
# 현황 읽기 (scope: read)
curl -s "$WKLY_ERP_URL/rest/v1/rpc/agent_snapshot" \
  -H "apikey: $WKLY_ERP_ANON_KEY" -H "Authorization: Bearer $WKLY_ERP_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_token\":\"$WKLY_ERP_AGENT_TOKEN\"}"

# 기록 (scope: kind 와 같은 이름)
curl -s "$WKLY_ERP_URL/rest/v1/rpc/agent_submit" \
  -H "apikey: $WKLY_ERP_ANON_KEY" -H "Authorization: Bearer $WKLY_ERP_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_token\":\"$WKLY_ERP_AGENT_TOKEN\",\"p_kind\":\"research\",\"p_payload\":{...}}"
```

응답: `{"ok": true, "kind": "...", "id": "..."}` (contact 는 `created`, notify 는 `count` 추가)
오류: `28000` 키 문제(없음·끊김·연결 팀원 비활성) · `42501` scope 없음 · `22023` 입력값 문제 (메시지에 이유가 한국어로 옵니다)

### agent_snapshot 결과

```json
{
  "today": "2026-10-12",
  "projects": [{ "id": "…", "name": "성수 팝업 '오브제 위크'", "status": "진행", "owner": "김하늘", "end_date": "2026-10-26" }],
  "tasks": [{ "id": "…", "title": "…", "status": "할 일", "due_date": "2026-10-13", "overdue": false, "assignee": "김하늘", "project_id": "…", "project": "…" }],
  "pending_approvals": { "업무 보고": 2, "지출": 1 },
  "work_logs_today": [{ "user_id": "…", "name": "김하늘", "count": 3 }],
  "new_research": 5
}
```

`tasks` 는 7일 안에 마감이거나 지난 미완료 할 일입니다. 팀원에게 할 일을 줄 때는 `work_logs_today[].user_id` 를 `assignee_id` 로 씁니다.

### agent_submit payload

| kind | 필수 | 선택 |
|---|---|---|
| `research` | `title` | `kind`(팝업·브랜드·트렌드·경쟁사·인터뷰·기타), `summary`, `body`('기간: …' 처럼 쓰면 화면에서 표로), `source_url`, `source_name`, `brand_name`, `tags`(문자열 배열), `client_id`, `project_id` |
| `contact` | `brand_name`, `email` | `contact_name`, `title`, `phone`, `source_type`(공식 홈페이지·보도자료·명함·미팅·받은 메일·소개·에이전트 리서치·기타), `source_url`, `source_note`, `memo`, `tags`, `client_id`, `research_item_id` |
| `task` | `title` | `assignee_id`, `project_id`, `due_date`(YYYY-MM-DD), `remind_at`(`2026-10-13T09:00` = 한국 시간, 또는 시간대 포함), `status`, `memo`, `source_research_id` |
| `daily_report` | `content` 권장 | `title`(없으면 '일일 보고 날짜'), `date`, `stats` `{active_projects, done_today, overdue, new_research}` |
| `notify` | `title` | `user_id`(없으면 관리자 전체), `kind`(할 일·알람·승인·일일 보고·멘션·시스템·결제), `body`, `link`('/'로 시작하는 앱 경로) |

글자 수는 항목별 최대 길이로 잘리고, payload 전체는 10만 자까지입니다.

## 3. 일일 보고 형식

`■ 소제목` 줄은 화면에서 소제목이 되고, `· 프로젝트명 (할 일 3/5) — 메모` 줄은 진행 막대로 그려집니다.
`stats` 를 보내면 위쪽 숫자 칸이 됩니다.

```
■ 오늘 요약
진행 프로젝트 2 · 오늘 완료한 할 일 4 · 지연 1 · 새 리서치 3

■ 프로젝트별 현황
· 성수 팝업 '오브제 위크' (할 일 4/9) — 철수 일정 안내 완료, 10/26 철수 준비
· 가을 시즌 인스타 캠페인 (할 일 2/4) — 릴스 3편 추가 확정

■ 이슈 · 리스크
· 루프앤코 중도금 입금 5일 지연 — 관리자 확인 필요

■ 내일 할 일 (배정 완료)
· 김하늘 — 팝업 철수 일정 협의 ⏰ 10:00

■ 새로 모은 자료 활용 제안
· 플랜트 하우스 팝업 → 주간 핫 마케팅 후보 · 협업 담당 이메일 확보
```

금액(계약액·결제)은 에이전트에게 열려 있지 않습니다. 돈 이야기는 "중도금 입금 지연"처럼 사람이 쓴 할 일·업무 일지에 있는 사실만 옮깁니다.

## 4. 사람이 총괄을 맡을 때

승인 › 승인 요청 › 종류 **일일 보고** 를 고르면 오늘 숫자가 채워진 같은 형식의 초안이 나옵니다.
받는 사람은 관리 › 승인 담당 설정의 '일일 보고' 담당자로 자동 지정됩니다.

## 5. 일정 (예시)

| 시각 (KST) | 할 일 |
|---|---|
| 08:30 | `agent_snapshot` → 오늘 마감·지연 확인 → 팀원별 할 일 배정(`task`, 필요하면 `remind_at`) |
| 수시 | 리서치 에이전트가 `research`·`contact` 등록 → 총괄 매니저가 쓸 만한 자료를 할 일로 |
| 18:00 | `agent_snapshot` 다시 읽고 `daily_report` 제출 |

서버의 알람(5분마다)·매일 09:00 요약은 Supabase `pg_cron` 이 보냅니다. pg_cron 을 켜지 않았으면
누군가 ERP를 열어 둔 동안 1분마다 확인합니다.

에이전트용 스킬 초안: `docs/skills/wkly-project-manager/SKILL.md`
