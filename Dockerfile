# ---- SAINT CORE — production image ----
FROM node:20-alpine AS base
WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# App source
COPY . .

# Run as non-root
RUN addgroup -S saint && adduser -S saint -G saint \
    && mkdir -p /app/data && chown -R saint:saint /app
USER saint

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Container-level health check hits the app's health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
