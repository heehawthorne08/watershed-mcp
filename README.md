# watershed-mcp

An [MCP](https://modelcontextprotocol.io) server exposing **live watershed data**:

| Tool | What it does | Source |
|---|---|---|
| `query_rivers` | Find active river/stream gauges by state, HUC or bbox (optional name filter) with latest discharge + gauge height | USGS NWIS |
| `get_gauge_readings` | Latest or historical readings for specific USGS site numbers | USGS NWIS |
| `rank_epa_compliance` | Rank Clean Water Act facilities worst-first for a state or HUC | EPA ECHO |

All tools return one JSON envelope (`schema_version`, `tool`, `generated_at`, `sources`, `query`, `count`, `results`, `warnings`).

> **Schema status:** the `#450` JSON schema was not available when this was built, so the envelope in
> [`src/schema.ts`](src/schema.ts) is a documented placeholder (`450-assumed-v0`). Conforming to the real
> spec means editing that one file. Nothing else depends on its shape.

## Quick start

```bash
git clone <this repo> && cd watershed-mcp
npm install
npm run build
npm test
npm start            # speaks MCP over stdio
```

### Claude Desktop / any MCP client

```json
{
  "mcpServers": {
    "watershed": { "command": "node", "args": ["/absolute/path/to/watershed-mcp/dist/index.js"] }
  }
}
```

## Tool reference

**`query_rivers`**: `state` (e.g. `VA`) | `huc` (2-8 digits) | `bbox` (`w,s,e,n`); optional `name_contains`, `limit` (default 25).
One geographic filter is required. USGS has no name search, so `name_contains` filters client-side.

**`get_gauge_readings`**: `site_ids` (USGS site numbers, up to 100); optional `parameters` (default `00060` discharge cfs, `00065` gauge height ft), `period` (ISO-8601 like `PT6H`; omit for latest), `max_points_per_series`.

**`rank_epa_compliance`**: `state` or `huc`; optional `min_quarters_in_violation` (default 1), `limit`, `max_pages`.
`compliance_score` (0-100, higher = better) is **a heuristic, not an EPA metric**: `100 - 6*quarters_in_NC - 20 if SNC - 2*formal_actions`, floored at 0.
Rankings only cover the first `max_pages` of ECHO results; the response says so in `warnings`.

## Verify before relying on it (honest status)

Built and tested with mocked HTTP; the build sandbox could not reach the live APIs.

- [x] TypeScript build, 5 unit tests, stdio `tools/list` smoke test
- [ ] **Live USGS call**: `curl "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=01646500&parameterCd=00060"`
- [ ] **Live ECHO call**: the `p_qiv`, `p_huc` params and `CWP*` response field names in `src/echo.ts` were written from docs, not tested. Hit `cwa_rest_services.get_facilities?output=JSON&p_st=VA` and `get_qid` and compare to the fields mapped there.
- [ ] Conform `src/schema.ts` to the real #450 schema.

## Permanent build on Arweave

See [ARWEAVE.md](ARWEAVE.md).

## License
MIT
