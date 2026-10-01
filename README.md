# watershed-mcp

An [MCP](https://modelcontextprotocol.io) server exposing **live watershed data**, with sensor readings that conform to the
[#450 Ecological Sensor Reading schema](https://github.com/xtratrezzy/ecological-sensor-schema) (v1.0.0).

| Tool | What it does | Source | #450 conformance |
|---|---|---|---|
| `query_rivers` | Find active river gauge sites by state, HUC or bbox (+ name filter) with latest readings | USGS NWIS | `readings[]` conform |
| `get_gauge_readings` | Latest or historical readings for specific USGS site numbers | USGS NWIS | `readings[]` conform |
| `rank_epa_compliance` | Rank Clean Water Act facilities worst-first for a state or HUC | EPA ECHO | n/a (not sensor data) |

## How #450 is applied

- #450 models **one measurement per object** (`sensor_id, sensor_type, parameter, value, unit, timestamp, location, source`, optional `quality_flag`, `notes`; `additionalProperties: false`).
- Every item in `readings[]` is **validated against the real schema at runtime** (vendored in [`schema/`](schema/), MIT). Anything that fails (e.g. a temperature outside -5..45 °C) is **dropped and listed in `warnings`**; nothing non-conforming is emitted.
- Pipe it straight into the schema's own validator: `... | jq '.readings' > r.json && python scripts/validate.py r.json`.

| USGS code | #450 `parameter` | `unit` |
|---|---|---|
| 00010 | `temperature` | `celsius` |
| 00300 | `dissolved_oxygen` | `mg/L` |
| 00400 | `ph` | `pH` |
| 00076 | `turbidity` | `NTU` |

`quality_flag`: USGS `A` → `validated`, `P` → `raw`, `e` → `estimated`, `Eqp` → `suspect`. `sensor_id` = `USGS-<site number>`; `source` = `USGS Water Services API`.

### What #450 cannot express (so it is NOT in `readings`)
- **Discharge (00060) and gauge height (00065)**: the schema has no such parameters (water_quality allows only ph / dissolved_oxygen / turbidity / temperature). They are returned in a separate `supplemental` array. For "river gauge" use cases this is the most important data, so consider proposing `discharge` / `gage_height` to the schema.
- **Turbidity in FNU (63680)**: the schema requires NTU, and FNU ≠ NTU, so it is deliberately not mapped.
- **EPA compliance rankings**: facility compliance isn't a sensor reading; this tool returns its own shape and says `schema_conformance: not-applicable`.

## Quick start

```bash
git clone <this repo> && cd watershed-mcp
npm install && npm run build && npm test
npm start            # MCP over stdio
```

```json
{ "mcpServers": { "watershed": { "command": "node", "args": ["/absolute/path/to/watershed-mcp/dist/index.js"] } } }
```

## Tool reference

**`query_rivers`**: `state` (e.g. `VA`) | `huc` (2-8 digits) | `bbox` (`w,s,e,n`); optional `name_contains`, `limit` (25).
Returns `sites[]`, `readings[]` (latest), `supplemental[]`. USGS has no name search, so `name_contains` filters client-side.

**`get_gauge_readings`**: `site_ids` (USGS site numbers, ≤100); optional `parameters` (default: the 4 mapped codes + 00060/00065), `period` (ISO-8601, e.g. `PT6H`; omit for latest), `max_points_per_series` (50).

**`rank_epa_compliance`**: `state` or `huc`; optional `min_quarters_in_violation` (1), `limit`, `max_pages`.
`compliance_score` (0-100, higher = better) is a heuristic, not an EPA metric: `100 - 6*quarters_in_NC - 20 if SNC - 2*formal_actions`, floor 0. Covers only the first `max_pages` of ECHO results (stated in `warnings`).

## Verify before relying on it (honest status)

Built and tested with mocked HTTP; the build sandbox could not reach the live APIs.

- [x] TypeScript build, 7 tests (incl. the #450 repo's own examples validate under our Ajv setup), stdio `tools/list` smoke test
- [ ] **Live USGS call**: `curl "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=01646500&parameterCd=00060"`. Note most gauges don't report pH/DO/turbidity/temperature, so `readings` may be empty for many sites; that is real data sparsity, not a bug.
- [ ] **Live ECHO call**: `p_qiv`, `p_huc` and the `CWP*` field names in `src/echo.ts` came from docs, not a live call.

## Permanent build on Arweave
See [ARWEAVE.md](ARWEAVE.md).

## License
MIT. `schema/` is vendored from xtratrezzy/ecological-sensor-schema (MIT, see `schema/LICENSE.ecological-sensor-schema`).
