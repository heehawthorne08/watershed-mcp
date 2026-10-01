#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { complianceInput, gaugeInput, getGaugeReadings, queryRivers, queryRiversInput, rankEpaCompliance } from "./tools.js";

const server = new McpServer({ name: "watershed-mcp", version: "0.1.0" });

const wrap = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await fn(a), null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
  }
};

server.tool("query_rivers", "Find active river/stream gauge sites by state, HUC or bounding box, with latest discharge and gauge height (USGS NWIS).", queryRiversInput, wrap(queryRivers));
server.tool("get_gauge_readings", "Live or recent gauge readings for specific USGS site numbers (USGS NWIS).", gaugeInput, wrap(getGaugeReadings));
server.tool("rank_epa_compliance", "Rank Clean Water Act permitted facilities by compliance (worst first) for a state or HUC (EPA ECHO).", complianceInput, wrap(rankEpaCompliance));

await server.connect(new StdioServerTransport());
