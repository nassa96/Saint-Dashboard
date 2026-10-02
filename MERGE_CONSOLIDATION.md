# SOVERIEL + SAINT DASHBOARD RECONCILIATION

This file intentionally adds a non-destructive consolidation record for the two repositories without modifying or deleting the original project logic.

## Purpose

This consolidation preserves the unique strengths of each codebase while aligning them around the same deployment and verification expectations:

- `nassa96/Saint-Dashboard` contributes the production deployment stack, runtime diagnostics, Docker/Render configuration, and a simple Node service health model.
- `nassa96/Soveriel-Nexara-AI-` contributes the stricter release-verification model, TypeScript/Vite build pipeline, isolated test gates, security checks, and production-quality verification workflow expectations.

## Reconciled deployment strategy

### Keep intact

- Saint dashboard runtime remains as a live trading / operational service with `server.js` and Docker deployment patterns.
- Soveriel remains as the governed intelligence / app ecosystem with build-time verification and release gates.
- Neither repository should be rewritten or removed to satisfy a merge. The goal is a compatibility layer: each project keeps its own logic and can borrow the validated operational pattern from the other if needed.

### Useful data borrowed from Saint-Dashboard

- Containerized deployment model (`Dockerfile`, `docker-compose.yml`, `render.yaml`)
- Health-check route expectations (`/api/health`)
- Simple production startup and environment conventions
- Deployment documentation (`DEPLOY.md`, `RENDER.md`, `LAUNCH.md`)

### Useful data borrowed from Soveriel-Nexara-AI-

- Strict CI expectations (`npm run build:strict`, `npm run test:e2e`, `npm run test:production`, `npm run test:ui`, `npm run test:production:browser`)
- Build verification and production safety gates (`npm run verify:build`, `npm run ci:check`, `npm run audit:security`)
- Node 22 / TypeScript build discipline
- GitHub Actions canonical workflow pattern

## Deployment compatibility rules

1. Preserve the app-specific runtime entrypoint in each repo.
2. Keep the health endpoint and boot smoke tests.
3. Use Saint's deployment tooling as the operational runtime baseline for container and Render hosting.
4. Use Soveriel's validation pipeline as the release gate before public promotion.
5. Do not delete legacy files, comments, or scripts. Only add compatibility scaffolding when needed.

## CI commands to run for each repository

### Saint-Dashboard

```bash
npm ci || npm install
node -c server.js
node -c config.js
npm test
node server.js &
SRV=$!
sleep 4
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health)
echo "health: $code"
kill $SRV || true
test "$code" = "200"
```

### Soveriel-Nexara-AI-

```bash
npm ci --include=dev --no-audit --no-fund
npm run ci:check
npm run build:strict
npm run audit:security
npm run test:e2e
npm run test:production
npx playwright install --with-deps chromium
npm run test:ui
npm run test:production:browser
npm run deploy:verify
```

## Final organism posture

The finished organism is not a destructive merge. It is a compatibility stack:

- Saint handles the operational / deployment layer.
- Soveriel handles the release / verification layer.
- Shared deployment principles (health checks, environment discipline, and safety gating) are aligned without overwriting either codebase.

This keeps both repositories deployable, auditable, and operationally sound while preserving the original project intent.
