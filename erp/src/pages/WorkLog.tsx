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
import { DIVISIONS, projectBrand, type ApprovalSummary, type Client, type Project, type Task, type WorkLog as Log } from "../lib/types";
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
          <span className="cell-pre t-small t-blue"><Linkify text={l.content} /></span>
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
          {!team && <MyProjects uid={viewUser ?? me.id} projects={data.projects} tasks={data.tasks} who={other ? profileName(other.id) : null} />}
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
/**
 * 내가 맡고 있는 프로젝트 한눈에 (대표 지시 2026-11-10)
 *  - 담당(owner)이거나 내 할 일이 걸린 프로젝트 중 기획 · 진행 · NIC
 *  - 칸마다: 연번 · 이름 · 상태 · 남은 날 · 내 할 일 / 지연 · 다음 마감 · 진행률(업무 완료 비율)
 *  - 지연 → 마감 임박 순 · 접기 기억
 */
const MYPROJ_KEY = "wkly-myproj-open";
const MYPROJ_F = "wkly-myproj-filter";
const ST_ORDER = ["진행", "기획", "NIC"] as const;
type PF = "전체" | "진행" | "기획" | "NIC" | "지연";
function MyProjects({ uid, projects, tasks, who }: { uid: string; projects: Project[]; tasks: Task[]; who: string | null }) {
  const { api, profiles, profileName } = useApp();
  const { run } = useAction();
  const today = todayKey();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(MYPROJ_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [filter, setFilterState] = useState<PF>(() => {
    try {
      return (localStorage.getItem(MYPROJ_F) as PF | null) ?? "전체";
    } catch {
      return "전체";
    }
  });
  const setFilter = (f: PF) => {
    setFilterState(f);
    try {
      localStorage.setItem(MYPROJ_F, f);
    } catch {
      /* noop */
    }
  };
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(MYPROJ_KEY, o ? "0" : "1");
      } catch {
        /* noop */
      }
      return !o;
    });
  };
  const rows = useMemo(() => {
    const live = projects.filter((p) => p.status !== "완료" && p.status !== "보류");
    return live
      .map((p) => {
        const all = tasks.filter((t) => t.project_id === p.id);
        const mine = all.filter((t) => t.assignee_id === uid && t.status !== "완료");
        const owner = p.owner_id === uid;
        const aiOwned = !!p.owner_id && profiles.some((x) => x.id === p.owner_id && x.is_agent);
        if (!owner && !mine.length && !aiOwned) return null;
        const late = mine.filter((t) => t.due_date && t.due_date < today);
        const next = [...mine].filter((t) => t.due_date && t.due_date >= today).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
        const doneRate = all.length ? Math.round((all.filter((t) => t.status === "완료").length / all.length) * 100) : null;
        const left = p.end_date ? Math.round((Date.parse(p.end_date) - Date.parse(today)) / 864e5) : null;
        return { p, owner, mine, late, next, doneRate, left };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.late.length - a.late.length || (a.next?.due_date ?? "9999").localeCompare(b.next?.due_date ?? "9999") || (a.left ?? 9999) - (b.left ?? 9999));
  }, [projects, tasks, uid, today, profiles]);
  const lateSum = rows.reduce((n, r) => n + r.late.length, 0);
  const count = (f: PF) => (f === "전체" ? rows.length : f === "지연" ? rows.filter((r) => r.late.length).length : rows.filter((r) => r.p.status === f).length);
  const shown = rows.filter((r) => filter === "전체" || (filter === "지연" ? r.late.length > 0 : r.p.status === filter));
  // 상태별로 묶어서 (진행 → 기획 → NIC)
  const groups = ST_ORDER.map((st) => [st, shown.filter((r) => r.p.status === st)] as const).filter(([, l]) => l.length);
  const people = profiles.filter((x) => x.active && !x.is_agent);
  const ais = profiles.filter((x) => x.active && x.is_agent);
  const isAi = (id: string | null) => !!id && ais.some((a) => a.id === id);
  // AI 담당 일임 (대표 지시 2026-11-10 "ai 담당 선정해서 일임할 수 있게")
  const delegate = async (p: Project, aiId: string) => {
    const ai = profileName(aiId);
    if (!(await ask(`'${p.name}' 프로젝트를 ${ai}에게 일임할까요?\n담당이 ${ai}(으)로 바뀌고, AI가 바로 현황을 확인해 할 일 · 일정 정리와 주간 점검 예약을 하고 보고합니다.`))) return;
    const text = [
      `[프로젝트 일임] '${p.name}'${p.code ? ` (${p.code})` : ""} 프로젝트(id ${p.id})를 당신에게 일임합니다. 이제부터 이 프로젝트의 담당입니다.`,
      "1. list_projects · list_tasks 로 이 프로젝트의 현황(기간 · 상태 · 할 일 · 지연)을 확인한다.",
      "2. 지연된 할 일은 담당자와 새 날짜를 정해 update_task 로 정리하고 담당자에게 notify_person 으로 알린다.",
      "3. 끝까지 가는 데 필요한 남은 할 일을 사람 팀원에게 create_task 로 만든다 (이미 있는 일은 새로 만들지 않음).",
      "4. 매주 월요일 09:30 에 이 프로젝트 진행 점검을 schedule_work 로 예약한다 (같은 예약이 있으면 만들지 않음).",
      "5. 사람의 판단이 필요한 일은 request_approval(to=ceo)로 올린다. 금액 · 메일 발송은 다루지 않는다.",
      "6. 마지막에 무엇을 했는지 짧게 보고한다.",
    ].join("\n");
    await run(async () => {
      await api.saveProject({ id: p.id, owner_id: aiId } as Project);
      await api.instructAgent(aiId, text);
    }, `${ai}에게 일임했습니다. 처리 결과는 알림으로 옵니다.`);
  };
  // 상태 묶음마다 접기 (대표 지시 2026-11-10 "접을 수 있게") · 기억
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("wkly-myproj-folded") ?? "[]");
    } catch {
      return [];
    }
  });
  const fold = (st: string) => {
    const next = folded.includes(st) ? folded.filter((x) => x !== st) : [...folded, st];
    setFolded(next);
    try {
      localStorage.setItem("wkly-myproj-folded", JSON.stringify(next));
    } catch {
      /* noop */
    }
  };
  const save = (p: Project, patch: Partial<Project>, msg: string) => run(() => api.saveProject({ id: p.id, ...patch } as Project), msg);
  return (
    <div className="myproj">
      <div className="myproj-h">
        <button type="button" className="myproj-title" onClick={toggle} aria-expanded={open}>
          <b>{who ? `${who}님이` : "내가"} 맡고 있는 프로젝트</b>
          <span className="myproj-n">{rows.length}</span>
        </button>
        <span className="t-cap">
          담당 {rows.filter((r) => r.owner).length} · 내 할 일 {rows.reduce((n, r) => n + r.mine.length, 0)}
        </span>
        {lateSum > 0 && <span className="myproj-late">지연 {lateSum}</span>}
        {open && (
          <span className="myproj-filter" role="group" aria-label="프로젝트 거르기">
            {(["전체", "진행", "기획", "NIC", "지연"] as PF[]).map((f) => (
              <button key={f} type="button" className={`mf-${f}${filter === f ? " on" : ""}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
                {f} <i>{count(f)}</i>
              </button>
            ))}
          </span>
        )}
        <span className="grow" />
        <button type="button" className="t-cap myproj-fold" onClick={toggle}>
          {open ? "접기 ▲" : "펼치기 ▼"}
        </button>
      </div>
      {open &&
        (shown.length ? (
          groups.map(([st, list]) => (
            <div key={st} className={`myproj-group g-${st}`}>
              <button type="button" className="myproj-gh" onClick={() => fold(st)} aria-expanded={!folded.includes(st)} title={folded.includes(st) ? "펼치기" : "접기"}>
                <span className={`myproj-st st-${st}`}>{st}</span>
                <span className="t-cap">{list.length}건</span>
                {folded.includes(st) && (
                  <span className="myproj-gnames t-cap">
                    {list.map((r) => r.p.name).join(" · ")}
                  </span>
                )}
                <span className="grow" />
                <span className="t-cap myproj-gfold">{folded.includes(st) ? "펼치기 ▼" : "접기 ▲"}</span>
              </button>
              {!folded.includes(st) && (
              <div className="myproj-grid">
                {list.map(({ p, owner, mine, late, next, doneRate, left }) => {
                  const div = DIVISIONS[projectBrand(p)];
                  return (
                    <div key={p.id} className={`myproj-card s-${p.status}${late.length ? " is-late" : ""}`}>
                      <div className="myproj-top">
                        {p.code && <span className="myproj-code">{p.code}</span>}
                        <span className="myproj-div" style={{ color: div.color, borderColor: div.color }}>
                          {div.label}
                        </span>
                        {owner && <span className="myproj-own">담당</span>}
                        {isAi(p.owner_id) && <span className="myproj-ai" title="AI 팀원에게 일임한 프로젝트">🤖 {profileName(p.owner_id)} 일임</span>}
                        <span className="grow" />
                        {left !== null && <span className={`myproj-d${left < 0 ? " over" : left <= 7 ? " soon" : ""}`}>{left < 0 ? `종료 ${-left}일 지남` : left === 0 ? "오늘 종료" : `D-${left}`}</span>}
                      </div>
                      <Link to={`/projects?id=${p.id}`} className="myproj-name" title={`${p.name} · 프로젝트 열기`}>
                        {p.name}
                      </Link>
                      <div className="myproj-meta">
                        <span>
                          내 할 일 <b>{mine.length}</b>
                        </span>
                        {late.length > 0 && <span className="myproj-late">지연 {late.length}</span>}
                        {doneRate !== null && (
                          <span className="myproj-bar" title={`업무 완료 ${doneRate}%`}>
                            <i style={{ width: `${doneRate}%` }} />
                          </span>
                        )}
                        {doneRate !== null && <span className="t-cap">{doneRate}%</span>}
                      </div>
                      <div className="myproj-next t-cap" title={next?.title ?? late[0]?.title ?? ""}>
                        {late[0] ? `지연: ${late[0].title} (${late[0].due_date!.slice(5).replace("-", ".")})` : next ? `다음: ${next.title} (${next.due_date!.slice(5).replace("-", ".")})` : "남은 할 일 없음"}
                      </div>
                      {/* 바로 설정: 상태 · 담당 · 종료일 · 완료 (대표 지시 2026-11-10) */}
                      {/* 진행 여부 (대표 지시 2026-11-10) · 담당 · 종료일 · 완료 */}
                      <div className="myproj-ctl">
                        <span className="myproj-ctl-l">진행 여부</span>
                        <span className="myproj-seg" role="group" aria-label="진행 여부">
                          {(["기획", "진행", "NIC", "보류"] as const).map((x) => (
                            <button
                              key={x}
                              type="button"
                              className={`sg-${x}${p.status === x ? " on" : ""}`}
                              aria-pressed={p.status === x}
                              title={x === "기획" ? "검토 · 제안 중" : x === "진행" ? "수주 · 진행 중" : x === "NIC" ? "NIC (진행 여부 미정)" : "보류 (진행 안 함 · 목록에서 빠짐)"}
                              onClick={() => p.status !== x && save(p, { status: x }, `'${p.name}' → ${x}`)}
                            >
                              {x}
                            </button>
                          ))}
                        </span>
                        <button
                          type="button"
                          className="myproj-done"
                          title="프로젝트 완료"
                          onClick={async () => {
                            if (await ask(`'${p.name}' 프로젝트를 완료로 바꿀까요?\n완료하면 이 목록에서 빠집니다.`)) save(p, { status: "완료" }, "프로젝트를 완료로 바꿨습니다.");
                          }}
                        >
                          ✓ 완료
                        </button>
                      </div>
                      <div className="myproj-ctl">
                        <span className="myproj-ctl-l">담당</span>
                        <select
                          className={`select${isAi(p.owner_id) ? " is-ai" : ""}`}
                          value={p.owner_id ?? ""}
                          aria-label="담당"
                          title="담당 바꾸기 · AI 팀원을 고르면 일임"
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v && isAi(v)) void delegate(p, v);
                            else save(p, { owner_id: v || null }, `담당을 ${v ? profileName(v) : "미정"}(으)로 바꿨습니다.`);
                          }}
                        >
                          <option value="">담당 미정</option>
                          <optgroup label="사람 팀원">
                            {people.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </optgroup>
                          {ais.length > 0 && (
                            <optgroup label="AI 팀원 (일임)">
                              {ais.map((x) => (
                                <option key={x.id} value={x.id}>
                                  🤖 {x.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <span className="myproj-ctl-l">종료</span>
                        <input className="input" type="date" value={p.end_date ?? ""} aria-label="종료일" title="종료일 바꾸기" onChange={(e) => save(p, { end_date: e.target.value || null }, "종료일을 바꿨습니다.")} />
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          ))
        ) : (
          <span className="t-cap" style={{ padding: "4px 2px" }}>
            {rows.length ? "이 조건의 프로젝트가 없습니다." : "진행 중인 담당 프로젝트가 없습니다."}
          </span>
        ))}
    </div>
  );
}

function ReportStrip({ reports, period }: { reports: ApprovalSummary[]; period: Period }) {
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
  reports: ApprovalSummary[];
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
      <div className="note pre t-small"><Linkify text={l.content} /></div>
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
