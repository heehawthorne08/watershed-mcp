import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkReading } from "../src/schema.js";
import { getGaugeReadings, queryRivers, rankEpaCompliance } from "../src/tools.js";

const ts = (site: string, name: string, code: string, v: string, q = ["P"]) => ({
  sourceInfo: { siteName: name, siteCode: [{ value: site }], geoLocation: { geogLocation: { latitude: 38.9, longitude: -77.1 } } },
  variable: { variableCode: [{ value: code }], variableName: code, unit: { unitCode: "u" }, noDataValue: -999999 },
  values: [{ value: [{ value: v, dateTime: "2026-10-01T12:00:00.000-04:00", qualifiers: q }] }],
});
const body = (...t: any[]) => ({ value: { timeSeries: t } });
const json = (b: unknown, ok = true, status = 200) => ({ ok, status, json: async () => b }) as Response;
const mk = (b: unknown) => (async () => json(b)) as typeof fetch;

describe("real #450 schema sanity", () => {
  it("accepts the repo's own examples", () => {
    for (const f of ["water-quality", "soil", "air-quality"]) {
      for (const r of JSON.parse(readFileSync(`test/fixtures/${f}-example.json`, "utf8"))) expect(checkReading(r)).toEqual({ ok: true });
    }
  });
  it("rejects wrong unit", () => {
    const r = JSON.parse(readFileSync("test/fixtures/water-quality-example.json", "utf8"))[0];
    expect(checkReading({ ...r, unit: "mg/L" }).ok).toBe(false);
  });
});

describe("tools", () => {
  const POTOMAC = "POTOMAC RIVER NEAR WASH, DC";
  const data = body(
    ts("01646500", POTOMAC, "00010", "18.2", ["A"]),
    ts("01646500", POTOMAC, "00300", "8.1"),
    ts("01646500", POTOMAC, "00400", "7.6", ["P", "e"]),
    ts("01646500", POTOMAC, "00060", "4200"),
    ts("01646500", POTOMAC, "00065", "-999999"),
    ts("01578310", "SUSQUEHANNA RIVER AT CONOWINGO, MD", "00010", "99"), // out of schema range -> dropped
  );
  it("get_gauge_readings emits only schema-valid readings; discharge goes to supplemental", async () => {
    const out = await getGaugeReadings({ site_ids: ["01646500", "01578310", "99999999"], parameters: ["00010", "00300", "00400", "00060"], max_points_per_series: 5 }, mk(data));
    expect(out.readings).toHaveLength(3);
    for (const r of out.readings) expect(checkReading(r)).toEqual({ ok: true });
    expect(out.readings.map((r) => r.quality_flag).sort()).toEqual(["estimated", "raw", "validated"]);
    expect(out.readings[0].timestamp).toBe("2026-10-01T16:00:00.000Z");
    expect(out.supplemental.find((s) => s.parameter_code === "00060")?.value).toBe(4200);
    const w = out.warnings.join("|");
    expect(w).toMatch(/Dropped non-conforming.*01578310/);
    expect(w).toMatch(/No data returned for site 99999999/);
  });
  it("query_rivers filters by name and returns valid readings", async () => {
    const out = await queryRivers({ state: "VA", name_contains: "potomac", limit: 25 }, mk(data));
    expect(out.count).toBe(1);
    expect(out.sites[0]).toMatchObject({ site_id: "USGS-01646500", location: { lat: 38.9, lng: -77.1 } });
    expect(out.readings).toHaveLength(3);
    expect(out.supplemental).toHaveLength(2); // discharge + gauge height (noData -> null)
  });
  it("query_rivers requires a geographic filter", async () => {
    await expect(queryRivers({ limit: 5 } as any)).rejects.toThrow(/at least one/);
  });
  it("rank_epa_compliance ranks worst first and declares non-conformance", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      if (n === 1) return json({ Results: { QueryID: "42" } });
      if (n === 2) return json({ Results: { Facilities: [
        { SourceID: "A1", CWPName: "Good Plant", CWPQtrsWithNC: "1", CWPSNCStatus: "No", CWPFormalEaCnt: "0" },
        { SourceID: "B2", CWPName: "Bad Plant", CWPQtrsWithNC: "10", CWPSNCStatus: "Yes", CWPFormalEaCnt: "3", CWPTotalPenalties: "$12,000" },
      ] } });
      return json({ Results: { Facilities: [] } });
    }) as typeof fetch;
    const out = await rankEpaCompliance({ state: "VA", min_quarters_in_violation: 1, limit: 10, max_pages: 3 }, f);
    expect(out.ranking[0]).toMatchObject({ facility_id: "B2", rank: 1, penalties_usd: 12000 });
    expect(out.schema_conformance).toMatch(/not-applicable/);
  });
  it("surfaces upstream HTTP errors", async () => {
    await expect(queryRivers({ state: "VA", limit: 5 }, (async () => json({}, false, 503)) as typeof fetch)).rejects.toThrow(/503/);
  });
});
