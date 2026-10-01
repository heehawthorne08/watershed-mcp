// USGS parameter code -> #450 (parameter, unit). Only water_quality params that
// the schema allows. Discharge (00060) and gauge height (00065) are NOT in
// the schema, so they're returned separately as `supplemental`.
import type { Point, Series } from "./usgs.js";
import type { Reading } from "./schema.js";

export const MAPPED: Record<string, { parameter: string; unit: string }> = {
  "00010": { parameter: "temperature", unit: "celsius" },
  "00300": { parameter: "dissolved_oxygen", unit: "mg/L" },
  "00400": { parameter: "ph", unit: "pH" },
  "00076": { parameter: "turbidity", unit: "NTU" }, // NOT 63680 (FNU is not NTU)
};
export const DEFAULT_WQ_CODES = Object.keys(MAPPED);

export function qualityFlag(q: string[]): Reading["quality_flag"] {
  if (q.includes("Eqp")) return "suspect";
  if (q.includes("e")) return "estimated";
  if (q.includes("A")) return "validated";
  return "raw"; // "P" provisional or unknown
}

export function toReading(s: Series, pt: Point): Reading | null {
  const m = MAPPED[s.paramCode];
  if (!m || pt.value === null || s.lat === null || s.lon === null) return null;
  const ts = new Date(pt.dateTime);
  if (Number.isNaN(ts.getTime())) return null;
  return {
    schema_version: "1.0.0",
    sensor_id: `USGS-${s.siteId}`,
    sensor_type: "water_quality",
    parameter: m.parameter,
    value: pt.value,
    unit: m.unit,
    timestamp: ts.toISOString(),
    location: { lat: s.lat, lng: s.lon },
    source: "USGS Water Services API",
    quality_flag: qualityFlag(pt.qualifiers),
    notes: `${s.name}; USGS code ${s.paramCode}; qualifiers: ${pt.qualifiers.join(",") || "none"}`,
  };
}
