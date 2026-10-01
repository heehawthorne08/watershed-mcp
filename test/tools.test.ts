import { describe, expect, it } from "vitest";
import { Envelope, GaugeReading, River, ComplianceRank } from "../src/schema.js";
import { getGaugeReadings, queryRivers, rankEpaCompliance } from "../src/tools.js";

const ts = (site: string, name: string, code: string, v: string) => ({
  sourceInfo: { siteName: name, siteCode: [{ value: site }], geoLocation: { geogLocation: { latitude: 38.9, longitude: -77.1 } } },
  variable: { variableCode: [{ value: code }], variableName: code === "00060" ? "Streamflow" : "Gage height", unit: { unitCode: code === "00060" ? "ft3/s" : "ft" }, noDataValue: -999999 },
  values: [{ value: [{ value: v, dateTime: "2026-10-01T12:00:00.000-04:00", qualifiers: ["P"] }] }],
});
const usgsBody = { value: { timeSeries: [
  ts("01646500", "POTOMAC RIVER NEAR WASH, DC LITTLE FALLS PUMP STA", "00060", "4200"),
  ts("01646500", "POTOMAC RIVER NEAR WASH, DC LITTLE FALLS PUMP STA", "00065", "-999999"),
  ts("01578310", "SUSQUEHANNA RIVER AT CONOWINGO, MD", "00060", "30000"),
] } };
const json = (b: unknown, ok = true, status = 200) => ({ ok, status, json: async () => b }) as Response;

describe("tools", () => {
  it("query_rivers merges params, filters by name, validates envelope", async () => {
    const f = (async () => json(usgsBody)) as typeof fetch;
    const out = await queryRivers({ state: "MD", name_contains: "potomac", limit: 25 }, f);
    expect(() => Envelope(River).parse(out)).not.toThrow();
    expect(out.count).toBe(1);
    expect(out.results[0].latest.discharge_cfs).toBe(4200);
    expect(out.results[0].latest.gauge_height_ft).toBeNull();
  });
  it("query_rivers requires a geographic filter", async () => {
    await expect(queryRivers({ limit: 5 } as any)).rejects.toThrow(/at least one/);
  });
  it("get_gauge_readings warns on missing sites", async () => {
    const f = (async () => json(usgsBody)) as typeof fetch;
    const out = await getGaugeReadings({ site_ids: ["01646500", "99999999"], parameters: ["00060"], max_points_per_series: 10 }, f);
    expect(() => Envelope(GaugeReading).parse(out)).not.toThrow();
    expect(out.warnings.join()).toMatch(/99999999/);
  });
  it("rank_epa_compliance ranks worst first", async () => {
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
    expect(() => Envelope(ComplianceRank).parse(out)).not.toThrow();
    expect(out.results[0].facility_id).toBe("B2");
    expect(out.results[0].penalties_usd).toBe(12000);
    expect(out.results[0].rank).toBe(1);
  });
  it("surfaces upstream HTTP errors", async () => {
    const f = (async () => json({}, false, 503)) as typeof fetch;
    await expect(queryRivers({ state: "VA", limit: 5 }, f)).rejects.toThrow(/503/);
  });
});
