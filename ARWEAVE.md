# Publishing the build to Arweave

`npm run bundle` produces `build/watershed-mcp.mjs` (single-file, all deps inlined, ~750 KB) and
`build/manifest.json` (name, version, bytes, **sha256**). Upload both so anyone can verify the artifact.

## 1. Build + verify
```bash
npm ci && npm test && npm run bundle
sha256sum build/watershed-mcp.mjs     # must equal manifest.json
node build/watershed-mcp.mjs          # should start and wait on stdio (Ctrl-C)
```

## 2. Upload with ArDrive Turbo
The bundle is over Turbo's free tier (~100 KiB), so you need Turbo credits (buy with a card or crypto at https://turbo.ardrive.io).
```bash
npm i -g @ardrive/turbo-sdk
turbo upload-folder --folder-path build --wallet-file ./wallet.json
```
(Use `turbo --help` to confirm flags for your installed version. I couldn't run it from the build environment.)
Use an Arweave/ETH/SOL wallet **you** control. Never commit `wallet*.json` (already in `.gitignore`).

## 3. Record it
Put the returned transaction/manifest ID in the README:
```
Arweave build: https://arweave.net/<MANIFEST_OR_TX_ID>
sha256: <from manifest.json>
```
Run it straight from Arweave:
```bash
curl -L https://arweave.net/<TX_ID>/watershed-mcp.mjs -o watershed-mcp.mjs && node watershed-mcp.mjs
```
