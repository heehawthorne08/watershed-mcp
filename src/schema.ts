// Conformance layer for the #450 "Ecological Sensor Reading" JSON Schema
// (https://github.com/xtratrezzy/ecological-sensor-schema, schema_version 1.0.0).
// Every reading we emit is validated against the real schema at runtime;
// anything that fails is dropped and reported in `warnings`.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import readingSchema from "./readingSchema.js";

export const SCHEMA_VERSION = "1.0.0";
export const SCHEMA_REF = "https://github.com/xtratrezzy/ecological-sensor-schema";

export interface Reading {
  schema_version: "1.0.0";
  sensor_id: string;
  sensor_type: "water_quality" | "soil" | "air_quality";
  parameter: string;
  value: number;
  unit: string;
  timestamp: string;
  location: { lat: number; lng: number; elevation_m?: number };
  source: string;
  quality_flag?: "raw" | "validated" | "estimated" | "suspect";
  notes?: string;
}

const AjvCtor: any = (Ajv2020 as any).default ?? Ajv2020;
const addFmt: any = (addFormats as any).default ?? addFormats;
const ajv = new AjvCtor({ strict: false, allErrors: true });
addFmt(ajv);
const validate = ajv.compile(readingSchema);

export function checkReading(r: unknown): { ok: true } | { ok: false; error: string } {
  if (validate(r)) return { ok: true };
  return { ok: false, error: (validate.errors ?? []).map((e: any) => `${e.instancePath || "/"} ${e.message}`).join("; ") };
}

/** Keep only schema-valid readings; report the rest. */
export function keepValid(candidates: Reading[]): { readings: Reading[]; warnings: string[] } {
  const readings: Reading[] = [];
  const warnings: string[] = [];
  for (const c of candidates) {
    const res = checkReading(c);
    if (res.ok) readings.push(c);
    else warnings.push(`Dropped non-conforming reading ${c.sensor_id}/${c.parameter}: ${res.error}`);
  }
  return { readings, warnings };
}

export function envelope<T extends Record<string, unknown>>(
  tool: string,
  query: Record<string, unknown>,
  sources: { name: string; url: string }[],
  body: T,
  warnings: string[] = [],
  now: () => Date = () => new Date(),
) {
  return {
    tool,
    generated_at: now().toISOString(),
    schema: { name: "ecological-sensor-reading", version: SCHEMA_VERSION, ref: SCHEMA_REF },
    query,
    sources,
    ...body,
    warnings,
  };
}
