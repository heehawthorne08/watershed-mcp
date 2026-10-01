// ============================================================================
// SCHEMA LAYER. The "#450 JSON schema" was NOT supplied when this was written.
// Everything below is a placeholder envelope. To conform to the real #450 spec,
// edit ONLY this file; tools/sources don't change.
// ============================================================================
import { z } from "zod";

export const SCHEMA_VERSION = "450-assumed-v0";

export const SourceRef = z.object({ name: z.string(), url: z.string() });

export const Envelope = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    tool: z.string(),
    generated_at: z.string(),
    sources: z.array(SourceRef),
    query: z.record(z.unknown()),
    count: z.number().int(),
    results: z.array(item),
    warnings: z.array(z.string()),
  });

export const River = z.object({
  site_id: z.string(),
  name: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  latest: z.object({
    discharge_cfs: z.number().nullable(),
    gauge_height_ft: z.number().nullable(),
    observed_at: z.string().nullable(),
  }),
});

export const GaugeReading = z.object({
  site_id: z.string(),
  name: z.string(),
  parameter_code: z.string(),
  parameter: z.string(),
  unit: z.string(),
  value: z.number().nullable(),
  observed_at: z.string(),
  qualifiers: z.array(z.string()),
});

export const ComplianceRank = z.object({
  rank: z.number().int(), // 1 = worst compliance
  facility_id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  permit_status: z.string().nullable(),
  snc_status: z.string().nullable(),
  quarters_with_nc: z.number().nullable(),
  formal_actions: z.number().nullable(),
  penalties_usd: z.number().nullable(),
  compliance_score: z.number(), // 0-100, higher = better
});

export function toEnvelope<T>(
  tool: string,
  query: Record<string, unknown>,
  sources: { name: string; url: string }[],
  results: T[],
  warnings: string[] = [],
  now: () => Date = () => new Date(),
) {
  return {
    schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION,
    tool,
    generated_at: now().toISOString(),
    sources,
    query,
    count: results.length,
    results,
    warnings,
  };
}
