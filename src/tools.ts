import { z } from "zod";
import { DISCHARGE, GAUGE_HEIGHT, USGS_IV, fetchIv, periodSchema, siteIdSchema, type Fetch, type Series } from "./usgs.js";
import { complianceScore, fetchFacilities } from "./echo.js";
import { envelope, keepValid, type Reading } from "./schema.js";
import { DEFAULT_WQ_CODES, MAPPED, toReading } from "./mapping.js";

const USGS_SRC = { name: "USGS NWIS Instantaneous Values", url: USGS_IV };
const ECHO_SRC = { name: "EPA ECHO CWA REST Services", url: "https://echo.epa.gov/tools/web-services" };
const SUPPLEMENTAL_NOTE =
  "`supplemental` holds discharge (00060) / gauge height (00065): the #450 schema has no parameter for them, so they are NOT part of `readings`.";

export const queryRiversInput = {
  state: z.string().length(2).optional().describe("2-letter US state code, e.g. VA"),
  huc: z.string().regex(/^\d{2}(\d{2}){0,3}$/).optional().describe("Hydrologic unit code, 2-8 digits"),
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional().describe("west,south,east,north decimal degrees"),
  name_contains: z.string().min(2).optional().describe("Case-insensitive river/site name filter"),
  limit: z.number().int().min(1).max(200).default(25),
};
export const gaugeInput = {
  site_ids: z.array(siteIdSchema).min(1).max(100),
  parameters: z.array(z.string().regex(/^\d{5}$/)).default([...DEFAULT_WQ_CODES, DISCHARGE, GAUGE_HEIGHT])
    .describe("USGS codes. #450-mapped: 00010 temp, 00300 DO, 00400 pH, 00076 turbidity(NTU). 00060/00065 go to `supplemental`."),
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

type Supp = { site_id: string; parameter_code: string; parameter: string; unit: string; value: number | null; observed_at: string };

function split(series: Series[], maxPts: number) {
  const cands: Reading[] = [];
  const supplemental: Supp[] = [];
  const unmapped = new Set<string>();
  for (const s of series) {
    for (const pt of s.points.slice(-maxPts)) {
      if (MAPPED[s.paramCode]) {
        const r = toReading(s, pt);
        if (r) cands.push(r);
      } else if (s.paramCode === DISCHARGE || s.paramCode === GAUGE_HEIGHT) {
        supplemental.push({ site_id: `USGS-${s.siteId}`, parameter_code: s.paramCode, parameter: s.paramName, unit: s.unit, value: pt.value, observed_at: new Date(pt.dateTime).toISOString() });
      } else unmapped.add(s.paramCode);
    }
  }
  const warnings = unmapped.size ? [`Skipped parameter codes with no #450 mapping: ${[...unmapped].join(", ")}`] : [];
  return { cands, supplemental, warnings };
}

export async function queryRivers(a: z.infer<z.ZodObject<typeof queryRiversInput>>, f: Fetch = fetch) {
  if (!a.state && !a.huc && !a.bbox) throw new Error("Provide at least one of: state, huc, bbox");
  const p: Record<string, string> = { parameterCd: [...DEFAULT_WQ_CODES, DISCHARGE, GAUGE_HEIGHT].join(","), siteType: "ST", siteStatus: "active" };
  if (a.state) p.stateCd = a.state.toLowerCase();
  else if (a.huc) p.huc = a.huc;
  else if (a.bbox) p.bBox = a.bbox;
  let series = await fetchIv(p, f);
  if (a.name_contains) {
    const n = a.name_contains.toLowerCase();
    series = series.filter((s) => s.name.toLowerCase().includes(n));
  }
  const siteMap = new Map<string, { site_id: string; name: string; location: { lat: number; lng: number } | null }>();
  for (const s of series)
    if (!siteMap.has(s.siteId))
      siteMap.set(s.siteId, { site_id: `USGS-${s.siteId}`, name: s.name, location: s.lat !== null && s.lon !== null ? { lat: s.lat, lng: s.lon } : null });
  const keep = new Set([...siteMap.keys()].slice(0, a.limit));
  const warnings: string[] = siteMap.size > a.limit ? [`Truncated to ${a.limit} of ${siteMap.size} matching sites`] : [];
  const { cands, supplemental, warnings: w } = split(series.filter((s) => keep.has(s.siteId)), 1);
  const v = keepValid(cands);
  return envelope("query_rivers", a, [USGS_SRC], {
    count: keep.size,
    sites: [...siteMap.entries()].filter(([k]) => keep.has(k)).map(([, v]) => v),
    readings: v.readings,
    supplemental,
  }, [...warnings, ...w, ...v.warnings, SUPPLEMENTAL_NOTE]);
}

export async function getGaugeReadings(a: z.infer<z.ZodObject<typeof gaugeInput>>, f: Fetch = fetch) {
  const p: Record<string, string> = { sites: a.site_ids.join(","), parameterCd: a.parameters.join(",") };
  if (a.period) p.period = a.period;
  const series = await fetchIv(p, f);
  const { cands, supplemental, warnings: w } = split(series, a.max_points_per_series);
  const v = keepValid(cands);
  const found = new Set(series.map((s) => s.siteId));
  const missing = a.site_ids.filter((id) => !found.has(id)).map((id) => `No data returned for site ${id}`);
  return envelope("get_gauge_readings", a, [USGS_SRC], {
    count: v.readings.length,
    readings: v.readings,
    supplemental,
  }, [...missing, ...w, ...v.warnings, SUPPLEMENTAL_NOTE]);
}

export async function rankEpaCompliance(a: z.infer<z.ZodObject<typeof complianceInput>>, f: Fetch = fetch) {
  if (!a.state && !a.huc) throw new Error("Provide state or huc");
  const facs = await fetchFacilities({ state: a.state, huc: a.huc, minQuarters: a.min_quarters_in_violation, maxPages: a.max_pages }, f);
  const ranking = facs
    .map((x) => ({ x, score: complianceScore(x) }))
    .sort((l, r) => l.score - r.score || (r.x.qtrsNC ?? 0) - (l.x.qtrsNC ?? 0))
    .slice(0, a.limit)
    .map(({ x, score }, i) => ({
      rank: i + 1, facility_id: x.id, name: x.name, city: x.city, state: x.state,
      permit_status: x.permitStatus, snc_status: x.snc, quarters_with_nc: x.qtrsNC,
      formal_actions: x.formalActions, penalties_usd: x.penalties, compliance_score: score,
    }));
  return envelope("rank_epa_compliance", a, [ECHO_SRC], {
    schema_conformance: "not-applicable: #450 models sensor readings only; compliance rankings are not readings",
    count: ranking.length,
    ranking,
  }, [
    "compliance_score is a heuristic (100 - 6*quarters_in_NC - 20 if SNC - 2*formal_actions, floor 0), not an EPA metric",
    `Ranked from first ${a.max_pages} page(s) of ECHO results (${facs.length} facilities), not the full universe`,
  ]);
}
