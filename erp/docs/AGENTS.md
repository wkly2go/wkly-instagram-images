# AI 에이전트 연결 안내

리서치 에이전트, **WKLY 총괄**(AI 프로젝트 총괄) 같은 AI 팀원은 사람처럼 로그인하지 않고 **연결 키**로 ERP에 기록합니다.
키마다 할 수 있는 일이 정해져 있고(아래 scope), 관리 화면에서 언제든 끊을 수 있습니다.

## 1. 준비 (관리자)

### WKLY 총괄: 한 번에 등록

관리 › **WKLY 총괄 (AI 프로젝트 총괄)** › 이름·메일 확인 › **등록하기**

- AI 팀원 계정(기본 이름 `WKLY 총괄`, 메일 `agent@thewklyn.com`)과 연결 키를 함께 만듭니다.
  같은 메일의 계정이 이미 있으면 그 계정을 AI 팀원으로 바꿔 씁니다. 이 계정으로 로그인할 일은 없습니다.
- 키 권한: `read`, `task`, `daily_report`, `notify`, `research`, `finance`
- 에이전트 환경에 넣을 값 세 개를 **한 번만** 보여 줍니다 (아래 3번).

### 직접 만들 때

1. 관리 › 팀원 관리 › 팀원 추가 → 구분 **AI**, 이름 예) `WKLY 총괄`
   (일일 보고·할 일 배정이 이 이름으로 남습니다.)
2. 관리 › AI 에이전트 연결 키 › **새 키 만들기**
   - 연결할 AI 팀원: 위에서 만든 팀원 (리서치만 하는 에이전트는 비워도 됨)
   - 할 수 있는 일(scope)

| scope | 할 수 있는 일 | 들어가는 곳 |
|---|---|---|
| `read` | 오늘 현황 읽기 (`agent_snapshot`). 금액 없음 | – |
| `finance` | `read` 와 함께 주면 현황에 재무 요약(`finance`)이 붙음. 합계·비율만, 업체·계좌·사람 이름 없음 | – |
| `research` | 리서치 자료 등록 | 자료실 › 새 자료 |
| `contact` | 브랜드 담당자 등록 (같은 이메일이면 빈 칸만 채움, 수신거부·상태는 그대로) | 자료실 › 브랜드 담당자 |
| `task` | 할 일 만들기·배정 (알람 포함) | 내 할 일 · 알림 |
| `daily_report` | 일일 보고 제출 (AI 팀원과 연결된 키만) | 승인 › 일일 보고 |
| `notify` | 알림 보내기 (한 명 또는 관리자 전체) | 종 모양 알림함 |

3. 화면에 **한 번만** 보이는 키를 에이전트 실행 환경의 환경 변수에 넣습니다. 채팅·메일·문서에 붙여 넣지 마세요.

```
WKLY_ERP_URL=https://<프로젝트>.supabase.co
WKLY_ERP_ANON_KEY=<Supabase 공개(anon/publishable) 키>
WKLY_ERP_AGENT_TOKEN=wkly_…
```

service_role(secret) 키는 에이전트에게도 주지 않습니다. 키는 DB에 해시로만 저장됩니다.
키가 새어 나갔다고 생각되면 관리 › AI 에이전트 연결 키에서 **끊기** 후 새로 만드세요.

## 2. 호출 방법

모든 기록은 RPC 두 개로 합니다. 헤더는 공개 키, 본문에 연결 키를 넣습니다.

```bash
# 현황 읽기 (scope: read, 재무 요약은 finance 도 필요)
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

### 재무 요약 `finance` (scope: read + finance)

키에 `finance` 가 있으면 위 결과에 `finance` 가 붙습니다. 금액은 원 단위 정수, 공급가액 = 금액 − VAT, 취소 건은 모두 뺍니다.

```json
"finance": {
  "projects": [{
    "id": "…", "name": "성수 팝업 '오브제 위크'", "status": "진행",
    "contract_amount": 50000000, "budget": 17000000,
    "paid": 9000000, "payable": 8000000, "estimate": 4000000, "cost": 21000000,
    "margin": 29000000, "margin_rate": 58.0, "target_margin": 20,
    "received": 20000000, "receivable": 30000000,
    "overdue_out": { "count": 1, "amount": 7700000 },
    "overdue_in":  { "count": 1, "amount": 33000000 }
  }],
  "over_budget": [
    { "project_id": "…", "project": "성수 팝업 '오브제 위크'", "category": "전기", "budget": 5000000, "spent": 7000000, "over": 2000000 }
  ],
  "next_payment_run": {
    "date": "2026-10-19", "count": 12, "amount": 34500000,
    "waiting":  { "count": 2, "amount": 1650000 },
    "held":     { "count": 1, "amount": 220000 },
    "advances": { "count": 3, "amount": 480000 }
  }
}
```

| 항목 | 뜻 |
|---|---|
| `projects` | 진행·기획 프로젝트 + 미결 결제가 남은 프로젝트 (진행 → 기획 → 보류 → 완료 순) |
| `budget` | 공사 구분별 실행 예산 합계 (없으면 재무 칸의 예산) |
| `paid` / `payable` / `estimate` | 지급 완료 / 지급 남음(예정·청구·대기·보류) / 예상 비용 (공급가액) |
| `cost` | paid + payable + estimate. 지급 건이 하나도 없으면 예산 |
| `margin`, `margin_rate` | 계약액 − cost, 마진율 % (계약액이 없거나 0이면 null). `target_margin` 은 목표 마진 % |
| `received` / `receivable` | 수금 완료 / 받을 돈 (공급가액) |
| `overdue_out` / `overdue_in` | 예정일이 지난 미지급 / 미수금 건수·금액 (VAT 포함) |
| `over_budget` | 예산을 넘은 공사 구분, 초과액 큰 순 최대 10개 |
| `next_payment_run` | 다음 지급일(오늘 포함 첫 월요일)에 이체할 건수·금액(VAT 포함). 화면 **결제 대장 › 이번 주 지급** 과 같은 기준(예정·청구, 대지급 제외). 계좌 정보가 없는 건도 세므로, 화면은 그만큼 '계좌 없음' 경고로 따로 보여 줍니다. `waiting`(대기)·`held`(보류)·`advances`(대지급 정산)는 따로 셉니다 |

### agent_submit payload

| kind | 필수 | 선택 |
|---|---|---|
| `research` | `title` | `kind`(팝업·브랜드·트렌드·경쟁사·인터뷰·기타), `summary`, `body`('기간: …' 처럼 쓰면 화면에서 표로), `source_url`, `source_name`, `brand_name`, `tags`(문자열 배열), `client_id`, `project_id` |
| `contact` | `brand_name`, `email` | `contact_name`, `title`, `phone`, `source_type`(공식 홈페이지·보도자료·명함·미팅·받은 메일·소개·에이전트 리서치·기타), `source_url`, `source_note`, `memo`, `tags`, `client_id`, `research_item_id` |
| `task` | `title` | `assignee_id`, `project_id`, `due_date`(YYYY-MM-DD), `remind_at`(`2026-10-13T09:00` = 한국 시간, 또는 시간대 포함), `status`, `memo`, `source_research_id` |
| `daily_report` | `content` 권장 | `title`(없으면 '일일 보고 날짜'), `date`, `stats` `{active_projects, done_today, overdue, new_research}` |
| `notify` | `title` | `user_id`(없으면 관리자 전체), `kind`(할 일·알람·승인·일일 보고·멘션·시스템·결제), `body`(2,000자), `link`('/'로 시작하는 앱 경로) |

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
· 성수 팝업: 예산 넘은 공사 구분 1곳 · 받을 돈 연체 1건 — 관리자 알림으로 보냄
· 철수 업체 견적 회신 없음 — 김하늘 확인

■ 내일 할 일 (배정 완료)
· 김하늘 — 팝업 철수 일정 협의 ⏰ 10:00

■ 새로 모은 자료 활용 제안
· 플랜트 하우스 팝업 → 주간 핫 마케팅 후보 · 협업 담당 이메일 확보
```

### 돈 이야기는 관리자 알림으로만

일일 보고는 승인 담당(관리 › 승인 담당 설정)이 보는데, 담당이 관리자가 아닐 수도 있습니다.
그래서 **금액·마진율은 일일 보고에 쓰지 않고** `notify`(user_id 없이 → 관리자 전체, kind `결제`)로 보냅니다.
일일 보고에는 "예산 넘은 공사 구분 1곳 — 관리자 알림으로 보냄"처럼 건수만 씁니다.

```json
{"p_kind": "notify", "p_payload": {
  "kind": "결제", "title": "재무 확인 3건",
  "body": "· 성수 팝업 전기 예산 +200만 (140%)\n· 성수 팝업 받을 돈 연체 1건 3,300만\n· 다음 월요일(10/19) 이체 12건 3,450만 · 대기 2건",
  "link": "/projects?view=payments&sub=check"}}
```

이체 목록은 `/projects?view=payments&sub=run`, 점검은 `/projects?view=payments&sub=check`, 대시보드는 `/projects` 입니다.

## 4. 사람이 총괄을 맡을 때

승인 › 승인 요청 › 종류 **일일 보고** 를 고르면 오늘 숫자가 채워진 같은 형식의 초안이 나옵니다.
받는 사람은 관리 › 승인 담당 설정의 '일일 보고' 담당자로 자동 지정됩니다.

## 5. 일정 (예시)

| 시각 (KST) | 할 일 |
|---|---|
| 08:30 | `agent_snapshot` → 오늘 마감·지연 확인 → 팀원별 할 일 배정(`task`, 필요하면 `remind_at`). 월요일엔 이번 주 이체 건수·금액을 관리자에게 `notify` |
| 수시 | 리서치 에이전트가 `research`·`contact` 등록 → WKLY 총괄이 쓸 만한 자료를 할 일로 |
| 18:00 | `agent_snapshot` 다시 읽고 `daily_report` 제출 + 재무 위험이 있으면 관리자에게 `notify` |

서버의 알람(5분마다)·매일 09:00 요약은 Supabase `pg_cron` 이 보냅니다. pg_cron 을 켜지 않았으면
누군가 ERP를 열어 둔 동안 1분마다 확인합니다.

## 6. Claude 예약 작업(루틴)으로 WKLY 총괄 돌리기

1. 관리 화면에서 WKLY 총괄을 등록하고, 한 번만 보이는 값 세 개를 복사합니다.
2. 에이전트가 돌 Claude 클라우드 환경 설정(세션 제목줄의 환경 메뉴 › Edit)에서 세 값을 **이름 그대로 환경 변수**로 넣습니다.
3. 같은 화면 **Network access** 를 Limited 로 두고 **Allowed domains** 에 `<프로젝트>.supabase.co` 를 추가합니다
   (Allow package managers 체크는 그대로). 자세한 단계: https://code.claude.com/docs/en/cloud-environments#network-access
4. 그 환경의 Claude에게 "WKLY 총괄 ERP 루틴 만들어줘"라고 요청하면 평일 08:30 배정·18:00 일일 보고 예약 작업을 만듭니다.
   스킬: `docs/skills/wkly-project-manager/SKILL.md`
5. 첫 실행 뒤 관리 › WKLY 총괄 칸이 '연결됨'으로 바뀌고 '마지막 사용'·'마지막 일일 보고' 시각이 보이면 연결된 것입니다.
