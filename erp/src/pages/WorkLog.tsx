import { UserPic } from '../components/UserPic'
import { useMemo, useState, type ReactNode } from "react";
import { Linkify } from '../components/ui'
import { ChevronLeft, ChevronRight, ListTodo, Pencil, Search, Trash2, StickyNote } from "lucide-react";
import { useAction, useApp, useAsync } from "../lib/app";
import {
  addDays,
  addMonths,
  dateLabel,
  minutesLabel,
  shortDate,
  timeLabel,
  todayKey,
  weekday,
} from "../lib/date";
import { Link, useRouter, withQuery } from "../lib/router";
import { presenceOf, useAttendance } from "../lib/attendance";
import type { Approval, Client, Project, Task, WorkLog as Log } from "../lib/types";
import { Board, BoardHead, type BoardCol } from "../components/Board";
import { LogComposer, isMail } from "../components/LogForm";
import { usePanelWide, useRightPanel } from "../components/RightPanel";
import {
  Badge,
  Button,
  Chip,
  Empty,
  Field,
  KindBadge,
  Modal,
  TodayBadge,
} from "../components/ui";
import { NewApproval } from "./Approvals";
import { AssignTaskButton } from "../components/AssignTask";
import { MemoPad } from "../components/MemoPad";
import { PendingReports, ReportCheck, WorkTodo, reportDate, useWorkReports } from "../components/WorkReports";
import { ask } from '../components/Ask'

const SIDE_KEY = "wkly-work-side";
type Period = "day" | "month" | "year";
type Side = "todo" | "memo" | "none";

/** 기간 범위: 일 = 그날, 월 = 그 달, 년 = 그 해 */
function rangeOf(period: Period, date: string): [string, string] {
  if (period === "day") return [date, date];
  if (period === "month") return [`${date.slice(0, 7)}-01`, addDays(`${addMonths(date.slice(0, 7), 1)}-01`, -1)];
  return [`${date.slice(0, 4)}-01-01`, `${date.slice(0, 4)}-12-31`];
}

/** 업무 (업무·근태 탭에 통합, 대표 지시 2026-10-18): 왼쪽 사람 목록 + 업무 기록, 할 일 · 메모장은 아래에서 펼침 */
export function WorkPane({ tabs }: { tabs?: ReactNode }) {
  const { api, me, version, profileOf, profileName, profiles } = useApp();
  const { query, path, navigate } = useRouter();
  const today = todayKey();
  const date = query.get("date") || today;
  const period = (query.get("period") as Period | null) ?? "day";
  const q = query.get("q") ?? "";
  const userParam = query.get("user");
  const team = query.get("team") === "1" && !userParam;
  const viewUser = userParam ?? (team ? undefined : me.id);
  const other = userParam && userParam !== me.id ? profileOf(userParam) : undefined;
  const attendance = useAttendance();
  const [reporting, setReporting] = useState(false);
  const [editLog, setEditLog] = useState<Log | null>(null);
  const [memoLog, setMemoLog] = useState<Log | null>(null);
  const [side, setSideState] = useState<Side>(() => {
    try {
      return (localStorage.getItem(SIDE_KEY) as Side | null) ?? "todo";
    } catch {
      return "todo";
    }
  });
  const setSide = (v: Side) => {
    setSideState(v);
    try {
      localStorage.setItem(SIDE_KEY, v);
    } catch {
      /* noop */
    }
  };
  const { run } = useAction();
  const [from, to] = rangeOf(period, date);
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true });

  const { data } = useAsync(
    async () => {
      const [logs, periodLogs, clients, projects, tasks] = await Promise.all([
        api.listWorkLogs({ from, to, userId: viewUser, q: q || undefined, limit: period === "day" ? undefined : 2000 }),
        // 왼쪽 팀원 목록의 건수
        api.listWorkLogs({ from, to, limit: 5000 }),
        api.listClients(),
        api.listProjects(),
        api.listTasks(),
      ]);
      return { logs, periodLogs, clients, projects, tasks };
    },
    [version, from, to, viewUser, q, period],
    { logs: [] as Log[], periodLogs: [] as Log[], clients: [] as Client[], projects: [] as Project[], tasks: [] as Task[] },
  );
  const { data: reports } = useWorkReports();
  const clientName = (id: string | null) => data.clients.find((c) => c.id === id)?.name;
  const projectName = (id: string | null) => data.projects.find((p) => p.id === id)?.name;
  const total = data.logs.reduce((s, l) => s + (l.minutes ?? 0), 0);
  const periodReports = reports.filter((a) => {
    const d = reportDate(a);
    return d >= from && d <= to && (!viewUser || a.requested_by === viewUser);
  });
  const byDate = useMemo(() => {
    const m = new Map<string, Log[]>();
    for (const l of data.logs) m.set(l.log_date, [...(m.get(l.log_date) ?? []), l]);
    return [...m.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [data.logs]);
  const shift = (n: number) => go({ date: period === "day" ? addDays(date, n) : period === "month" ? `${addMonths(date.slice(0, 7), n)}-01` : `${Number(date.slice(0, 4)) + n}-01-01` });
  const label = period === "day" ? dateLabel(date) : period === "month" ? `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월` : `${date.slice(0, 4)}년`;
  const canNext = period === "day" ? date < today : period === "month" ? date.slice(0, 7) < today.slice(0, 7) : date.slice(0, 4) < today.slice(0, 4);

  const toTask = (l: Log) =>
    run(
      () =>
        api.saveTask({
          title: l.content.split("\n")[0].slice(0, 80),
          memo: l.content.length > 80 ? l.content : null,
          project_id: l.project_id,
          assignee_id: me.id,
          due_date: today,
          status: "할 일",
        }),
      l.project_id ? `할 일로 만들었습니다 (${projectName(l.project_id) ?? "프로젝트"}).` : "할 일로 만들었습니다.",
    );

  // 게시판 줄: 번호 · 시각 · 구분 · 내용 · 거래처 · 프로젝트 · 작성자 · 시간 · 버튼
  const logCols: BoardCol<Log>[] = [
    { key: 'when', label: period === "day" ? "시각" : "날짜", width: period === "day" ? 60 : 110, cell: l => <span className="t-meta">{period !== "day" ? `${shortDate(l.log_date)} ` : ""}{timeLabel(l.created_at)}</span> },
    { key: 'kind', label: "구분", width: 76, cell: l => <KindBadge kind={l.kind} /> },
    {
      key: 'content',
      label: "내용",
      kind: 'title',
      cell: l => (
        <>
          <span className="cell-pre t-small t-blue">{l.content}</span>
          {l.memo && (
            <span className="log-memo cell-pre" title="메모">
              <StickyNote size={12} style={{ verticalAlign: -2 }} aria-hidden="true" /> <Linkify text={l.memo} />
            </span>
          )}
          {isMail(l.kind) && (l.email_counterpart || l.email_subject) && (
            <span className="cell-sub">
              {l.kind === "메일 발신" ? "받는 사람" : "보낸 사람"} {l.email_counterpart || "-"}
              {l.email_subject ? ` · ${l.email_subject}` : ""}
            </span>
          )}
        </>
      ),
    },
    { key: 'client', label: "거래처", width: 120, hideNarrow: true, cell: l => (l.client_id ? <span onClick={e => e.stopPropagation()}><Link to={`/clients?id=${l.client_id}`}>{clientName(l.client_id) ?? "거래처"}</Link></span> : "-") },
    { key: 'project', label: "프로젝트", width: 150, hideNarrow: true, cell: l => (l.project_id ? <span onClick={e => e.stopPropagation()}><Link to={`/projects?id=${l.project_id}`}>{projectName(l.project_id) ?? "프로젝트"}</Link></span> : "-") },
    { key: 'who', label: "작성자", width: 72, cell: l => profileName(l.user_id) },
    { key: 'min', label: "시간", width: 56, kind: 'num', cell: l => (l.minutes ? `${l.minutes}분` : "-") },
    {
      key: 'act',
      label: "",
      width: 108,
      kind: 'center',
      cell: l => (
        <>
          {(l.user_id === me.id || me.role === "admin") && (
            <button type="button" className={`icon-btn sm${l.memo ? " on" : ""}`} aria-label="메모" title={l.memo ? "메모 고치기" : "메모 추가"} onClick={e => { e.stopPropagation(); setMemoLog(l); }}>
              <StickyNote size={13} />
            </button>
          )}
          {l.user_id === me.id && (
            <button type="button" className="icon-btn sm" aria-label="할 일로 만들기" title="이 기록으로 할 일 만들기 (같은 프로젝트에 연결)" onClick={() => toTask(l)}>
              <ListTodo size={13} />
            </button>
          )}
          {(l.user_id === me.id || me.role === "admin") && (
            <button type="button" className="icon-btn sm" aria-label="기록 수정" title="수정" onClick={e => { e.stopPropagation(); setEditLog(l); }}>
              <Pencil size={13} />
            </button>
          )}
          {(l.user_id === me.id || me.role === "admin") && (
            <button type="button" className="icon-btn sm" aria-label="기록 삭제" title="삭제" onClick={async () => (await ask("이 기록을 삭제할까요?")) && run(() => api.deleteWorkLog(l.id), "삭제했습니다.")}>
              <Trash2 size={13} />
            </button>
          )}
        </>
      ),
    },
  ];

  // 할 일 · 메모장: 업무 기록 아래에서 위로 펼쳐짐
  const todoWho = !viewUser ? "팀 전체" : viewUser === me.id ? "내" : `${profileName(viewUser)}`;
  const todoPad = (
    <div className="col gap-6" aria-label="할 일">
      <span className="t-bodyb"><ListTodo size={15} style={{ verticalAlign: -2 }} aria-hidden="true" /> {todoWho} 할 일</span>
      <span className="t-cap">왼쪽에서 고른 사람의 할 일입니다. 프로젝트 이름을 쓰면 자동 연결되고, 승인 안 된 업무 보고는 승인될 때까지 여기에 남습니다.</span>
      <PendingReports reports={reports} userId={viewUser ?? null} />
      <WorkTodo projects={data.projects} clients={data.clients} tasks={data.tasks} userId={viewUser ?? null} />
    </div>
  );
  const memoPad = <MemoPad onClose={() => setSide("none")} />;
  // 할 일 버튼에 지연 개수 (눌러서 오른쪽 창으로)
  const lateCount = data.tasks.filter(t => t.status !== "완료" && !!t.due_date && t.due_date < today && (!viewUser || t.assignee_id === viewUser)).length;
  // 할 일 · 메모장은 오른쪽 창으로 (대표 지시 2026-10-28 "아래 지연은 오른쪽 창으로 옮겨"), 좁은 화면은 아래 칸
  const wide = usePanelWide();
  useRightPanel(wide && side !== "none" ? `work:${side}` : null, side === "memo" ? "메모장" : "할 일 · 미승인 보고", side === "memo" ? memoPad : todoPad, { onClose: () => setSide("none") });

  return (
    <div className="work-wrap">
      <div className="row work-head">
        {tabs}
        <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="이전">
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="t-bodyb" style={{ border: 0, background: "none", cursor: "pointer", padding: 0 }} onClick={() => go({ date: null })} title="오늘로">
          {label}
        </button>
        <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="다음" disabled={!canNext}>
          <ChevronRight size={18} />
        </button>
        {other ? (
          <>
            <span className="t-smallb">{other.name}님의 업무</span>
            <TodayBadge status={presenceOf(other, attendance.get(other.id))} />
          </>
        ) : (
          <span className="t-smallb">{team ? "팀 전체" : "내 업무"}</span>
        )}
        {q && <Badge tone="yellow">검색: {q}</Badge>}
        <span className="grow" />
        <span className="t-cap">
          {data.logs.length}건 · {minutesLabel(total)}
        </span>
        <Button kind={side === "todo" ? "blue" : "outline"} size="sm" onClick={() => setSide(side === "todo" ? "none" : "todo")} title="할 일 · 미승인 업무 보고 (오른쪽 창)">
          할 일{lateCount > 0 && <span className="late-pill">지연 {lateCount}</span>}
        </Button>
        <Button kind={side === "memo" ? "blue" : "outline"} size="sm" onClick={() => setSide(side === "memo" ? "none" : "memo")} title="나만 보는 메모 (업무 일지에 안 들어감)">
          메모장
        </Button>
        {!other && !team && period === "day" && (
          <Button kind="yellow" size="sm" onClick={() => setReporting(true)} disabled={data.logs.length === 0}>
            보고 제출
          </Button>
        )}
      </div>
      <div className="work-body">
        <TeamSide period={period} date={date} q={q} viewUser={viewUser} team={team} logs={data.periodLogs} reports={reports} from={from} to={to} go={go} profiles={profiles.filter((p) => p.active && !p.is_agent)} />
        <div className="work-main">
          {other?.status_message && period === "day" && (
            <div className="t-small" style={{ padding: "6px 14px", background: "var(--white)", borderBottom: "1px dashed var(--line)" }}>
              “{other.status_message}”
            </div>
          )}
          {periodReports.length > 0 && <ReportStrip reports={periodReports} period={period} />}
          <div className="chat-body" style={{ gap: 12 }}>
            {period === "day" ? (
              <Board rows={data.logs} cols={logCols} rowKey={l => l.id} compact empty={q ? "검색 결과가 없습니다." : other || team ? "이 기간의 기록이 없습니다." : "아래 입력창에 오늘 한 일을 남겨 보세요. 메일·미팅·전화도 모두 기록할 수 있어요."} />
            ) : (
              <>
                {byDate.map(([d, list]) => (
                  <div key={d} className="col gap-4">
                    <BoardHead
                      title={
                        <button type="button" className="link-btn t-bodyb" onClick={() => go({ period: null, date: d })} title="이 날 보기">
                          {shortDate(d)} ({weekday(d)})
                        </button>
                      }
                      count={`${list.length}건`}
                      right={`${minutesLabel(list.reduce((n, l) => n + (l.minutes ?? 0), 0))}`}
                    />
                    <Board rows={list} cols={logCols} rowKey={l => l.id} compact numbered={false} />
                  </div>
                ))}
                {data.logs.length === 0 && <Empty>{q ? "검색 결과가 없습니다." : "이 기간의 기록이 없습니다."}</Empty>}
              </>
            )}
          </div>
          {!other && !team && period === "day" && !q && <LogComposer key={date} date={date} initialClientId={query.get("client") ?? ""} />}
          {side !== "none" && !wide && (
            <div className="work-drawer" key={side}>
              {side === "memo" ? memoPad : todoPad}
            </div>
          )}
        </div>
      </div>
      {editLog && <LogEdit key={editLog.id} l={editLog} onClose={() => setEditLog(null)} />}
      {memoLog && <LogMemo key={memoLog.id} l={memoLog} onClose={() => setMemoLog(null)} />}
      {reporting && (
        <NewApproval preset={{ kind: "업무 보고", payload: { date } }} onClose={() => setReporting(false)} onCreated={(id) => navigate(`/approvals?view=mine&id=${id}`)} />
      )}
    </div>
  );
}

/** 이 기간의 업무 보고 (승인 체크) */
function ReportStrip({ reports, period }: { reports: Approval[]; period: Period }) {
  const { profileName } = useApp();
  const list = [...reports].sort((a, b) => reportDate(b).localeCompare(reportDate(a)));
  return (
    <div className="report-strip">
      <span className="t-smallb">업무 보고 {list.length}건</span>
      {list.slice(0, period === "day" ? 10 : 40).map((a) => (
        <span key={a.id} className="row report-chip">
          <ReportCheck a={a} />
          <Link to={`/approvals?id=${a.id}`} className="t-cap">
            {period !== "day" && `${shortDate(reportDate(a))} · `}
            {profileName(a.requested_by)}
          </Link>
        </span>
      ))}
    </div>
  );
}

/** 왼쪽: 기간 · 검색 · 팀원별 업무 보고 */
function TeamSide({
  period,
  date,
  q,
  viewUser,
  team,
  logs,
  reports,
  from,
  to,
  go,
  profiles,
}: {
  period: Period;
  date: string;
  q: string;
  viewUser: string | undefined;
  team: boolean;
  logs: Log[];
  reports: Approval[];
  from: string;
  to: string;
  go: (p: Record<string, string | null>) => void;
  profiles: { id: string; name: string; title: string | null }[];
}) {
  const { me } = useApp();
  const [text, setText] = useState(q);
  const today = todayKey();
  const count = (id: string) => logs.filter((l) => l.user_id === id).length;
  const inRange = reports.filter((a) => {
    const d = reportDate(a);
    return d >= from && d <= to;
  });
  const pending = (id: string) => inRange.filter((a) => a.requested_by === id && a.status === "대기").length;
  const approved = (id: string) => inRange.filter((a) => a.requested_by === id && a.status === "승인").length;
  const people = [...profiles].sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name)));
  const years = Array.from({ length: 4 }, (_, i) => String(Number(today.slice(0, 4)) - i));
  return (
    <aside className="team-side" aria-label="팀원별 업무 보고">
      <div className="chips">
        {(
          [
            ["day", "일별"],
            ["month", "월별"],
            ["year", "년별"],
          ] as [Period, string][]
        ).map(([k, l]) => (
          <Chip key={k} active={period === k} onClick={() => go({ period: k === "day" ? null : k })}>
            {l}
          </Chip>
        ))}
      </div>
      {period === "day" ? (
        <input className="input" type="date" value={date} max={today} onChange={(e) => e.target.value && go({ date: e.target.value })} aria-label="날짜" />
      ) : period === "month" ? (
        <input className="input" type="month" value={date.slice(0, 7)} max={today.slice(0, 7)} onChange={(e) => e.target.value && go({ date: `${e.target.value}-01` })} aria-label="월" />
      ) : (
        <select className="select" value={date.slice(0, 4)} onChange={(e) => go({ date: `${e.target.value}-01-01` })} aria-label="연도">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      )}
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: text.trim() || null });
        }}
      >
        <Search size={14} />
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== q && go({ q: text.trim() || null })} placeholder="업무 내용 검색" aria-label="업무 내용 검색" />
      </form>
      <button type="button" className={`team-person${team ? " active" : ""}`} title="팀원별 업무 보고 · ✈ 눌러 바로 업무 지시" onClick={() => go({ user: null, team: "1" })}>
        <span className="grow">팀 전체</span>
        <span className="t-meta">{logs.length}건</span>
      </button>
      {people.map((p) => {
        const active = !team && viewUser === p.id;
        const pend = pending(p.id);
        return (
          <div key={p.id} className="team-row">
          <button type="button" className={`team-person${active ? " active" : ""}`} onClick={() => go({ user: p.id === me.id ? null : p.id, team: null })}>
            <UserPic id={p.id} size={28} />
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="row" style={{ gap: 4, minWidth: 0 }}>
                <span className="t-smallb truncate">
                  {p.name}
                  {p.id === me.id ? " (나)" : ""}
                </span>
                {pend > 0 && (
                  <Badge tone="red" title="승인 대기 업무 보고">
                    미승인 {pend}
                  </Badge>
                )}
              </span>
              <span className="t-meta">
                기록 {count(p.id)} · 승인 {approved(p.id)}
              </span>
            </span>
          </button>
          <AssignTaskButton assignee={p.id} className="icon-btn team-assign" title={`${p.name}님에게 업무 지시`} />
          </div>
        );
      })}
    </aside>
  );
}

/** 업무 기록 고치기 (쓴 사람 · 관리자) */
/** 업무 기록에 메모 붙이기 (대표 지시 2026-10-21 "업무에서 메모를 추가할 수 있게") */
function LogMemo({ l, onClose }: { l: Log; onClose: () => void }) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [memo, setMemo] = useState(l.memo ?? "");
  const save = async (v: string | null) => {
    const ok = await run(() => api.saveWorkLog({ id: l.id, memo: v }), v ? "메모를 저장했습니다." : "메모를 지웠습니다.");
    if (ok) onClose();
  };
  return (
    <Modal
      title={l.memo ? "메모 고치기" : "메모 추가"}
      onClose={onClose}
      actions={
        <>
          {l.memo && (
            <Button kind="ghost" disabled={busy} onClick={() => save(null)}>
              메모 지우기
            </Button>
          )}
          <span className="grow" />
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || !memo.trim()} onClick={() => save(memo.trim())}>
            저장
          </Button>
        </>
      }
    >
      <div className="note pre t-small">{l.content}</div>
      <Field label="메모">
        <textarea
          className="textarea"
          rows={4}
          autoFocus
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && memo.trim() && save(memo.trim())}
          placeholder="후속 조치 · 참고 사항 (Ctrl+Enter 저장)"
          maxLength={2000}
        />
      </Field>
    </Modal>
  );
}

function LogEdit({ l, onClose }: { l: Log; onClose: () => void }) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [content, setContent] = useState(l.content);
  const [minutes, setMinutes] = useState(l.minutes ? String(l.minutes) : "");
  const save = async () => {
    if (!content.trim()) return;
    const ok = await run(() => api.saveWorkLog({ id: l.id, content: content.trim(), minutes: minutes ? Number(minutes) : null }), "고쳤습니다.");
    if (ok) onClose();
  };
  return (
    <Modal
      title="업무 기록 수정"
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || !content.trim()} onClick={save}>
            저장
          </Button>
        </>
      }
    >
      <Field label="내용">
        <textarea className="textarea" rows={5} value={content} onChange={(e) => setContent(e.target.value)} />
      </Field>
      <Field label="걸린 시간 (분)">
        <input className="input" type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </Field>
    </Modal>
  );
}
