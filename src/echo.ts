// EPA ECHO Clean Water Act REST services (facility compliance).
// NOTE: written from the public ECHO docs; field/param names could not be
// verified against the live API from the build sandbox. See README "Verify".
import type { Fetch } from "./usgs.js";

const BASE = "https://echodata.epa.gov/echo/cwa_rest_services";

export interface Facility {
  id: string; name: string; city: string | null; state: string | null;
  permitStatus: string | null; snc: string | null;
  qtrsNC: number | null; formalActions: number | null; penalties: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export async function fetchFacilities(
  opts: { state?: string; huc?: string; minQuarters: number; maxPages: number },
  f: Fetch = fetch,
): Promise<Facility[]> {
  const q = new URL(`${BASE}.get_facilities`);
  q.searchParams.set("output", "JSON");
  q.searchParams.set("p_act", "Y");
  if (opts.state) q.searchParams.set("p_st", opts.state.toUpperCase());
  if (opts.huc) q.searchParams.set("p_huc", opts.huc);
  if (opts.minQuarters > 0) q.searchParams.set("p_qiv", String(opts.minQuarters));
  const r1 = await f(q.toString());
  if (!r1.ok) throw new Error(`EPA ECHO get_facilities returned HTTP ${r1.status}`);
  const j1: any = await r1.json();
  const qid = j1?.Results?.QueryID;
  if (!qid) throw new Error(`EPA ECHO returned no QueryID: ${JSON.stringify(j1?.Results?.Message ?? j1).slice(0, 200)}`);

  const out: Facility[] = [];
  for (let page = 1; page <= opts.maxPages; page++) {
    const u = new URL(`${BASE}.get_qid`);
    u.searchParams.set("output", "JSON");
    u.searchParams.set("qid", String(qid));
    u.searchParams.set("pageno", String(page));
    const r = await f(u.toString());
    if (!r.ok) throw new Error(`EPA ECHO get_qid returned HTTP ${r.status}`);
    const j: any = await r.json();
    const rows: any[] = j?.Results?.Facilities ?? [];
    if (rows.length === 0) break;
    for (const x of rows) {
      out.push({
        id: String(x.SourceID ?? x.CWPPermitIdentifier ?? ""),
        name: String(x.CWPName ?? ""),
        city: str(x.CWPCity),
        state: str(x.CWPState),
        permitStatus: str(x.CWPPermitStatusDesc),
        snc: str(x.CWPSNCStatus),
        qtrsNC: num(x.CWPQtrsWithNC),
        formalActions: num(x.CWPFormalEaCnt),
        penalties: num(x.CWPTotalPenalties),
      });
    }
  }
  return out;
}

/** 0-100, higher = better. Documented heuristic, not an EPA metric. */
export function complianceScore(f: Facility): number {
  const q = f.qtrsNC ?? 0;
  const sncPenalty = f.snc && /^(yes|snc|significant)/i.test(f.snc.trim()) ? 20 : 0;
  const actions = Math.min(10, (f.formalActions ?? 0) * 2);
  return Math.max(0, Math.round(100 - q * 6 - sncPenalty - actions));
}
