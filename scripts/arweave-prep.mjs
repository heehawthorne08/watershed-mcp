// Bundles the server into ONE file and writes a manifest with sha256 so the
// Arweave upload is reproducible/verifiable. Output: build/
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("build", { recursive: true });
await build({
  entryPoints: ["src/index.ts"], bundle: true, platform: "node", format: "esm",
  target: "node20", outfile: "build/watershed-mcp.mjs", minify: false,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
const buf = readFileSync("build/watershed-mcp.mjs");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = {
  name: pkg.name, version: pkg.version, file: "watershed-mcp.mjs",
  bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"),
  built_at: new Date().toISOString(), run: "node watershed-mcp.mjs",
};
writeFileSync("build/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(manifest);
