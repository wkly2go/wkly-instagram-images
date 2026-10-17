import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ListTodo, Search, Trash2 } from "lucide-react";
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
import { Shell } from "../components/Shell";
import { LogComposer, isMail } from "../components/LogForm";
import {
  Badge,
  Button,
  Chip,
  Empty,
  KindBadge,
  TodayBadge,
} from "../components/ui";
import { NewApproval } from "./Approvals";
import { AssignTaskButton } from "../components/AssignTask";
import { MemoPad } from "../components/MemoPad";
import { PendingReports, ReportCheck, WorkTodo, reportDate, useWorkReports } from "../components/WorkReports";

const SIDE_KEY = "wkly-work-side";
type Period = "day" | "month" | "year";
type Side = "todo" | "memo" | "none";

/** 기간 범위: 일 = 그날, 월 = 그 달, 년 = 그 해 */
function rangeOf(period: Period, date: string): [string, string] {
  if (period === "day") return [date, date];
  if (period === "month") return [`${date.slice(0, 7)}-01`, addDays(`${addMonths(date.slice(0, 7), 1)}-01`, -1)];
  return [`${date.slice(0, 4)}-01-01`, `${date.slice(0, 4)}-12-31`];
}

export default function WorkLog() {
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

  const logItem = (l: Log) => {
    const mine = l.user_id === me.id;
    return (
      <div key={l.id} className={`log ${mine ? "" : "other"}`}>
        <div className="who">
          {!mine && (
            <>
              <span className="t-cap">{profileName(l.user_id)}</span>
            </>
          )}
          <KindBadge kind={l.kind} />
          <span className="t-meta">
            {period !== "day" ? `${shortDate(l.log_date)} ` : ""}
            {timeLabel(l.created_at)}
            {l.minutes ? ` · ${l.minutes}분` : ""}
          </span>
          {mine && (
            <button type="button" className="icon-btn sm" aria-label="할 일로 만들기" title="이 기록으로 할 일 만들기 (같은 프로젝트에 연결)" onClick={() => toTask(l)}>
              <ListTodo size={13} />
            </button>
          )}
          {(mine || me.role === "admin") && (
            <button
              type="button"
              className="icon-btn sm del"
              aria-label="기록 삭제"
              title="삭제"
              onClick={() => window.confirm("이 기록을 삭제할까요?") && run(() => api.deleteWorkLog(l.id), "삭제했습니다.")}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <div className={`bubble ${mine ? "mine" : "other"}`}>{l.content}</div>
        {isMail(l.kind) && (l.email_counterpart || l.email_subject) && (
          <div className="extra">
            {l.kind === "메일 발신" ? "받는 사람" : "보낸 사람"} {l.email_counterpart || "-"}
            {l.email_subject ? ` · ${l.email_subject}` : ""}
          </div>
        )}
        {(l.client_id || l.project_id) && (
          <div className="links">
            {l.client_id && <Link to={`/clients?id=${l.client_id}`}>🏢 {clientName(l.client_id) ?? "거래처"}</Link>}
            {l.project_id && <Link to={`/projects?id=${l.project_id}`}>📁 {projectName(l.project_id) ?? "프로젝트"}</Link>}
          </div>
        )}
      </div>
    );
  };

  return (
    <Shell active="work" flush>
      <div className="row wrap" style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
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
        <Button kind={side === "todo" ? "blue" : "outline"} size="sm" onClick={() => setSide(side === "todo" ? "none" : "todo")} title="할 일 · 미승인 업무 보고">
          할 일
        </Button>
        <Button kind={side === "memo" ? "blue" : "outline"} size="sm" onClick={() => setSide(side === "memo" ? "none" : "memo")} title="나만 보는 메모 (업무 일지에 안 들어감)">
          메모장
        </Button>
        {!other && !team && period === "day" && (
          <Button kind="yellow" size="sm" onClick={() => setReporting(true)} disabled={data.logs.length === 0}>
            업무 보고 제출
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
            {data.logs.length === 0 && (
              <Empty>{q ? "검색 결과가 없습니다." : other || team || period !== "day" ? "이 기간의 기록이 없습니다." : "아래 입력창에 오늘 한 일을 남겨 보세요. 메일·미팅·전화도 모두 기록할 수 있어요."}</Empty>
            )}
            {period === "day"
              ? data.logs.map(logItem)
              : byDate.map(([d, list]) => (
                  <div key={d} className="col gap-8">
                    <button type="button" className="log-day" onClick={() => go({ period: null, date: d })} title="이 날 보기">
                      {shortDate(d)} ({weekday(d)}) · {list.length}건
                    </button>
                    {list.map(logItem)}
                  </div>
                ))}
          </div>
          {!other && !team && period === "day" && !q && <LogComposer key={date} date={date} initialClientId={query.get("client") ?? ""} />}
        </div>
        {side === "todo" && (
          <aside className="memo-pad todo-pad" aria-label="할 일">
            <span className="t-bodyb">✅ 할 일</span>
            <span className="t-cap">업무 일지처럼 프로젝트 이름을 쓰면 자동 연결됩니다. 승인 안 된 업무 보고는 승인될 때까지 여기에 남습니다.</span>
            <PendingReports reports={reports} />
            <WorkTodo projects={data.projects} clients={data.clients} tasks={data.tasks} />
          </aside>
        )}
        {side === "memo" && <MemoPad onClose={() => setSide("none")} />}
      </div>
      {reporting && (
        <NewApproval preset={{ kind: "업무 보고", payload: { date } }} onClose={() => setReporting(false)} onCreated={(id) => navigate(`/approvals?view=mine&id=${id}`)} />
      )}
    </Shell>
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
      <span className="t-cap">팀원별 업무 보고 · ✈ 눌러 바로 업무 지시</span>
      <button type="button" className={`team-person${team ? " active" : ""}`} onClick={() => go({ user: null, team: "1" })}>
        <span className="grow">팀 전체</span>
        <span className="t-meta">{logs.length}건</span>
      </button>
      {people.map((p) => {
        const active = !team && viewUser === p.id;
        const pend = pending(p.id);
        return (
          <div key={p.id} className="team-row">
          <button type="button" className={`team-person${active ? " active" : ""}`} onClick={() => go({ user: p.id === me.id ? null : p.id, team: null })}>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="t-smallb truncate">
                {p.name}
                {p.id === me.id ? " (나)" : ""}
              </span>
              <span className="t-meta">
                기록 {count(p.id)} · 보고 승인 {approved(p.id)}
              </span>
            </span>
            {pend > 0 && (
              <Badge tone="red" title="승인 대기 업무 보고">
                미승인 {pend}
              </Badge>
            )}
          </button>
          <AssignTaskButton assignee={p.id} className="icon-btn team-assign" title={`${p.name}님에게 업무 지시`} />
          </div>
        );
      })}
    </aside>
  );
}
