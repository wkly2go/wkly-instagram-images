// 나라장터(조달청 낙찰정보서비스)에서 공종별 낙찰 업체를 읽어 "협력사 후보"로 넣는다. (2026-11-15 arterior-interior 에서 옮김)
// - 인증키는 이 프로젝트의 Edge Function 비밀값 DATA_GO_KR_SERVICE_KEY 에만 둔다(저장소·DB·응답에 남기지 않는다).
// - 호출은 DB 안의 private.design_run_g2b_vendors()만 한다: 1회용 토큰을 헤더로 보내고, 여기서 쓰면서 확인한다(design_run_token_use).
// - 넣는 것은 설계 구역 협력사의 status='candidate' 행뿐이다. 실제 거래처(partner)는 건드리지 않고, 발주서 자동 배정에도 쓰이지 않는다.
import { createClient } from "npm:@supabase/supabase-js@2";

const BASE = "https://apis.data.go.kr/1230000/as/ScsbidInfoService/";
const OPS: Record<string, string> = {
  servc: "getScsbidListSttusServcPPSSrch",
  cnstwk: "getScsbidListSttusCnstwkPPSSrch",
  thng: "getScsbidListSttusThngPPSSrch",
};
// 공종별 기본 검색어(공고명 부분 일치). 호출할 때 keywords로 바꿀 수 있다.
const DEFAULT_KEYWORDS: { kw: string; trade: string; kinds: string[] }[] = [
  { kw: "인테리어", trade: "T03", kinds: ["cnstwk"] },
  { kw: "전시물 제작", trade: "T15", kinds: ["servc", "thng"] },
  { kw: "부스 설치", trade: "T15", kinds: ["servc"] },
  { kw: "간판", trade: "T14", kinds: ["cnstwk", "thng"] },
  { kw: "사인물", trade: "T14", kinds: ["servc", "thng"] },
  { kw: "도장공사", trade: "T06", kinds: ["cnstwk"] },
  { kw: "조명", trade: "T11", kinds: ["cnstwk", "thng"] },
  { kw: "금속", trade: "T04", kinds: ["cnstwk"] },
  { kw: "바닥", trade: "T09", kinds: ["cnstwk"] },
  { kw: "영상장비", trade: "T16", kinds: ["servc", "thng"] },
  { kw: "폐기물", trade: "T18", kinds: ["servc"] },
  { kw: "냉난방", trade: "T22", kinds: ["cnstwk"] },
];

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");
const bizno = (v: string) => { const d = v.replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : ""; };
const region = (addr: string) => addr.split(/\s+/).slice(0, 2).join(" ").slice(0, 40);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST만 됩니다" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "서버 설정 없음" }, 503);
  const db = createClient(url, service, { auth: { persistSession: false } });

  const token = req.headers.get("x-run-token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "권한 없음" }, 401);
  const used = await db.rpc("design_run_token_use", { p_token: token });
  if (used.error || used.data !== true) return json({ error: "권한 없음" }, 401);

  const key = Deno.env.get("DATA_GO_KR_SERVICE_KEY")?.trim();
  if (!key) return json({ error: "DATA_GO_KR_SERVICE_KEY 비밀값이 아직 없습니다" }, 503);

  let body: { keywords?: { kw: string; trade: string; kinds?: string[] }[]; days?: number; dry?: boolean; max?: number; perTrade?: number; allRegions?: boolean } = {};
  try { body = await req.json(); } catch { /* 기본값 */ }
  const days = Math.min(Math.max(Number(body.days) || 7, 1), 28);
  const max = Math.min(Math.max(Number(body.max) || 30, 1), 60);
  const keywords = (body.keywords?.length ? body.keywords : DEFAULT_KEYWORDS).slice(0, 20);
  const trades = new Set((await db.from("design_trades").select("code")).data?.map((t) => t.code));

  type Found = { name: string; biz: string; ceo: string; tel: string; addr: string; trade: string; note: string };
  const found = new Map<string, Found>();
  const diag: Record<string, unknown>[] = [];
  const end = new Date(), today = end.toISOString().slice(0, 10);

  for (const k of keywords) {
    if (!trades.has(k.trade) || !k.kw || k.kw.length > 40) continue;
    for (const kind of (k.kinds?.length ? k.kinds : ["servc"])) {
      if (!OPS[kind]) continue;
      // 조회 기간은 한 번에 7일씩 끊어 읽는다
      for (let off = 0; off < days; off += 7) {
        const to = new Date(end.getTime() - off * 86400_000), from = new Date(to.getTime() - Math.min(6, days - off - 1) * 86400_000);
        const u = new URL(OPS[kind], BASE);
        u.search = new URLSearchParams({ serviceKey: key, type: "json", inqryDiv: "1", pageNo: "1", numOfRows: "50",
          inqryBgnDt: ymd(from) + "0000", inqryEndDt: ymd(to) + "2359", bidNtceNm: k.kw }).toString();
        try {
          const r = await fetch(u, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000), redirect: "error" });
          const raw = await r.text();
          if (raw.trimStart().startsWith("<")) {
            const code = /<(?:returnReasonCode|resultCode)>\s*(\w+)\s*</.exec(raw)?.[1] ?? "?";
            const msg = /<(?:returnAuthMsg|resultMsg)>\s*([^<]{0,80})</.exec(raw)?.[1] ?? "";
            diag.push({ kw: k.kw, kind, http: r.status, code, msg });
            if (["20", "30", "31", "22"].includes(code)) return json({ error: "나라장터 API가 거절했습니다(활용 신청·인증키·한도 확인)", diag }, 502);
            continue;
          }
          const res = JSON.parse(raw)?.response, head = res?.header, b = res?.body;
          let items = b?.items; if (items && !Array.isArray(items) && items.item) items = items.item;
          if (items && !Array.isArray(items)) items = [items];
          items = Array.isArray(items) ? items : [];
          diag.push({ kw: k.kw, kind, code: head?.resultCode, total: b?.totalCount, rows: items.length,
            ...(body.dry && items[0] ? { fields: Object.keys(items[0]) } : {}) });
          for (const it of items) {
            const name = txt(it.bidwinnrNm), biz = bizno(txt(it.bidwinnrBizno));
            if (!name || !biz || found.has(biz)) continue;
            const amt = txt(it.sucsfbidAmt).replace(/\D/g, "");
            found.set(biz, { name: name.slice(0, 80), biz, ceo: txt(it.bidwinnrCeoNm).slice(0, 40), tel: txt(it.bidwinnrTelNo).slice(0, 30),
              addr: txt(it.bidwinnrAdrs), trade: k.trade,
              note: `나라장터 낙찰 실적 · ${txt(it.bidNtceNm).slice(0, 80)} · ${txt(it.dminsttNm).slice(0, 40)} · 낙찰 ${txt(it.fnlSucsfDate) || txt(it.rlOpengDt).slice(0, 10)}`
                + (amt ? ` · ${Number(amt).toLocaleString("ko-KR")}원` : "") + ` · ${today} 수집(공고 ${txt(it.bidNtceNo)})` });
          }
        } catch (_e) {
          diag.push({ kw: k.kw, kind, error: "조회 실패" });   // 오류 본문에는 인증키가 든 주소가 있을 수 있어 남기지 않는다
        }
      }
    }
  }

  if (body.dry) return json({ dry: true, found: found.size, sample: [...found.values()].slice(0, 5).map((f) => ({ name: f.name, trade: f.trade, note: f.note })), diag });

  const existing = await db.from("design_vendors").select("name, biz_no");
  const haveBiz = new Set(existing.data?.map((v) => (v.biz_no ?? "").replace(/\D/g, "")).filter(Boolean));
  const haveName = new Set(existing.data?.map((v) => v.name));
  // 수도권(서울·경기·인천) 업체만, 공종마다 perTrade곳까지 고르게 넣는다
  const perTrade = Math.min(Math.max(Number(body.perTrade) || 6, 1), 20), taken: Record<string, number> = {};
  const rows = [...found.values()]
    .filter((f) => !haveBiz.has(f.biz.replace(/\D/g, "")) && !haveName.has(f.name))
    .filter((f) => body.allRegions || /^(서울|경기|인천)/.test(f.addr))
    .filter((f) => (taken[f.trade] = (taken[f.trade] ?? 0) + 1) <= perTrade).slice(0, max)
    .map((f) => ({ name: f.name, biz_no: f.biz, trades: [f.trade], contact_name: f.ceo || null, phone: f.tel || null, status: "candidate",
      source_url: "https://www.g2b.go.kr/", source_note: f.note, region: region(f.addr) || null }));
  let inserted = 0;
  if (rows.length) {
    const ins = await db.from("design_vendors").insert(rows).select("id");
    if (ins.error) return json({ error: "후보 저장 실패", detail: ins.error.message, diag }, 500);
    inserted = ins.data.length;
  }
  return json({ found: found.size, inserted, diag });
});
