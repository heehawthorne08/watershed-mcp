import { z } from "zod";
import { DISCHARGE, GAUGE_HEIGHT, USGS_IV, fetchIv, periodSchema, siteIdSchema, type Fetch } from "./usgs.js";
import { complianceScore, fetchFacilities } from "./echo.js";
import { toEnvelope } from "./schema.js";

const USGS_SRC = { name: "USGS NWIS Instantaneous Values", url: USGS_IV };
const ECHO_SRC = { name: "EPA ECHO CWA REST Services", url: "https://echo.epa.gov/tools/web-services" };

export const queryRiversInput = {
  state: z.string().length(2).optional().describe("2-letter US state code, e.g. VA"),
  huc: z.string().regex(/^\d{2}(\d{2}){0,3}$/).optional().describe("Hydrologic unit code, 2-8 digits"),
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional().describe("west,south,east,north decimal degrees"),
  name_contains: z.string().min(2).optional().describe("Case-insensitive river/site name filter"),
  limit: z.number().int().min(1).max(200).default(25),
};
export const gaugeInput = {
  site_ids: z.array(siteIdSchema).min(1).max(100),
  parameters: z.array(z.string().regex(/^\d{5}$/)).default([DISCHARGE, GAUGE_HEIGHT]).describe("USGS parameter codes; 00060=discharge cfs, 00065=gauge height ft"),
  period: periodSchema.optional().describe("History window, e.g. PT6H. Omit for latest reading only."),
  max_points_per_series: z.number().int().min(1).max(500).default(50),
};
export const complianceInput = {
  state: z.string().length(2).optional(),
  huc: z.string().regex(/^\d{2}(\d{2}){0,3}$/).optional(),
  min_quarters_in_violation: z.number().int().min(0).max(12).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  max_pages: z.number().int().min(1).max(10).default(3),
};

export async function queryRivers(a: z.infer<z.ZodObject<typeof queryRiversInput>>, f: Fetch = fetch) {
  if (!a.state && !a.huc && !a.bbox) throw new Error("Provide at least one of: state, huc, bbox");
  const p: Record<string, string> = { parameterCd: `${DISCHARGE},${GAUGE_HEIGHT}`, siteType: "ST", siteStatus: "active" };
  if (a.state) p.stateCd = a.state.toLowerCase();
  else if (a.huc) p.huc = a.huc;
  else if (a.bbox) p.bBox = a.bbox;
  const series = await fetchIv(p, f);
  const by = new Map<string, any>();
  for (const s of series) {
    let r = by.get(s.siteId);
    if (!r) by.set(s.siteId, (r = { site_id: s.siteId, name: s.name, latitude: s.lat, longitude: s.lon,
      latest: { discharge_cfs: null, gauge_height_ft: null, observed_at: null } }));
    const last = s.points[s.points.length - 1];
    if (!last) continue;
    if (s.paramCode === DISCHARGE) r.latest.discharge_cfs = last.value;
    if (s.paramCode === GAUGE_HEIGHT) r.latest.gauge_height_ft = last.value;
    r.latest.observed_at = r.latest.observed_at ?? last.dateTime;
  }
  let rows = [...by.values()];
  if (a.name_contains) rows = rows.filter((r) => r.name.toLowerCase().includes(a.name_contains!.toLowerCase()));
  const warnings = rows.length > a.limit ? [`Truncated to ${a.limit} of ${rows.length} matches`] : [];
  return toEnvelope("query_rivers", a, [USGS_SRC], rows.slice(0, a.limit), warnings);
}

export async function getGaugeReadings(a: z.infer<z.ZodObject<typeof gaugeInput>>, f: Fetch = fetch) {
  const p: Record<string, string> = { sites: a.site_ids.join(","), parameterCd: a.parameters.join(",") };
  if (a.period) p.period = a.period;
  const series = await fetchIv(p, f);
  const results = series.flatMap((s) =>
    s.points.slice(-a.max_points_per_series).map((pt) => ({
      site_id: s.siteId, name: s.name, parameter_code: s.paramCode, parameter: s.paramName,
      unit: s.unit, value: pt.value, observed_at: pt.dateTime, qualifiers: pt.qualifiers,
    })));
  const found = new Set(series.map((s) => s.siteId));
  const warnings = a.site_ids.filter((id) => !found.has(id)).map((id) => `No data returned for site ${id}`);
  return toEnvelope("get_gauge_readings", a, [USGS_SRC], results, warnings);
}

export async function rankEpaCompliance(a: z.infer<z.ZodObject<typeof complianceInput>>, f: Fetch = fetch) {
  if (!a.state && !a.huc) throw new Error("Provide state or huc");
  const facs = await fetchFacilities({ state: a.state, huc: a.huc, minQuarters: a.min_quarters_in_violation, maxPages: a.max_pages }, f);
  const ranked = facs
    .map((x) => ({ x, score: complianceScore(x) }))
    .sort((l, r) => l.score - r.score || (r.x.qtrsNC ?? 0) - (l.x.qtrsNC ?? 0))
    .slice(0, a.limit)
    .map(({ x, score }, i) => ({
      rank: i + 1, facility_id: x.id, name: x.name, city: x.city, state: x.state,
      permit_status: x.permitStatus, snc_status: x.snc, quarters_with_nc: x.qtrsNC,
      formal_actions: x.formalActions, penalties_usd: x.penalties, compliance_score: score,
    }));
  const warnings = [
    "compliance_score is a heuristic (100 - 6*quarters_in_NC - 20 if SNC - 2*formal_actions, floor 0), not an EPA metric",
    `Ranked from first ${a.max_pages} page(s) of ECHO results (${facs.length} facilities), not the full universe`,
  ];
  return toEnvelope("rank_epa_compliance", a, [ECHO_SRC], ranked, warnings);
}
