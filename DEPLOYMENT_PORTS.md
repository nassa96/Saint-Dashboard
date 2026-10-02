# Deployment Port & Health Check Configuration

## Current configuration

### Saint-Dashboard
- **Default port**: 3000
- **Health endpoint**: `GET /api/health` (returns 200 OK)
- **Environment variable**: `PORT` (respects process.env.PORT)
- **Docker**: Exposes port 3000
- **Render**: Sets PORT=10000, app respects it

### Soveriel-Nexara-AI-
- **Default port**: 8787
- **Health endpoints**: 
  - `GET /api/health` (liveness)
  - `GET /api/ready` (service + persistence readiness)
- **Environment variable**: PORT (inferred from docs)
- **Startup**: `tsx server/index.ts`

## Reconciliation strategy

To deploy both organisms as a unified stack without breaking either:

### Rule 1: Respect existing port defaults
- Do NOT change the hardcoded port in either app.
- Use environment variables for deployment-time overrides.
- CI tests must connect to the correct port for each repo.

### Rule 2: Unified health-check contract
Both repos must:
1. Expose `GET /api/health` as a liveness probe
2. Return `200 OK` when ready to serve traffic
3. Return `503 Service Unavailable` when unhealthy

### Rule 3: Deployment port assignment
- **Saint-Dashboard** → port 3000 (local dev) or 10000 (Render)
- **Soveriel-Nexara-AI-** → port 8787 (local dev) or configured via PORT env
- Use `render.yaml` or `docker-compose.yml` to set PORT per service

### Rule 4: CI test port detection
Each CI workflow must:
1. Detect or know the expected port ahead of time
2. Start the server
3. Wait 4+ seconds for initialization
4. Test the health endpoint on the correct port
5. Kill the server and exit with the health test result

## CI Port Configuration

### Saint-Dashboard CI
```bash
PORT=${PORT:-3000}
node server.js &
SRV=$!
sleep 4
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT}/api/health)
kill $SRV || true
test "$code" = "200"
```

### Soveriel-Nexara-AI- CI
```bash
PORT=${PORT:-8787}
npm run start &
SRV=$!
sleep 4
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT}/api/health)
kill $SRV || true
test "$code" = "200"
```

## Production Deployment

### Docker Compose (both services)
```yaml
version: '3.8'
services:
  saint-dashboard:
    build: ./saint-dashboard
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
  
  soveriel-nexara:
    build: ./soveriel-nexara
    ports:
      - "8787:8787"
    environment:
      - PORT=8787
      - NODE_ENV=production
```

### Render (separate blueprints per service)

**Saint-Dashboard**: `render.yaml`
- Service name: saint-core
- Start command: `node server.js`
- Health check path: `/api/health`
- Port (env): 10000

**Soveriel-Nexara-AI-**: `render-soveriel.yaml`
- Service name: soveriel-organism
- Start command: `npm run start:built` or `npm run start`
- Health check path: `/api/health`
- Port (env): 8787 (or override as needed)

## Troubleshooting Error 121 (Connection Refused)

If you see "Error 121: Connection refused":

1. **Check the port**: Verify the server started on the expected port
   ```bash
   lsof -i :3000  # Check Saint
   lsof -i :8787  # Check Soveriel
   ```

2. **Check logs**: Print server startup output
   ```bash
   node server.js 2>&1 | head -20
   npm run start 2>&1 | head -20
   ```

3. **Check dependencies**: Ensure npm install succeeded
   ```bash
   npm ls express
   npm ls cors
   ```

4. **Check environment**: Ensure .env or EnV/.env is properly configured
   ```bash
   cat .env.example
   cp .env.example .env  # or EnV/.env
   ```

5. **Check config**: Verify the app's config.js or server startup script
   - Saint: `config.js` → `PORT` variable
   - Soveriel: server startup → port binding

## Final reconciliation state

Both repos can coexist and deploy independently:
- Saint uses its own port (3000) and health check
- Soveriel uses its own port (8787) and health check
- CI for each repo uses the correct port
- Production deployment assigns unique ports
- No code is deleted or rewritten; only deployment configuration is unified
