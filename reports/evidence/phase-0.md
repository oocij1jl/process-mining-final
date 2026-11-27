# Phase 0 verification

2026-11-27 KST. Local Node.js v24.15.0 and npm 11.12.1. The excerpts omit machine-specific paths and terminal formatting.

## Installation

`npm install --fetch-retries=0 --cache /tmp/processpilot-npm-cache`

```text
added 145 packages, and audited 152 packages in 12s
found 0 vulnerabilities
```

`npm ci --offline --no-audit --cache /tmp/processpilot-npm-cache`

```text
added 146 packages in 3s
```

The default sandbox returned `ENOTFOUND` for the npm registry check. Installation succeeded after approval. The lockfile install reused the downloaded packages in the npm cache.

## Tests

`npm test`

```text
RUN  v4.1.12
Test Files  1 passed (1)
Tests  13 passed (13)
```

One test verifies PapaParse reads the eight fixture rows with string case IDs. Twelve tests verify that every Phase 0 engine function throws a named `EngineNotImplementedError`. The fixture's expected analysis values were calculated by hand and are ready for future engine tests.

## Build

`npm run build` ran `tsc --noEmit` and `vite build`.

```text
vite v8.4.0 building client environment for production...
✓ 16 modules transformed.
dist/index.html                   0.39 kB │ gzip:  0.26 kB
dist/assets/index-rb5_6vEV.css    8.60 kB │ gzip:  2.63 kB
dist/assets/index-qdDdPNKD.js   219.63 kB │ gzip: 68.78 kB
✓ built in 92ms
```

The generated CSS contains the Tailwind `.place-items-center` utility used by the React shell.

## Local development server

`npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`

```text
VITE v8.4.0  ready in 244 ms
➜  Local:   http://127.0.0.1:5173/
```

The initial sandboxed start failed with `listen EPERM`. The approved local run started successfully. A Chrome guest window rendered the `ProcessPilot` heading and `Phase 0 · Analysis features are pending.` text. The development server was stopped after verification.

## Deployment configuration

Parsed the GitHub Actions workflow and confirmed the `npm ci`, `npm test`, and `npm run build` steps. Parsed `netlify.toml` and confirmed the build command and `dist` publish directory. Remote execution and the public URL remain pending.
