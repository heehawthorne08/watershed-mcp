// USGS NWIS Instantaneous Values service (live gauge data).
import { z } from "zod";

export const USGS_IV = "https://waterservices.usgs.gov/nwis/iv/";
export type Fetch = typeof fetch;

export const DISCHARGE = "00060";
export const GAUGE_HEIGHT = "00065";

export interface Point { value: number | null; dateTime: string; qualifiers: string[] }
export interface Series {
  siteId: string; name: string; lat: number | null; lon: number | null;
  paramCode: string; paramName: string; unit: string; points: Point[];
}

export async function fetchIv(params: Record<string, string>, f: Fetch = fetch): Promise<Series[]> {
  const url = new URL(USGS_IV);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await f(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`USGS NWIS returned HTTP ${res.status}`);
  const body: any = await res.json();
  const ts: any[] = body?.value?.timeSeries ?? [];
  return ts.map((t) => {
    const noData = Number(t.variable?.noDataValue);
    const pts: any[] = t.values?.[0]?.value ?? [];
    return {
      siteId: String(t.sourceInfo?.siteCode?.[0]?.value ?? ""),
      name: String(t.sourceInfo?.siteName ?? ""),
      lat: t.sourceInfo?.geoLocation?.geogLocation?.latitude ?? null,
      lon: t.sourceInfo?.geoLocation?.geogLocation?.longitude ?? null,
      paramCode: String(t.variable?.variableCode?.[0]?.value ?? ""),
      paramName: String(t.variable?.variableName ?? ""),
      unit: String(t.variable?.unit?.unitCode ?? ""),
      points: pts.map((p) => {
        const n = Number(p.value);
        return {
          value: Number.isFinite(n) && n !== noData ? n : null,
          dateTime: String(p.dateTime),
          qualifiers: Array.isArray(p.qualifiers) ? p.qualifiers.map(String) : [],
        };
      }),
    };
  });
}

export const periodSchema = z.string().regex(/^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?)?$/, "ISO-8601 duration, e.g. PT6H or P2D");
export const siteIdSchema = z.string().regex(/^\d{8,15}$/, "USGS site number, 8-15 digits");
